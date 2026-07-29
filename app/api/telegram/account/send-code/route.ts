import { NextRequest, NextResponse } from "next/server.js";

import { sendTelegramLoginCode } from "@/lib/telegram-account";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { phoneNumber?: unknown } | null;
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.replace(/[\s()-]/g, "") : "";
  if (!/^\+\d{7,15}$/.test(phoneNumber)) {
    return NextResponse.json({ error: "Enter a valid Telegram phone number with country code." }, { status: 400 });
  }
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-login", max: 3, windowMs: 60 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return NextResponse.json({ error: "Too many Telegram sign-in attempts. Try again later." }, { status: 429 });
  if (limit === "unavailable") return NextResponse.json({ error: "Secure Telegram sign-in is temporarily unavailable." }, { status: 503 });
  try {
    const result = await sendTelegramLoginCode(phoneNumber);
    return NextResponse.json(result, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram sign-in could not start." }, { status: 422, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
