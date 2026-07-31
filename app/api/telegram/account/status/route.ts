import { NextRequest } from "next/server.js";

import { inspectTelegramAccountToken } from "@/lib/telegram-account";
import { readStudioConnectionSecret } from "@/db/studio-account-state";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
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
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  const remembered = account
    ? await readStudioConnectionSecret(account.identity, "telegram").catch(() => null)
    : null;
  const token = (typeof body?.accountToken === "string" ? body.accountToken : "")
    || remembered?.credential
    || "";
  if (!token) return telegramAccountJson({ connected: false, remembered: false });
  try {
    return telegramAccountJson({
      connected: true,
      remembered: Boolean(remembered),
      account: inspectTelegramAccountToken(token),
    });
  } catch {
    return telegramAccountJson({ connected: false, remembered: false });
  }
}
