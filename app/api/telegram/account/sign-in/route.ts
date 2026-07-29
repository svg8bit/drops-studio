import { NextRequest, NextResponse } from "next/server.js";

import { signInTelegramAccount } from "@/lib/telegram-account";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { flowToken?: unknown; phoneCode?: unknown; password?: unknown } | null;
  const flowToken = typeof body?.flowToken === "string" ? body.flowToken : "";
  const phoneCode = typeof body?.phoneCode === "string" ? body.phoneCode.trim() : "";
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!flowToken) return NextResponse.json({ error: "Request a Telegram code first." }, { status: 400 });
  if (!/^\d{3,8}$/.test(phoneCode)) return NextResponse.json({ error: "Enter the numeric code Telegram sent you." }, { status: 400 });
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-code", max: 8, windowMs: 15 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return NextResponse.json({ error: "Too many Telegram code attempts. Request a new code later." }, { status: 429 });
  if (limit === "unavailable") return NextResponse.json({ error: "Secure Telegram sign-in is temporarily unavailable." }, { status: 503 });
  try {
    const result = await signInTelegramAccount(flowToken, phoneCode, password);
    return NextResponse.json(result, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram sign-in failed." }, { status: 422, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
