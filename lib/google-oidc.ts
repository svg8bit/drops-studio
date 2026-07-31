import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeSameOriginReturnPath } from "@/lib/safe-return-to";

export const GOOGLE_OIDC_TRANSACTION_COOKIE = "drops_google_oidc";
export const GOOGLE_OIDC_TRANSACTION_TTL_SECONDS = 10 * 60;

interface GoogleOidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

export interface GoogleIdentity {
  subject: string;
  name: string;
  email?: string;
  picture?: string;
}

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function matches(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

const RETURN_PATH_VALIDATION_ORIGIN = "https://drops.studio";

function safeReturnTo(
  value: string | null | undefined,
  origin = RETURN_PATH_VALIDATION_ORIGIN,
): string {
  return safeSameOriginReturnPath(value, origin);
}

export function createGoogleOidcTransaction(
  returnTo: string | null | undefined,
  origin = RETURN_PATH_VALIDATION_ORIGIN,
): GoogleOidcTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    returnTo: safeReturnTo(returnTo, origin),
    createdAt: Math.floor(Date.now() / 1_000),
  };
}

export function serializeGoogleOidcTransaction(
  transaction: GoogleOidcTransaction,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function readGoogleOidcTransaction(
  value: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): GoogleOidcTransaction | null {
  const separator = value?.lastIndexOf(".") ?? -1;
  if (separator <= 0 || !secret) return null;
  const payload = value!.slice(0, separator);
  const signature = value!.slice(separator + 1);
  if (!matches(signature, hmac(payload, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GoogleOidcTransaction>;
    if (
      typeof parsed.state !== "string"
      || !/^[A-Za-z0-9_-]{32,128}$/.test(parsed.state)
      || typeof parsed.nonce !== "string"
      || !/^[A-Za-z0-9_-]{32,128}$/.test(parsed.nonce)
      || typeof parsed.codeVerifier !== "string"
      || !/^[A-Za-z0-9_-]{43,128}$/.test(parsed.codeVerifier)
      || typeof parsed.returnTo !== "string"
      || safeReturnTo(parsed.returnTo) !== parsed.returnTo
      || !Number.isSafeInteger(parsed.createdAt)
      || Number(parsed.createdAt) > now + 60
      || Number(parsed.createdAt) < now - GOOGLE_OIDC_TRANSACTION_TTL_SECONDS
    ) return null;
    return parsed as GoogleOidcTransaction;
  } catch {
    return null;
  }
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  transaction: GoogleOidcTransaction;
}): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.transaction.state);
  url.searchParams.set("nonce", input.transaction.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(input.transaction.codeVerifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url;
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  transaction: GoogleOidcTransaction;
}): Promise<GoogleIdentity> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.transaction.codeVerifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    id_token?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error_description || "Google did not return a verifiable identity token.");
  }
  const verified = await jwtVerify(payload.id_token, GOOGLE_JWKS, {
    audience: input.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
    maxTokenAge: "10m",
  });
  const claims = verified.payload;
  if (
    typeof claims.sub !== "string"
    || !/^[0-9]{6,64}$/.test(claims.sub)
    || claims.nonce !== input.transaction.nonce
    || claims.email_verified !== true
  ) throw new Error("Google identity verification failed.");
  const name = typeof claims.name === "string" && claims.name.trim()
    ? claims.name.trim().slice(0, 160)
    : typeof claims.email === "string"
      ? claims.email.split("@", 1)[0]!.slice(0, 160)
      : "Drops Studio member";
  const email = typeof claims.email === "string" && claims.email.length <= 320
    ? claims.email
    : undefined;
  let picture: string | undefined;
  if (typeof claims.picture === "string" && claims.picture.length <= 2_048) {
    try {
      const url = new URL(claims.picture);
      if (url.protocol === "https:" && !url.username && !url.password) picture = url.toString();
    } catch {
      picture = undefined;
    }
  }
  return { subject: claims.sub, name, ...(email ? { email } : {}), ...(picture ? { picture } : {}) };
}
