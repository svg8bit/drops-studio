import { NextRequest } from "next/server.js";

import { inspectTelegramAccountToken } from "@/lib/telegram-account";
import {
  readTelegramAccountJson,
  telegramAccountJson,
  telegramAccountRequestErrorResponse,
} from "@/lib/telegram-account-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await readTelegramAccountJson(request);
  } catch (error) {
    return telegramAccountRequestErrorResponse(error);
  }
  const token = typeof body?.accountToken === "string" ? body.accountToken : "";
  if (!token) return telegramAccountJson({ connected: false });
  try {
    return telegramAccountJson({ connected: true, account: inspectTelegramAccountToken(token) });
  } catch {
    return telegramAccountJson({ connected: false });
  }
}
