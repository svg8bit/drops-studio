import type { NextRequest } from "next/server.js";

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

export async function consumeRequestLimit(options: {
  identity: string | null;
  namespace: string;
  max: number;
  windowMs: number;
}): Promise<"allowed" | "limited" | "unavailable"> {
  if (!options.identity) return "unavailable";
  if (!process.env.BLOB_READ_WRITE_TOKEN && !(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)) {
    return process.env.VERCEL || process.env.NODE_ENV === "production" ? "unavailable" : "allowed";
  }
  const { get, put } = await import("@vercel/blob");
  const now = Date.now();
  const bucket = Math.floor(now / options.windowMs);
  const key = await shortHash(`${options.namespace}:${options.identity}`);
  const pathname = `drops-studio/rate-limit/${options.namespace}/${bucket}/${key}.json`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await get(pathname, { access: "private", useCache: false });
    if (!current) {
      try {
        await put(pathname, JSON.stringify({ count: 1 }), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
        });
        return "allowed";
      } catch {
        continue;
      }
    }
    if (current.statusCode !== 200) continue;
    const stored = JSON.parse(await new Response(current.stream).text()) as { count?: unknown };
    const count = Math.max(0, Number(stored.count) || 0) + 1;
    try {
      await put(pathname, JSON.stringify({ count }), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
        ifMatch: current.blob.etag,
      });
      return count > options.max ? "limited" : "allowed";
    } catch {
      continue;
    }
  }
  return "unavailable";
}
