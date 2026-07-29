import { NextRequest, NextResponse } from "next/server";
import { fetchDropsTabCoins } from "@/lib/dropstab-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = request.headers.get("x-dropstab-api-key")?.trim();
  if (!key) return NextResponse.json({ error: "A DropsTab API key is required." }, { status: 401 });

  try {
    const coins = await fetchDropsTabCoins(key, { mode: "byok", pageSize: 10 });
    return NextResponse.json({
      coins,
      source: "DropsTab Public API · user refresh",
      data: { mode: "byok", automaticPolling: false },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DropsTab is temporarily unreachable.";
    const status = /rejected this API key/i.test(message) ? 401 : /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: `${message} The builder remains available in sample-data mode.` }, { status });
  }
}
