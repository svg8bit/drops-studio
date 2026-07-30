import { NextRequest } from "next/server.js";

import { sendTelegramLoginCode } from "@/lib/telegram-account";
import {
  readTelegramAccountJson,
  telegramAccountJson,
  telegramAccountRequestErrorResponse,
} from "@/lib/telegram-account-request";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await readTelegramAccountJson(request);
  } catch (error) {
    return telegramAccountRequestErrorResponse(error);
  }
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.replace(/[\s()-]/g, "") : "";
  if (!/^\+\d{7,15}$/.test(phoneNumber)) {
    return telegramAccountJson({ error: "Enter a valid Telegram phone number with country code." }, 400);
  }
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-login", max: 3, windowMs: 60 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return telegramAccountJson({ error: "Too many Telegram sign-in attempts. Try again later." }, 429);
  if (limit === "unavailable") return telegramAccountJson({ error: "Secure Telegram sign-in is temporarily unavailable." }, 503);
  try {
    const result = await sendTelegramLoginCode(phoneNumber);
    return telegramAccountJson(result);
  } catch (error) {
    return telegramAccountJson({ error: error instanceof Error ? error.message : "Telegram sign-in could not start." }, 422);
  }
}
