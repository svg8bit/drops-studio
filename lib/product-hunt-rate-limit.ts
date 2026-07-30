import { consumeRequestLimit } from "./request-rate-limit.ts";

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
}

const schema = `CREATE TABLE IF NOT EXISTS product_hunt_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)`;

async function hashBucket(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function validLimitOptions(options: {
  identity: string;
  namespace: string;
  max: number;
  windowMs: number;
}): boolean {
  return typeof options.identity === "string"
    && options.identity.trim().length > 0
    && options.identity.length <= 512
    && typeof options.namespace === "string"
    && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(options.namespace)
    && Number.isSafeInteger(options.max)
    && options.max > 0
    && Number.isSafeInteger(options.windowMs)
    && options.windowMs > 0;
}

export async function consumeProductHuntRequestLimit(options: {
  identity: string;
  namespace: string;
  max: number;
  windowMs: number;
}): Promise<"allowed" | "limited" | "unavailable"> {
  if (!validLimitOptions(options)) return "unavailable";
  const db = globalThis.__DROPS_STUDIO_ENV__?.DB;
  if (!db) return consumeRequestLimit(options);

  const now = Date.now();
  const bucket = Math.floor(now / options.windowMs);
  const expiresAt = (bucket + 1) * options.windowMs;
  const key = await hashBucket(`${options.namespace}:${bucket}:${options.identity}`);
  try {
    await db.prepare(schema).run();
    await db.prepare("DELETE FROM product_hunt_rate_limits WHERE expires_at <= ?").bind(now).run();
    const row = await db.prepare(
      `INSERT INTO product_hunt_rate_limits (bucket_key, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1, expires_at = excluded.expires_at
       RETURNING count`,
    ).bind(key, expiresAt).first<{ count: number }>();
    if (!row) return "unavailable";
    return Number(row.count) > options.max ? "limited" : "allowed";
  } catch {
    return "unavailable";
  }
}
