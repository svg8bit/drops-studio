import { NextRequest, NextResponse } from "next/server.js";

import { createTelegramChannel } from "@/lib/telegram-account";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const accountToken = typeof body?.accountToken === "string" ? body.accountToken : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!accountToken) return NextResponse.json({ error: "Connect your Telegram account first." }, { status: 400 });
  if (!/^[a-f0-9-]{16,64}$/i.test(requestId)) return NextResponse.json({ error: "Start a fresh channel creation request." }, { status: 400 });
  const limit = await consumeRequestLimit({ identity: requestIdentity(request), namespace: "telegram-channel", max: 5, windowMs: 60 * 60 * 1_000 }).catch(() => "unavailable" as const);
  if (limit === "limited") return NextResponse.json({ error: "Too many channel creation attempts. Try again later." }, { status: 429 });
  if (limit === "unavailable") return NextResponse.json({ error: "Secure channel creation is temporarily unavailable." }, { status: 503 });
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
    return NextResponse.json(result, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Telegram channel creation failed." }, { status: 422, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
