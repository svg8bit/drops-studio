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
  legacyIdentity?: string | null;
  namespace: string;
  max: number;
  windowMs: number;
};

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

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
  const limits = cleanupLocalLimits(now);
  const primaryKey = localLimitKey(options, now);
  const legacyKey = options.legacyIdentity && options.legacyIdentity !== options.identity
    ? localLimitKey({ ...options, identity: options.legacyIdentity }, now)
    : null;
  const key = legacyKey && !limits.has(primaryKey) && limits.has(legacyKey)
    ? legacyKey
    : primaryKey;

  const current = limits.get(key);
  const count = (current?.count ?? 0) + 1;
  limits.set(key, { count, expiresAt: (bucket + 1) * options.windowMs });
  return countedState(count, options.max);
}

function readLocalRequestLimit(options: RequestLimitOptions & { identity: string }): RequestLimitState {
  const now = Date.now();
  const limits = cleanupLocalLimits(now);
  const primaryCount = limits.get(localLimitKey(options, now))?.count ?? 0;
  const legacyCount = options.legacyIdentity && options.legacyIdentity !== options.identity
    ? limits.get(localLimitKey({ ...options, identity: options.legacyIdentity }, now))?.count ?? 0
    : 0;
  const count = Math.max(primaryCount, legacyCount);
  return countedState(count, options.max, count >= options.max);
}

function durableBackendConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
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

async function blobPathname(options: RequestLimitOptions & { identity: string }): Promise<string> {
  const key = await shortHash(`${options.namespace}:${options.identity}`);
  return `drops-studio/rate-limit/${options.namespace}/${key}.json`;
}

async function activeStoredBlob(
  storage: BlobStorage,
  options: RequestLimitOptions & { identity: string },
): Promise<{ pathname: string; current: Awaited<ReturnType<typeof storedBlobCount>> }> {
  const primaryPath = await blobPathname(options);
  const primary = await storedBlobCount(storage, primaryPath);
  if (!options.legacyIdentity || options.legacyIdentity === options.identity) {
    return { pathname: primaryPath, current: primary };
  }
  const legacyPath = await blobPathname({ ...options, identity: options.legacyIdentity });
  const legacy = await storedBlobCount(storage, legacyPath);
  const now = Date.now();
  const primaryCount = primary && primary.windowEndsAt > now ? primary.count : 0;
  const legacyCount = legacy && legacy.windowEndsAt > now ? legacy.count : 0;
  // Existing pre-pepper counters naturally age out at the next window. Until
  // then, continue their CAS path so rollout cannot reset a paid quota.
  return legacyCount > primaryCount || (!primary && legacyCount > 0)
    ? { pathname: legacyPath, current: legacy }
    : { pathname: primaryPath, current: primary };
}

async function storedBlobCount(
  storage: BlobStorage,
  pathname: string,
): Promise<{ count: number; windowEndsAt: number; etag: string } | null> {
  const current = await storage.get(pathname, { access: "private", useCache: false });
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
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let pathname: string;
      let current: Awaited<ReturnType<typeof storedBlobCount>>;
      try {
        const active = await activeStoredBlob(storage, {
          ...options,
          identity: options.identity,
        });
        pathname = active.pathname;
        current = active.current;
      } catch {
        continue;
      }
      const now = Date.now();
      const windowEndsAt = (Math.floor(now / options.windowMs) + 1) * options.windowMs;
      if (!current) {
        try {
          await storage.put(pathname!, JSON.stringify({ count: 1, windowEndsAt }), {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
            contentType: "application/json; charset=utf-8",
          });
          return countedState(1, options.max);
        } catch {
          continue;
        }
      }
      const expired = current.windowEndsAt <= now;
      const count = expired ? 1 : current.count + 1;
      try {
        await storage.put(pathname!, JSON.stringify({ count, windowEndsAt: expired ? windowEndsAt : current.windowEndsAt }), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ifMatch: current.etag,
        });
        return countedState(count, options.max);
      } catch {
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
    const { current } = await activeStoredBlob(storage, {
      ...options,
      identity: options.identity,
    });
    const count = current && current.windowEndsAt > Date.now() ? current.count : 0;
    return countedState(count, options.max, count >= options.max);
  } catch {
    return unavailableState();
  }
}

export async function consumeRequestLimit(options: RequestLimitOptions): Promise<RequestLimitStatus> {
  return (await consumeRequestLimitState(options)).status;
}
