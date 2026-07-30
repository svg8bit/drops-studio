import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const GUEST_DAILY_LIMIT = 3;
export const MEMBER_DAILY_LIMIT = 10;
export const GUEST_IDENTITY_COOKIE = "drops_guest_identity";
export const GUEST_USAGE_COOKIE = "drops_guest_builds";
export const STUDIO_ACCOUNT_COOKIE = "drops_studio_account";
export const MEMBER_USAGE_COOKIE = "drops_member_builds";

export type WorkingAccessTier = "guest" | "member" | "fallback" | "byok";

export interface StudioAccount {
  provider: "openrouter";
  subject: string;
  identity: string;
  issuedAt: number;
}

type EnvLike = Partial<Record<
  | "NODE_ENV"
  | "DROPS_ACCOUNT_COOKIE_SECRET"
  | "DROPS_GUEST_COOKIE_SECRET"
  | "AI_GATEWAY_API_KEY"
  | "VERCEL_OIDC_TOKEN"
  | "BLOB_READ_WRITE_TOKEN"
  | "BLOB_STORE_ID"
  | "DROPS_STUDIO_LOCAL_PROJECT_STORE"
  | "VERCEL",
  string | undefined
>>;

const MINIMUM_PRODUCTION_SECRET_BYTES = 32;

function validConfiguredSecret(value: string | undefined, env: EnvLike): string {
  const configured = value?.trim() ?? "";
  if (!configured) return "";
  if (env.NODE_ENV === "production" && Buffer.byteLength(configured, "utf8") < MINIMUM_PRODUCTION_SECRET_BYTES) {
    return "";
  }
  return configured;
}

function signature(value: string, secret: string): string {
  if (!secret) return "";
  return createHmac("sha256", secret).update(value).digest("hex");
}

function signaturesMatch(provided: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(provided) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const providedBuffer = Buffer.from(provided, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function resolveGuestCookieSecret(env: EnvLike = process.env): string {
  const configured = validConfiguredSecret(env.DROPS_GUEST_COOKIE_SECRET, env);
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "" : "drops-studio-development-only-cookie-secret";
}

export function resolveAccountCookieSecret(env: EnvLike = process.env): string {
  if (env.DROPS_ACCOUNT_COOKIE_SECRET !== undefined) {
    return validConfiguredSecret(env.DROPS_ACCOUNT_COOKIE_SECRET, env);
  }
  return resolveGuestCookieSecret(env);
}

export function platformAiReadiness(tier: "guest" | "member", env: EnvLike = process.env) {
  const signingConfigured = Boolean(
    tier === "member" ? resolveAccountCookieSecret(env) : resolveGuestCookieSecret(env),
  );
  const gatewayConfigured = Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim());
  const durableQuotaConfigured = Boolean(
    (env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !env.VERCEL)
      || env.BLOB_READ_WRITE_TOKEN?.trim()
      || (env.BLOB_STORE_ID?.trim() && env.VERCEL_OIDC_TOKEN?.trim()),
  );
  return {
    available: signingConfigured && gatewayConfigured && durableQuotaConfigured,
    signingConfigured,
    gatewayConfigured,
    durableQuotaConfigured,
  };
}

export function memberProjectSyncReadiness(env: EnvLike = process.env): boolean {
  return Boolean(
    (env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !env.VERCEL)
      || env.BLOB_READ_WRITE_TOKEN?.trim()
      || (env.BLOB_STORE_ID?.trim() && env.VERCEL_OIDC_TOKEN?.trim()),
  );
}

function validAccountSubject(value: string): boolean {
  return /^[a-z0-9][a-z0-9:_-]{5,199}$/i.test(value);
}

function accountIdentity(provider: StudioAccount["provider"], subject: string, secret: string): string {
  return createHmac("sha256", secret).update(`account:${provider}:${subject}`).digest("hex");
}

export function createStudioAccountCookie(
  input: Pick<StudioAccount, "provider" | "subject"> & { issuedAt?: number },
  secret: string,
): string {
  if (input.provider !== "openrouter" || !validAccountSubject(input.subject)) {
    throw new Error("Invalid Studio account identity.");
  }
  const issuedAt = Math.floor(input.issuedAt ?? Date.now() / 1_000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new Error("Invalid Studio account issue time.");
  const payload = Buffer.from(JSON.stringify({ v: 1, p: input.provider, s: input.subject, iat: issuedAt }), "utf8").toString("base64url");
  const signed = signature(payload, secret);
  if (!signed) throw new Error("Studio account signing is not configured.");
  return `${payload}.${signed}`;
}

export function readStudioAccountCookie(value: string, secret: string, now = Date.now()): StudioAccount | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || !secret) return null;
  const payload = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  if (!signaturesMatch(provided, signature(payload, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: unknown;
      p?: unknown;
      s?: unknown;
      iat?: unknown;
    };
    if (parsed.v !== 1 || parsed.p !== "openrouter" || typeof parsed.s !== "string" || !validAccountSubject(parsed.s)) return null;
    const issuedAt = Number(parsed.iat);
    const nowSeconds = Math.floor(now / 1_000);
    if (!Number.isSafeInteger(issuedAt) || issuedAt > nowSeconds + 300 || issuedAt < nowSeconds - 60 * 60 * 24 * 90) return null;
    return {
      provider: parsed.p,
      subject: parsed.s,
      identity: accountIdentity(parsed.p, parsed.s, secret),
      issuedAt,
    };
  } catch {
    return null;
  }
}

export function resolveStudioAccount(value: string | undefined, env: EnvLike = process.env): StudioAccount | null {
  const secret = resolveAccountCookieSecret(env);
  return secret ? readStudioAccountCookie(value ?? "", secret) : null;
}

export function createGuestIdentityCookie(identity: string, secret: string): string {
  if (!/^[a-f0-9-]{16,80}$/i.test(identity)) throw new Error("Invalid anonymous identity.");
  const signed = signature(identity, secret);
  if (!signed) throw new Error("Anonymous identity signing is not configured.");
  return `${identity}.${signed}`;
}

export function readGuestIdentityCookie(value: string, secret: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const identity = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  if (!/^[a-f0-9-]{16,80}$/i.test(identity)) return null;
  return signaturesMatch(provided, signature(identity, secret)) ? identity : null;
}

export function createGuestUsageCookie(
  input: { date: string; count: number; identity: string },
  secret: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid quota date.");
  if (!Number.isInteger(input.count) || input.count < 0 || input.count > 10_000) throw new Error("Invalid quota count.");
  if (!/^[a-f0-9-]{16,80}$/i.test(input.identity)) throw new Error("Invalid anonymous identity.");
  const payload = `${input.identity}.${input.date}.${input.count}`;
  const signed = signature(payload, secret);
  if (!signed) throw new Error("Guest quota signing is not configured.");
  return `${input.date}.${input.count}.${signed}`;
}

export function readGuestUsageCookie(
  value: string,
  input: { date: string; identity: string; secret: string },
): number {
  const [date, countText, provided, ...rest] = value.split(".");
  if (rest.length || date !== input.date || !/^\d+$/.test(countText ?? "")) return 0;
  const count = Number(countText);
  if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) return 0;
  const expected = signature(`${input.identity}.${date}.${count}`, input.secret);
  return signaturesMatch(provided ?? "", expected) ? count : 0;
}

export function resolveGuestAccess(input: {
  identityCookie?: string;
  usageCookie?: string;
  date: string;
  env?: EnvLike;
  createIdentity?: () => string;
}) {
  const secret = resolveGuestCookieSecret(input.env);
  if (!secret) {
    return { configured: false as const, identity: null, identityCookie: null, used: 0, secret: "" };
  }
  const existing = readGuestIdentityCookie(input.identityCookie ?? "", secret);
  const identity = existing ?? (input.createIdentity ?? randomUUID)();
  const identityCookie = existing ? null : createGuestIdentityCookie(identity, secret);
  const used = readGuestUsageCookie(input.usageCookie ?? "", {
    date: input.date,
    identity,
    secret,
  });
  return { configured: true as const, identity, identityCookie, used, secret };
}

export function accessMetadata(input: {
  tier: WorkingAccessTier;
  used: number;
  account?: StudioAccount | null;
  projectSyncAvailable?: boolean;
}) {
  const usesPlatformAi = input.tier === "guest" || input.tier === "member";
  const limit = input.tier === "member" ? MEMBER_DAILY_LIMIT : GUEST_DAILY_LIMIT;
  const remaining = Math.max(0, limit - Math.max(0, input.used));
  const authenticated = Boolean(input.account);
  return {
    tier: input.tier,
    authenticated,
    platformAi: usesPlatformAi
      ? { available: true, limit, remaining, reset: "daily-utc" as const }
      : { available: false, limit: null, remaining: null, reset: null },
    localCompiler: { available: true, limit: null },
    byok: {
      available: true,
      billingOwner: "user" as const,
      providers: ["openrouter", "openai", "anthropic", "kimi", "custom"],
      consumerAccountLogin: false,
    },
    account: input.account
      ? {
          available: true,
          connected: true,
          provider: input.account.provider,
          projectSync: Boolean(input.projectSyncAvailable),
          note: input.projectSyncAvailable
            ? "Private cloud project sync is configured. Compiled HTML and model keys remain outside cloud storage."
            : "Member AI access is active. Projects remain browser-local while private cloud storage is unavailable.",
        }
      : {
          available: true,
          connected: false,
          provider: "openrouter" as const,
          projectSync: false,
          note: "Continue with OpenRouter to unlock the signed-in daily AI allowance. API keys remain session-only.",
        },
    pro: {
      available: false,
      reason: "Billing, subscription webhooks and paid entitlements are not configured.",
    },
  };
}
