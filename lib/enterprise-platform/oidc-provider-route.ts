import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
  type StudioAccount,
} from "../access-tier.ts";
import {
  decodeUtf8Body,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "../http-request-boundary.ts";
import {
  consumeRequestLimitState,
  requestIdentity,
} from "../request-rate-limit.ts";
import {
  OidcProviderError,
  pkceChallenge,
  safeEqual,
  type OidcProviderConfig,
} from "./oidc-provider.ts";

export const OIDC_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

export const OIDC_PUBLIC_METADATA_HEADERS = {
  "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=300",
  "x-content-type-options": "nosniff",
};

export const OIDC_DEMO_COOKIE = "drops_oidc_demo_flow";
const OIDC_DEMO_COOKIE_TTL_SECONDS = 300;

export function oidcJson(payload: object, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: OIDC_NO_STORE_HEADERS });
}

export function oidcErrorResponse(error: unknown): NextResponse {
  const providerError = error instanceof OidcProviderError
    ? error
    : new OidcProviderError("temporarily_unavailable", "OIDC provider is temporarily unavailable.", 503);
  const response = oidcJson({ error: providerError.code, error_description: providerError.message }, providerError.status);
  if (providerError.code === "invalid_client") {
    response.headers.set("www-authenticate", 'Basic realm="Drops Studio OIDC"');
  } else if (providerError.code === "invalid_token") {
    response.headers.set("www-authenticate", 'Bearer error="invalid_token"');
  }
  return response;
}

export function registeredAuthorizationRedirect(
  params: URLSearchParams,
  config: OidcProviderConfig,
): URL | null {
  const clientIds = params.getAll("client_id");
  const redirectUris = params.getAll("redirect_uri");
  if (
    clientIds.length !== 1
    || clientIds[0] !== config.clientId
    || redirectUris.length !== 1
    || !config.redirectUris.has(redirectUris[0])
  ) return null;
  return new URL(redirectUris[0]);
}

export function authorizationErrorResponse(
  error: unknown,
  params: URLSearchParams,
  config: OidcProviderConfig,
): NextResponse {
  const redirect = registeredAuthorizationRedirect(params, config);
  if (!redirect) return oidcErrorResponse(error);
  const providerError = error instanceof OidcProviderError
    ? error
    : new OidcProviderError("temporarily_unavailable", "OIDC provider is temporarily unavailable.", 503);
  redirect.searchParams.set("error", providerError.code);
  redirect.searchParams.set("error_description", providerError.message);
  const states = params.getAll("state");
  if (states.length === 1 && /^[A-Za-z0-9._~-]{16,512}$/.test(states[0])) {
    redirect.searchParams.set("state", states[0]);
  }
  const response = NextResponse.redirect(redirect, 302);
  for (const [header, value] of Object.entries(OIDC_NO_STORE_HEADERS)) {
    response.headers.set(header, value);
  }
  return response;
}

export function studioMember(request: NextRequest): StudioAccount {
  const account = resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
  if (!account) {
    throw new OidcProviderError("login_required", "A signed Studio member account is required.", 401);
  }
  return account;
}

export async function enforceOidcRateLimit(input: {
  request: NextRequest;
  identity?: string;
  namespace: string;
  max: number;
  windowMs: number;
}): Promise<void> {
  const identity = input.identity ?? requestIdentity(input.request);
  const state = await consumeRequestLimitState({
    identity,
    namespace: input.namespace,
    max: input.max,
    windowMs: input.windowMs,
  });
  if (state.status === "limited") {
    throw new OidcProviderError("temporarily_unavailable", "OIDC request rate limit exceeded.", 429);
  }
  if (state.status === "unavailable") {
    throw new OidcProviderError("temporarily_unavailable", "OIDC request protection is unavailable.", 503);
  }
}

function decodeBasicCredentials(header: string | null): { clientId: string; clientSecret: string } {
  const value = header?.trim() ?? "";
  if (value.length > 1_024 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(value)) {
    throw new OidcProviderError("invalid_client", "Client authentication failed.", 401);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value.slice(6), "base64"));
    const separator = decoded.indexOf(":");
    if (separator <= 0) throw new Error();
    const formDecode = (part: string): string => decodeURIComponent(part.replace(/\+/g, " "));
    const clientId = formDecode(decoded.slice(0, separator));
    const clientSecret = formDecode(decoded.slice(separator + 1));
    if (!clientId || !clientSecret || clientId.length > 128 || clientSecret.length > 512) throw new Error();
    return { clientId, clientSecret };
  } catch {
    throw new OidcProviderError("invalid_client", "Client authentication failed.", 401);
  }
}

export function authenticateConfidentialClient(
  request: Pick<Request, "headers">,
  config: OidcProviderConfig,
): { clientId: string; clientSecret: string } {
  const credentials = decodeBasicCredentials(request.headers.get("authorization"));
  if (!safeEqual(credentials.clientId, config.clientId) || !safeEqual(credentials.clientSecret, config.clientSecret)) {
    throw new OidcProviderError("invalid_client", "Client authentication failed.", 401);
  }
  return credentials;
}

function mediaType(request: Pick<Request, "headers">): string {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function exactlyOne(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  if (values.length !== 1) throw new OidcProviderError("invalid_request", `${name} is required exactly once.`);
  return values[0];
}

export async function parseTokenRequest(
  request: NextRequest,
  config: OidcProviderConfig,
): Promise<{
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}> {
  const credentials = authenticateConfidentialClient(request, config);
  if (mediaType(request) !== "application/x-www-form-urlencoded") {
    throw new OidcProviderError("invalid_request", "Token request requires application/x-www-form-urlencoded.", 415);
  }
  let raw: string;
  try {
    raw = decodeUtf8Body(await readBoundedRequestBody(request, 4_096));
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      throw new OidcProviderError("invalid_request", "Token request is too large.", 413);
    }
    throw new OidcProviderError("invalid_request", "Token request body is invalid.");
  }
  const params = new URLSearchParams(raw);
  if ([...params].length > 8 || params.has("client_secret") || params.has("client_id")) {
    throw new OidcProviderError("invalid_request", "Token request body is invalid.");
  }
  if (exactlyOne(params, "grant_type") !== "authorization_code") {
    throw new OidcProviderError("unsupported_grant_type", "Only authorization_code is supported.");
  }
  const code = exactlyOne(params, "code");
  const codeVerifier = exactlyOne(params, "code_verifier");
  const redirectUri = exactlyOne(params, "redirect_uri");
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || redirectUri.length > 512) {
    throw new OidcProviderError("invalid_grant", "Authorization code or verifier is invalid.");
  }
  pkceChallenge(codeVerifier);
  return { ...credentials, code, codeVerifier, redirectUri };
}

export function bearerToken(request: Pick<Request, "headers">): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer ([A-Za-z0-9._~-]{80,8192})$/i.exec(authorization);
  if (!match) throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  return match[1];
}

interface DemoFlowCookie {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  issuedAt: number;
  expiresAt: number;
}

function demoCookieSignature(payload: string, config: OidcProviderConfig): string {
  return createHmac("sha256", config.signingSecret)
    .update(`drops-studio-oidc-demo:v1:${payload}`, "utf8")
    .digest("base64url");
}

export function createDemoFlow(config: OidcProviderConfig, now = new Date()): {
  cookie: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
} {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const flow: DemoFlowCookie = {
    version: 1,
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + OIDC_DEMO_COOKIE_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(flow), "utf8").toString("base64url");
  return {
    cookie: `${payload}.${demoCookieSignature(payload, config)}`,
    state: flow.state,
    nonce: flow.nonce,
    codeVerifier: flow.codeVerifier,
    codeChallenge: pkceChallenge(flow.codeVerifier),
    redirectUri: `${config.issuer}/demo/callback`,
  };
}

export function readDemoFlow(
  value: string | undefined,
  config: OidcProviderConfig,
  now = new Date(),
): DemoFlowCookie {
  const candidate = value?.trim() ?? "";
  const separator = candidate.lastIndexOf(".");
  if (candidate.length > 2_048 || separator <= 0) {
    throw new OidcProviderError("invalid_request", "OIDC demo flow cookie is invalid.");
  }
  const payload = candidate.slice(0, separator);
  const suppliedSignatureText = candidate.slice(separator + 1);
  const suppliedSignature = Buffer.from(suppliedSignatureText, "base64url");
  const expectedSignature = Buffer.from(demoCookieSignature(payload, config), "base64url");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignatureText)
    || suppliedSignature.toString("base64url") !== suppliedSignatureText
    || suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new OidcProviderError("invalid_request", "OIDC demo flow cookie is invalid.");
  }
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DemoFlowCookie>;
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (
      flow.version !== 1
      || typeof flow.state !== "string"
      || !/^[A-Za-z0-9._~-]{43}$/.test(flow.state)
      || typeof flow.nonce !== "string"
      || !/^[A-Za-z0-9._~-]{43}$/.test(flow.nonce)
      || typeof flow.codeVerifier !== "string"
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(flow.codeVerifier)
      || !Number.isSafeInteger(flow.issuedAt)
      || !Number.isSafeInteger(flow.expiresAt)
      || Number(flow.issuedAt) > nowSeconds + 30
      || Number(flow.expiresAt) < nowSeconds
      || Number(flow.expiresAt) - Number(flow.issuedAt) !== OIDC_DEMO_COOKIE_TTL_SECONDS
    ) throw new Error();
    return flow as DemoFlowCookie;
  } catch {
    throw new OidcProviderError("invalid_request", "OIDC demo flow cookie is invalid.");
  }
}

export function setDemoCookie(response: NextResponse, value: string): void {
  response.cookies.set(OIDC_DEMO_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/enterprise/oidc/demo",
    maxAge: OIDC_DEMO_COOKIE_TTL_SECONDS,
  });
}

export function clearDemoCookie(response: NextResponse): void {
  response.cookies.set(OIDC_DEMO_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/enterprise/oidc/demo",
    maxAge: 0,
  });
}
