import { NextResponse } from "next/server.js";

import { platformCapabilitySnapshotWithHealth } from "@/lib/platform-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await platformCapabilitySnapshotWithHealth(), {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      vary: "Cookie",
    },
  });
}
