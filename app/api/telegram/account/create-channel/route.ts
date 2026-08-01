import { NextRequest } from "next/server.js";

import {
  createTelegramChannel,
  inspectTelegramAccountToken,
} from "@/lib/telegram-account";
import {
  readTelegramAccountJson,
  telegramAccountJson,
  telegramAccountRequestErrorResponse,
} from "@/lib/telegram-account-request";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";
import {
  readStudioConnectionSecret,
  saveStudioConnection,
} from "@/db/studio-account-state";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await readTelegramAccountJson(request);
  } catch (error) {
    return telegramAccountRequestErrorResponse(error);
  }
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  const remembered = account
    ? await readStudioConnectionSecret(account.identity, "telegram").catch(() => null)
    : null;
  const accountToken = (typeof body?.accountToken === "string" ? body.accountToken : "")
    || remembered?.credential
    || "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!accountToken) return telegramAccountJson({ error: "Connect your Telegram account first." }, 400);
  if (!/^[a-f0-9-]{16,64}$/i.test(requestId)) return telegramAccountJson({ error: "Start a fresh channel creation request." }, 400);
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-channel", max: 5, windowMs: 60 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return telegramAccountJson({ error: "Too many channel creation attempts. Try again later." }, 429);
  if (limit === "unavailable") return telegramAccountJson({ error: "Secure channel creation is temporarily unavailable." }, 503);
  try {
    const result = await createTelegramChannel({
      accountToken,
      requestId,
      title: typeof body?.title === "string" ? body.title : "",
      about: typeof body?.about === "string" ? body.about : "",
      username: typeof body?.username === "string" ? body.username : undefined,
      firstPost: typeof body?.firstPost === "string" ? body.firstPost : "",
      botToken: typeof body?.botToken === "string" ? body.botToken : undefined,
    });
    let remembered = false;
    if (account) {
      try {
        await saveStudioConnection(account.identity, {
          provider: "telegram",
          credential: result.accountToken,
          label: "Telegram account session",
          telegramReceipt: {
            accountId: inspectTelegramAccountToken(result.accountToken).id,
            id: result.id,
            title: result.title,
            ...(result.username ? { username: result.username } : {}),
            url: result.url,
            botUsername: result.botUsername,
            botAdded: true,
            firstPostSent: true,
            firstPostMessageId: result.firstPostMessageId,
            dmSent: result.dmSent,
            dmStartUrl: result.dmStartUrl,
            warnings: result.warnings,
            createdAt: new Date().toISOString(),
          },
        });
        remembered = true;
      } catch (error) {
        console.warn(
          "[telegram-account] rotated session persistence unavailable",
          error instanceof Error ? error.name : "unknown",
        );
      }
    }
    return telegramAccountJson({
      ...result,
      accountPersistence: {
        available: Boolean(account),
        remembered,
      },
    });
  } catch (error) {
    console.error("Telegram channel creation failed.", error);
    return telegramAccountJson({
      error: "Telegram could not create the channel. Check the connected account, bot, and channel details before retrying.",
    }, 422);
  }
}
