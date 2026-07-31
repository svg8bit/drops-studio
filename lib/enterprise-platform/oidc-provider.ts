import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";

export const OIDC_CODE_TTL_SECONDS = 120;
export const OIDC_TOKEN_TTL_SECONDS = 300;
export const OIDC_MAX_CLOCK_SKEW_SECONDS = 30;

const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SAFE_VALUE = /^[A-Za-z0-9._~-]+$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export type OidcProviderErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "login_required"
  | "temporarily_unavailable"
  | "invalid_token";

export class OidcProviderError extends Error {
  readonly code: OidcProviderErrorCode;
  readonly status: number;

  constructor(code: OidcProviderErrorCode, message: string, status = 400) {
    super(message);
    this.name = "OidcProviderError";
    this.code = code;
    this.status = status;
  }
}

export interface OidcProviderEnvironment {
  DROPS_ENTERPRISE_OIDC_ISSUER?: string;
  DROPS_ENTERPRISE_OIDC_CLIENT_ID?: string;
  DROPS_ENTERPRISE_OIDC_CLIENT_SECRET?: string;
  DROPS_ENTERPRISE_OIDC_SIGNING_SECRET?: string;
  DROPS_ENTERPRISE_OIDC_SUBJECT_SALT?: string;
  DROPS_ENTERPRISE_OIDC_REDIRECT_URIS?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

export interface OidcProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  subjectSalt: string;
  redirectUris: ReadonlySet<string>;
}

export interface OidcMemberIdentity {
  identity: string;
  issuedAt: number;
  provider: "openrouter";
}

export interface OidcAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  responseType: "code";
  responseMode: "query";
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface OidcAuthorizationCodeRecord {
  version: 1;
  clientId: string;
  redirectUri: string;
  subject: string;
  scope: string;
  nonce: string;
  codeChallenge: string;
  authTime: number;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface OidcAuthorizationCodeStore {
  issue(code: string, record: OidcAuthorizationCodeRecord): Promise<void>;
  consume(code: string, nowSeconds: number): Promise<OidcAuthorizationCodeRecord | null>;
  health(): Promise<boolean>;
}

export interface OidcTokenSet {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  id_token: string;
}

export interface OidcUserInfo {
  sub: string;
  auth_time: number;
}

export interface VerifiedOidcJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

function requiredSecret(value: string | undefined, label: string): string {
  const secret = value?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new OidcProviderError("temporarily_unavailable", `${label} must contain at least 32 bytes.`, 503);
  }
  return secret;
}

function canonicalIssuer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcProviderError("temporarily_unavailable", "OIDC issuer is invalid.", 503);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC issuer must be a canonical HTTPS URL with a path.", 503);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC issuer must be a canonical HTTPS URL with a path.", 503);
  }
  return `${url.origin}${pathname}`;
}

function canonicalRedirectUri(value: string): string {
  if (!value || value.length > 512 || value.includes("*")) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC redirect URI allowlist is invalid.", 503);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcProviderError("temporarily_unavailable", "OIDC redirect URI allowlist is invalid.", 503);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC redirect URIs must be exact HTTPS URLs.", 503);
  }
  return url.toString();
}

function configuredIssuer(environment: OidcProviderEnvironment): string {
  const explicit = environment.DROPS_ENTERPRISE_OIDC_ISSUER?.trim();
  if (explicit) return explicit;
  const productionHost = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost && /^[A-Za-z0-9.-]+$/.test(productionHost)) {
    return `https://${productionHost}/api/enterprise/oidc`;
  }
  throw new OidcProviderError("temporarily_unavailable", "OIDC issuer is not configured.", 503);
}

export function oidcProviderConfig(
  environment: OidcProviderEnvironment = process.env as OidcProviderEnvironment,
): OidcProviderConfig {
  const issuer = canonicalIssuer(configuredIssuer(environment));
  const clientId = environment.DROPS_ENTERPRISE_OIDC_CLIENT_ID?.trim() ?? "";
  if (!/^[A-Za-z0-9._~-]{8,128}$/.test(clientId)) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC client id is not configured.", 503);
  }
  const clientSecret = requiredSecret(
    environment.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET,
    "OIDC client secret",
  );
  const signingSecret = requiredSecret(
    environment.DROPS_ENTERPRISE_OIDC_SIGNING_SECRET,
    "OIDC signing secret",
  );
  const subjectSalt = requiredSecret(
    environment.DROPS_ENTERPRISE_OIDC_SUBJECT_SALT,
    "OIDC subject salt",
  );
  if (
    safeEqual(clientSecret, signingSecret)
    || safeEqual(clientSecret, subjectSalt)
    || safeEqual(signingSecret, subjectSalt)
  ) {
    throw new OidcProviderError(
      "temporarily_unavailable",
      "OIDC client, signing, and subject secrets must be independent.",
      503,
    );
  }
  const configuredRedirects = (environment.DROPS_ENTERPRISE_OIDC_REDIRECT_URIS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configuredRedirects.length > 20) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC redirect URI allowlist is too large.", 503);
  }
  const redirects = new Set(configuredRedirects.map(canonicalRedirectUri));
  redirects.add(canonicalRedirectUri(`${issuer}/demo/callback`));
  return { issuer, clientId, clientSecret, signingSecret, subjectSalt, redirectUris: redirects };
}

export function oidcDiscovery(config: OidcProviderConfig) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    userinfo_endpoint: `${config.issuer}/userinfo`,
    jwks_uri: `${config.issuer}/jwks`,
    drops_studio_health_endpoint: `${config.issuer}/health`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["EdDSA"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "azp"],
  } as const;
}

function signingKeys(config: OidcProviderConfig): {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
  jwk: Record<string, string>;
} {
  const seed = Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(config.signingSecret, "utf8"),
    Buffer.from(config.issuer, "utf8"),
    Buffer.from("drops-studio-enterprise-oidc-ed25519-v1", "utf8"),
    32,
  ));
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  seed.fill(0);
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: "jwk" });
  if (publicJwk.kty !== "OKP" || publicJwk.crv !== "Ed25519" || !publicJwk.x) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC signing key could not be derived.", 503);
  }
  const kid = createHash("sha256").update(publicJwk.x, "utf8").digest("base64url").slice(0, 24);
  return {
    privateKey,
    publicKey,
    kid,
    jwk: { kty: "OKP", crv: "Ed25519", x: publicJwk.x, use: "sig", alg: "EdDSA", kid },
  };
}

export function oidcJwks(config: OidcProviderConfig) {
  return { keys: [signingKeys(config).jwk] };
}

function singleParameter(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  if (values.length !== 1) throw new OidcProviderError("invalid_request", `${name} is required exactly once.`);
  return values[0];
}

function boundedOpaque(value: string, label: string, minimum: number, maximum: number): string {
  if (value.length < minimum || value.length > maximum || !SAFE_VALUE.test(value)) {
    throw new OidcProviderError("invalid_request", `${label} is invalid.`);
  }
  return value;
}

export function parseOidcAuthorizationRequest(
  params: URLSearchParams,
  config: OidcProviderConfig,
): OidcAuthorizationRequest {
  if (params.toString().length > 2_048) {
    throw new OidcProviderError("invalid_request", "Authorization request is too large.");
  }
  const clientId = singleParameter(params, "client_id");
  if (clientId !== config.clientId) throw new OidcProviderError("unauthorized_client", "OIDC client is not allowed.");
  const redirectUri = singleParameter(params, "redirect_uri");
  if (!config.redirectUris.has(redirectUri)) {
    throw new OidcProviderError("invalid_request", "OIDC redirect URI is not registered.");
  }
  if (singleParameter(params, "response_type") !== "code") {
    throw new OidcProviderError("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  const responseMode = params.get("response_mode") ?? "query";
  if (params.getAll("response_mode").length > 1 || responseMode !== "query") {
    throw new OidcProviderError("invalid_request", "Only query response mode is supported.");
  }
  const scope = normalizeScope(singleParameter(params, "scope"));
  const state = boundedOpaque(singleParameter(params, "state"), "OIDC state", 16, 512);
  const nonce = boundedOpaque(singleParameter(params, "nonce"), "OIDC nonce", 16, 256);
  const codeChallenge = singleParameter(params, "code_challenge");
  if (!PKCE_CHALLENGE.test(codeChallenge)) {
    throw new OidcProviderError("invalid_request", "OIDC PKCE challenge is invalid.");
  }
  if (singleParameter(params, "code_challenge_method") !== "S256") {
    throw new OidcProviderError("invalid_request", "OIDC PKCE S256 is required.");
  }
  if (params.has("prompt")) {
    throw new OidcProviderError("invalid_request", "OIDC prompt is not supported.");
  }
  return {
    clientId,
    redirectUri,
    responseType: "code",
    responseMode: "query",
    scope,
    state,
    nonce,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export function normalizeScope(value: string): string {
  if (!value || value.length > 160) throw new OidcProviderError("invalid_scope", "OIDC scope is invalid.");
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (scopes.length !== 1 || scopes[0] !== "openid") {
    throw new OidcProviderError("invalid_scope", "Only the openid scope is supported.");
  }
  return "openid";
}

export function pkceChallenge(codeVerifier: string): string {
  if (!PKCE_VERIFIER.test(codeVerifier)) {
    throw new OidcProviderError("invalid_grant", "Authorization code or verifier is invalid.");
  }
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function pairwiseSubject(config: OidcProviderConfig, memberIdentity: string): string {
  if (!/^[a-f0-9]{64}$/i.test(memberIdentity)) {
    throw new OidcProviderError("login_required", "A signed Studio member account is required.", 401);
  }
  return createHmac("sha256", config.subjectSalt)
    .update(`drops-studio-oidc-sub:v1:${config.clientId}:${memberIdentity}`, "utf8")
    .digest("base64url");
}

export async function issueOidcAuthorizationCode(input: {
  request: OidcAuthorizationRequest;
  member: OidcMemberIdentity;
  store: OidcAuthorizationCodeStore;
  config: OidcProviderConfig;
  now?: Date;
}): Promise<string> {
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const code = randomBytes(32).toString("base64url");
  await input.store.issue(code, {
    version: 1,
    clientId: input.request.clientId,
    redirectUri: input.request.redirectUri,
    subject: pairwiseSubject(input.config, input.member.identity),
    scope: input.request.scope,
    nonce: input.request.nonce,
    codeChallenge: input.request.codeChallenge,
    authTime: input.member.issuedAt,
    issuedAt: now,
    expiresAt: now + OIDC_CODE_TTL_SECONDS,
    consumedAt: null,
  });
  return code;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signJwt(
  config: OidcProviderConfig,
  claims: Record<string, unknown>,
  type: "JWT" | "at+jwt",
): string {
  const { privateKey, kid } = signingKeys(config);
  const material = `${encodeJson({ alg: "EdDSA", typ: type, kid })}.${encodeJson(claims)}`;
  return `${material}.${sign(null, Buffer.from(material, "ascii"), privateKey).toString("base64url")}`;
}

function parseJwtPart(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{2,4096}$/.test(value)) {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
}

function validNumericDate(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function verifyOidcJwt(
  token: string,
  config: OidcProviderConfig,
  options: { type: "JWT" | "at+jwt"; audience: string; now?: Date },
): VerifiedOidcJwt {
  if (token.length > 8_192) throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);
  const { publicKey, kid } = signingKeys(config);
  if (header.alg !== "EdDSA" || header.typ !== options.type || header.kid !== kid) {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  if (signature.length !== 64 || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), publicKey, signature)) {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  if (
    claims.iss !== config.issuer
    || claims.aud !== options.audience
    || typeof claims.sub !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(claims.sub)
    || !validNumericDate(claims.iat)
    || !validNumericDate(claims.exp)
    || Number(claims.iat) > now + OIDC_MAX_CLOCK_SKEW_SECONDS
    || Number(claims.exp) <= now - OIDC_MAX_CLOCK_SKEW_SECONDS
    || Number(claims.exp) - Number(claims.iat) > OIDC_TOKEN_TTL_SECONDS
  ) {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  return { header, claims };
}

export async function exchangeOidcAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  config: OidcProviderConfig;
  store: OidcAuthorizationCodeStore;
  now?: Date;
}): Promise<OidcTokenSet> {
  if (!safeEqual(input.clientId, input.config.clientId) || !safeEqual(input.clientSecret, input.config.clientSecret)) {
    throw new OidcProviderError("invalid_client", "Client authentication failed.", 401);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.code)) {
    throw new OidcProviderError("invalid_grant", "Authorization code or verifier is invalid.");
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const record = await input.store.consume(input.code, now);
  if (
    !record
    || record.clientId !== input.clientId
    || record.redirectUri !== input.redirectUri
    || !safeEqual(record.codeChallenge, pkceChallenge(input.codeVerifier))
    || record.expiresAt <= now
  ) {
    throw new OidcProviderError("invalid_grant", "Authorization code or verifier is invalid.");
  }
  const issuedAt = now;
  const expiresAt = now + OIDC_TOKEN_TTL_SECONDS;
  const accessToken = signJwt(input.config, {
    iss: input.config.issuer,
    sub: record.subject,
    aud: input.config.clientId,
    exp: expiresAt,
    iat: issuedAt,
    auth_time: record.authTime,
    scope: record.scope,
    jti: randomBytes(16).toString("base64url"),
  }, "at+jwt");
  const idToken = signJwt(input.config, {
    iss: input.config.issuer,
    sub: record.subject,
    aud: input.config.clientId,
    exp: expiresAt,
    iat: issuedAt,
    auth_time: record.authTime,
    nonce: record.nonce,
    azp: input.config.clientId,
  }, "JWT");
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OIDC_TOKEN_TTL_SECONDS,
    scope: record.scope,
    id_token: idToken,
  };
}

export function oidcUserInfo(
  accessToken: string,
  config: OidcProviderConfig,
  now?: Date,
): OidcUserInfo {
  const verified = verifyOidcJwt(accessToken, config, {
    type: "at+jwt",
    audience: config.clientId,
    now,
  });
  if (!validNumericDate(verified.claims.auth_time)) {
    throw new OidcProviderError("invalid_token", "Bearer token is invalid.", 401);
  }
  return { sub: String(verified.claims.sub), auth_time: Number(verified.claims.auth_time) };
}

export async function oidcProviderSelfCheck(
  config: OidcProviderConfig,
  store: Pick<OidcAuthorizationCodeStore, "health">,
  now = new Date(),
): Promise<{
  status: "working";
  issuer: string;
  signingAlgorithm: "EdDSA";
  storage: "private-blob-cas";
  evidence: string[];
}> {
  const probeClaims = {
    iss: config.issuer,
    sub: createHmac("sha256", config.subjectSalt).update("oidc-health-subject").digest("base64url"),
    aud: config.clientId,
    iat: Math.floor(now.getTime() / 1_000),
    exp: Math.floor(now.getTime() / 1_000) + 30,
  };
  const token = signJwt(config, probeClaims, "JWT");
  verifyOidcJwt(token, config, { type: "JWT", audience: config.clientId, now });
  if (!await store.health()) {
    throw new OidcProviderError("temporarily_unavailable", "OIDC authorization-code storage is unavailable.", 503);
  }
  return {
    status: "working",
    issuer: config.issuer,
    signingAlgorithm: "EdDSA",
    storage: "private-blob-cas",
    evidence: [
      "https-canonical-issuer",
      "ed25519-sign-verify",
      "public-jwks-no-secret",
      "private-blob-cas",
      "authorization-code-pkce-s256",
    ],
  };
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
