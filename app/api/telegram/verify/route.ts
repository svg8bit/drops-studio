import { NextRequest, NextResponse } from "next/server.js";

export const dynamic = "force-dynamic";

type TelegramBody = {
  token?: unknown;
  channel?: unknown;
  message?: unknown;
  sendTest?: unknown;
};

type TelegramResponse<T> = { ok?: boolean; result?: T; description?: string };

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
}

const MAX_ATTEMPTS_PER_HOUR = 12;
const RATE_LIMIT_SCHEMA = `CREATE TABLE IF NOT EXISTS telegram_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
)`;

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status });
  result.headers.set("cache-control", "no-store, max-age=0");
  result.headers.set("pragma", "no-cache");
  result.headers.set("access-control-allow-origin", "*");
  result.headers.set("access-control-allow-methods", "POST, OPTIONS");
  result.headers.set("access-control-allow-headers", "content-type, x-drops-session");
  return result;
}

function trustedAddress(value: string | null): string | null {
  const address = value?.trim() ?? "";
  if (!address || address.length > 64) return null;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && !/^[a-f0-9:]+$/i.test(address)) return null;
  return address;
}

function rightmostTrustedAddress(value: string | null): string | null {
  const addresses = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return trustedAddress(addresses.at(-1) ?? null);
}

function clientIdentity(request: NextRequest): string | null {
  const providerAddress = trustedAddress(request.headers.get("cf-connecting-ip"))
    ?? rightmostTrustedAddress(request.headers.get("x-vercel-forwarded-for"))
    ?? trustedAddress((request as NextRequest & { ip?: string }).ip ?? null)
    ?? rightmostTrustedAddress(request.headers.get("x-forwarded-for"));
  if (providerAddress) return `ip:${providerAddress}`;
  const session = request.headers.get("x-drops-session")?.trim() ?? "";
  return /^[a-f0-9-]{16,64}$/i.test(session) ? `session:${session}` : null;
}

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function blobAvailable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
}

async function identityHash(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function consumeRateLimit(identity: string): Promise<"allowed" | "limited" | "unavailable"> {
  const now = Date.now();
  const resetAt = now + 60 * 60 * 1_000;
  const key = await identityHash(identity);
  const db = database();
  if (db) {
    await db.prepare(RATE_LIMIT_SCHEMA).run();
    const row = await db.prepare(`INSERT INTO telegram_rate_limits (key, count, reset_at)
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
        reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
      RETURNING count`).bind(key, resetAt, now, now).first<{ count: number }>();
    return Number(row?.count ?? MAX_ATTEMPTS_PER_HOUR + 1) > MAX_ATTEMPTS_PER_HOUR ? "limited" : "allowed";
  }
  if (blobAvailable()) {
    const { get, put } = await import("@vercel/blob");
    const hour = Math.floor(now / (60 * 60 * 1_000));
    const pathname = `drops-studio/rate-limit/telegram/${hour}/${key}.json`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await get(pathname, { access: "public", useCache: false });
      if (!current) {
        try {
          await put(pathname, JSON.stringify({ count: 1 }), {
            access: "public",
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
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ifMatch: current.blob.etag,
        });
        return count > MAX_ATTEMPTS_PER_HOUR ? "limited" : "allowed";
      } catch {
        continue;
      }
    }
    return "unavailable";
  }
  return process.env.VERCEL || process.env.NODE_ENV === "production" ? "unavailable" : "allowed";
}

async function telegram<T>(token: string, method: string, payload: Record<string, unknown> | undefined, signal: AbortSignal): Promise<T> {
  const request = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
    signal,
  });
  const body = await request.json().catch(() => null) as TelegramResponse<T> | null;
  if (!request.ok || !body?.ok || body.result === undefined) throw new Error("Telegram rejected the bot or channel details.");
  return body.result;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as TelegramBody | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const channel = typeof body?.channel === "string" ? body.channel.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2_000) : "";
  const sendTest = body?.sendTest === true;

  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return response({ error: "Enter a valid BotFather token." }, 400);
  if (!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channel) && !/^-100\d{6,20}$/.test(channel)) {
    return response({ error: "Enter a public @channelusername or a private -100… channel ID." }, 400);
  }
  const identity = clientIdentity(request);
  if (!identity) return response({ error: "Secure client identity is missing. Retry from the Drops Studio app." }, 400);
  const limit = await consumeRateLimit(identity).catch(() => "unavailable" as const);
  if (limit === "limited") return response({ error: "Too many Telegram checks. Try again later." }, 429);
  if (limit === "unavailable") return response({ error: "Telegram verification is temporarily unavailable." }, 503);

  try {
    const signal = AbortSignal.timeout(8_000);
    const bot = await telegram<{ id: number; username?: string; first_name?: string }>(token, "getMe", undefined, signal);
    const chat = await telegram<{ id: number; title?: string; username?: string; type?: string }>(token, "getChat", { chat_id: channel }, signal);
    const membership = await telegram<{ status?: string; can_post_messages?: boolean }>(token, "getChatMember", { chat_id: chat.id, user_id: bot.id }, signal);
    const administrator = membership.status === "creator" || membership.status === "administrator";
    const canPost = administrator && membership.can_post_messages !== false;
    if (!canPost) return response({ error: "The bot is not a channel administrator with permission to post." }, 409);

    let sentMessageId: number | undefined;
    if (sendTest) {
      if (!message) return response({ error: "Add a test message before sending." }, 400);
      const sent = await telegram<{ message_id: number }>(token, "sendMessage", {
        chat_id: chat.id,
        text: message,
        disable_web_page_preview: false,
      }, signal);
      sentMessageId = sent.message_id;
    }

    return response({
      verified: true,
      sent: Boolean(sentMessageId),
      bot: { username: bot.username || bot.first_name || "Telegram bot" },
      channel: { id: String(chat.id), title: chat.title || chat.username || channel, username: chat.username ? `@${chat.username}` : undefined },
      ...(sentMessageId ? { messageId: sentMessageId } : {}),
      storage: "session-only",
    });
  } catch {
    return response({ error: "Telegram could not verify this bot and channel. Check the token, channel ID and admin permissions." }, 422);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "cache-control": "no-store, max-age=0",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-drops-session",
    },
  });
}
