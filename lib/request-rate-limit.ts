import type { NextRequest } from "next/server.js";

declare global {
  var __DROPS_STUDIO_LOCAL_RATE_LIMITS__: Map<string, { count: number; expiresAt: number }> | undefined;
}

function trustedAddress(value: string | null): string | null {
  const address = value?.trim() ?? "";
  if (!address || address.length > 64) return null;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && !/^[a-f0-9:]+$/i.test(address)) return null;
  return address;
}
function rightmostAddress(value: string | null): string | null {
  const addresses = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return trustedAddress(addresses.at(-1) ?? null);
}

export function requestIdentity(request: NextRequest): string | null {
  const address = trustedAddress(request.headers.get("cf-connecting-ip"))
    ?? rightmostAddress(request.headers.get("x-vercel-forwarded-for"))
    ?? trustedAddress((request as NextRequest & { ip?: string }).ip ?? null)
    ?? rightmostAddress(request.headers.get("x-forwarded-for"));
  if (address) return `ip:${address}`;
  const session = request.headers.get("x-drops-session")?.trim() ?? "";
  return /^[a-f0-9-]{16,64}$/i.test(session) ? `session:${session}` : null;
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function localProjectStoreEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

export type RequestLimitStatus = "allowed" | "limited" | "unavailable";

export interface RequestLimitState {
  status: RequestLimitStatus;
  count: number | null;
  remaining: number | null;
}

type RequestLimitOptions = {
  identity: string | null;
  namespace: string;
  max: number;
  windowMs: number;
};

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;
type BlobAccess = "private" | "public";

function unavailableState(): RequestLimitState {
  return { status: "unavailable", count: null, remaining: null };
}

function countedState(count: number, max: number, limited = count > max): RequestLimitState {
  return {
    status: limited ? "limited" : "allowed",
    count,
    remaining: Math.max(0, max - count),
  };
}

function retryDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(160, 20 * 2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function cleanupLocalLimits(now: number): Map<string, { count: number; expiresAt: number }> {
  const limits = globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ ??= new Map();
  for (const [storedKey, stored] of limits) {
    if (stored.expiresAt <= now) limits.delete(storedKey);
  }
  return limits;
}

function localLimitKey(options: {
  identity: string;
  namespace: string;
  windowMs: number;
}, now: number): string {
  return `${options.namespace}:${Math.floor(now / options.windowMs)}:${options.identity}`;
}

function consumeLocalRequestLimit(options: RequestLimitOptions & { identity: string }): RequestLimitState {
  const now = Date.now();
  const bucket = Math.floor(now / options.windowMs);
  const key = localLimitKey(options, now);
  const limits = cleanupLocalLimits(now);

  const current = limits.get(key);
  const count = (current?.count ?? 0) + 1;
  limits.set(key, { count, expiresAt: (bucket + 1) * options.windowMs });
  return countedState(count, options.max);
}

function readLocalRequestLimit(options: RequestLimitOptions & { identity: string }): RequestLimitState {
  const now = Date.now();
  const count = cleanupLocalLimits(now).get(localLimitKey(options, now))?.count ?? 0;
  return countedState(count, options.max, count >= options.max);
}

function durableBackendConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)),
  );
}

async function blobStorage(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

function validStoredState(value: unknown): { count: number; windowEndsAt: number } | null {
  if (!value || typeof value !== "object") return null;
  const { count, windowEndsAt } = value as { count?: unknown; windowEndsAt?: unknown };
  if (!Number.isSafeInteger(count) || Number(count) < 0) return null;
  if (!Number.isSafeInteger(windowEndsAt) || Number(windowEndsAt) <= 0) return null;
  return { count: Number(count), windowEndsAt: Number(windowEndsAt) };
}

async function blobPathname(
  options: RequestLimitOptions & { identity: string },
  access: BlobAccess,
): Promise<string> {
  // Preserve the original private-store key so an active limiter window is
  // never reset during rollout. Public-store compatibility uses a peppered key
  // so the object pathname cannot disclose or make an identity-derived key
  // guessable.
  const pepper = process.env.DROPS_ACCOUNT_IDENTITY_PEPPER
    || process.env.DROPS_GUEST_COOKIE_SECRET
    || "";
  const identityKey = `${options.namespace}:${options.identity}`;
  const key = await shortHash(access === "public" ? `${pepper}:${identityKey}` : identityKey);
  return `drops-studio/rate-limit/${options.namespace}/${key}.json`;
}

async function storedBlobCount(
  storage: BlobStorage,
  pathname: string,
  access: BlobAccess,
): Promise<{ count: number; windowEndsAt: number; etag: string } | null> {
  const current = await storage.get(pathname, { access, useCache: false });
  if (!current) return null;
  if (current.statusCode !== 200) throw new Error("Rate-limit state could not be read.");
  const parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
  const state = validStoredState(parsed);
  if (!state || !current.blob.etag) throw new Error("Rate-limit state is invalid.");
  return { ...state, etag: current.blob.etag };
}

export async function consumeRequestLimitState(
  options: RequestLimitOptions,
  storageOverride?: BlobStorage,
): Promise<RequestLimitState> {
  if (!options.identity) return unavailableState();
  if (!storageOverride && localProjectStoreEnabled()) {
    return consumeLocalRequestLimit({ ...options, identity: options.identity });
  }
  if (!storageOverride && !durableBackendConfigured()) {
    return process.env.VERCEL || process.env.NODE_ENV === "production"
      ? unavailableState()
      : { status: "allowed", count: null, remaining: null };
  }
  try {
    const storage = await blobStorage(storageOverride);
    const pathnameOptions = { ...options, identity: options.identity };
    const pathnames: Record<BlobAccess, string> = {
      private: await blobPathname(pathnameOptions, "private"),
      public: await blobPathname(pathnameOptions, "public"),
    };
    // Blob access is fixed at store creation time. Existing Drops Studio
    // installations may use the original public publication store, while new
    // installations can use a private store. Alternate access modes so both
    // configurations retain the same atomic limiter contract.
    // A public fallback store rejects private reads, while a private store
    // rejects public reads. Keep both modes backward compatible, but allow six
    // real attempts for either store. Each attempt re-reads the authoritative
    // ETag before writing, so transient Blob failures and concurrent CAS
    // conflicts cannot turn an otherwise valid build into an intermittent 503.
    const accessAttempts: BlobAccess[] = Array.from(
      { length: 6 },
      () => ["private", "public"] satisfies BlobAccess[],
    ).flat();
    for (const [attemptIndex, access] of accessAttempts.entries()) {
      const pathname = pathnames[access];
      let current: Awaited<ReturnType<typeof storedBlobCount>>;
      try {
        current = await storedBlobCount(storage, pathname, access);
      } catch {
        if (attemptIndex % 2 === 1 && attemptIndex < accessAttempts.length - 1) {
          await retryDelay(Math.floor(attemptIndex / 2));
        }
        continue;
      }
      const now = Date.now();
      const windowEndsAt = (Math.floor(now / options.windowMs) + 1) * options.windowMs;
      if (!current) {
        try {
          await storage.put(pathname, JSON.stringify({ count: 1, windowEndsAt }), {
            access,
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
            contentType: "application/json; charset=utf-8",
          });
          return countedState(1, options.max);
        } catch {
          if (attemptIndex % 2 === 1 && attemptIndex < accessAttempts.length - 1) {
            await retryDelay(Math.floor(attemptIndex / 2));
          }
          continue;
        }
      }
      const expired = current.windowEndsAt <= now;
      const count = expired ? 1 : current.count + 1;
      try {
        await storage.put(pathname, JSON.stringify({ count, windowEndsAt: expired ? windowEndsAt : current.windowEndsAt }), {
          access,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ifMatch: current.etag,
        });
        return countedState(count, options.max);
      } catch {
        if (attemptIndex % 2 === 1 && attemptIndex < accessAttempts.length - 1) {
          await retryDelay(Math.floor(attemptIndex / 2));
        }
        continue;
      }
    }
  } catch {
    return unavailableState();
  }
  return unavailableState();
}

export async function readRequestLimitState(
  options: RequestLimitOptions,
  storageOverride?: BlobStorage,
): Promise<RequestLimitState> {
  if (!options.identity) return unavailableState();
  if (!storageOverride && localProjectStoreEnabled()) {
    return readLocalRequestLimit({ ...options, identity: options.identity });
  }
  if (!storageOverride && !durableBackendConfigured()) return unavailableState();
  try {
    const storage = await blobStorage(storageOverride);
    const pathnameOptions = { ...options, identity: options.identity };
    for (const access of ["private", "public"] satisfies BlobAccess[]) {
      try {
        const pathname = await blobPathname(pathnameOptions, access);
        const current = await storedBlobCount(storage, pathname, access);
        const count = current && current.windowEndsAt > Date.now() ? current.count : 0;
        return countedState(count, options.max, count >= options.max);
      } catch {
        continue;
      }
    }
    return unavailableState();
  } catch {
    return unavailableState();
  }
}

export async function consumeRequestLimit(options: RequestLimitOptions): Promise<RequestLimitStatus> {
  return (await consumeRequestLimitState(options)).status;
}
