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
  const suppliedToken = typeof body?.accountToken === "string"
    ? body.accountToken
    : "";
  const usesRememberedCredential = !suppliedToken && Boolean(remembered?.credential);
  const token = suppliedToken
    || remembered?.credential
    || "";
  if (!token) return telegramAccountJson({ connected: false, remembered: false });
  try {
    const inspected = inspectTelegramAccountToken(token);
    const receipt = remembered?.telegramReceipt;
    const receiptMatchesAccount = receipt?.accountId
      ? receipt.accountId === inspected.id
      : usesRememberedCredential;
    return telegramAccountJson({
      connected: true,
      remembered: Boolean(remembered),
      account: inspected,
      ...(receipt && receiptMatchesAccount
        ? { channel: receipt }
        : {}),
    });
  } catch {
    return telegramAccountJson({ connected: false, remembered: false });
  }
}
