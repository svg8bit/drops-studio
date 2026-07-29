import { NextRequest, NextResponse } from "next/server.js";

import { inspectTelegramAccountToken } from "@/lib/telegram-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { accountToken?: unknown } | null;
  const token = typeof body?.accountToken === "string" ? body.accountToken : "";
  if (!token) return NextResponse.json({ connected: false });
  try {
    return NextResponse.json({ connected: true, account: inspectTelegramAccountToken(token) }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ connected: false }, { headers: { "cache-control": "no-store, max-age=0" } });
  }
}
