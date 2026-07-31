import { NextRequest } from "next/server.js";

import { signInTelegramAccount } from "@/lib/telegram-account";
import {
  readTelegramAccountJson,
  telegramAccountJson,
  telegramAccountRequestErrorResponse,
} from "@/lib/telegram-account-request";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";
import { saveStudioConnection } from "@/db/studio-account-state";
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
  const flowToken = typeof body?.flowToken === "string" ? body.flowToken : "";
  const phoneCode = typeof body?.phoneCode === "string" ? body.phoneCode.trim() : "";
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!flowToken) return telegramAccountJson({ error: "Request a Telegram code first." }, 400);
  if (!/^\d{3,8}$/.test(phoneCode)) return telegramAccountJson({ error: "Enter the numeric code Telegram sent you." }, 400);
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-code", max: 8, windowMs: 15 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return telegramAccountJson({ error: "Too many Telegram code attempts. Request a new code later." }, 429);
  if (limit === "unavailable") return telegramAccountJson({ error: "Secure Telegram sign-in is temporarily unavailable." }, 503);
  try {
    const result = await signInTelegramAccount(flowToken, phoneCode, password);
    const account = resolveStudioAccount(
      request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    );
    if (account && "accountToken" in result && typeof result.accountToken === "string") {
      await saveStudioConnection(account.identity, {
        provider: "telegram",
        credential: result.accountToken,
        label: "Telegram account session",
      }).catch(() => undefined);
    }
    return telegramAccountJson(result);
  } catch (error) {
    return telegramAccountJson({ error: error instanceof Error ? error.message : "Telegram sign-in failed." }, 422);
  }
}
