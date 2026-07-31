import { NextRequest, NextResponse } from "next/server.js";
import { createHash, timingSafeEqual } from "node:crypto";

import { runPlatformProviderHealthChecks } from "@/lib/platform-provider-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authorized(request: NextRequest): boolean {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return false;
  const secrets = [
    process.env.CRON_SECRET?.trim(),
    process.env.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));
  const presented = digest(authorization);
  return secrets.some((secret) => timingSafeEqual(
    presented,
    digest(`Bearer ${secret}`),
  ));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Platform health authorization is required." },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  const receipt = await runPlatformProviderHealthChecks();
  return NextResponse.json(receipt, {
    headers: { "cache-control": "private, no-store" },
  });
}

export const POST = GET;
