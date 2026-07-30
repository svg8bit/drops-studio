import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";

import type { ProjectRuntimeAdapter } from "../../../../lib/project-runtime-adapter.ts";
import { VercelSandboxRuntimeAdapter } from "../../../../lib/vercel-sandbox-runtime-adapter.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
};

interface CleanupRouteDependencies {
  runtime?: Pick<ProjectRuntimeAdapter, "cleanupIdle">;
  env?: Partial<Record<
    "CRON_SECRET" | "DROPS_STUDIO_SANDBOX_IDLE_MINUTES" | "NODE_ENV",
    string | undefined
  >>;
  now?: () => Date;
}

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function matchesSecret(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function idleMinutes(env: CleanupRouteDependencies["env"]): number {
  const value = Number(env?.DROPS_STUDIO_SANDBOX_IDLE_MINUTES ?? 20);
  return Number.isSafeInteger(value) && value >= 5 && value <= 240 ? value : 20;
}

export async function handleBuilderCleanupRequest(
  request: NextRequest,
  dependencies: CleanupRouteDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!secret || (env.NODE_ENV === "production" && secret.length < 32)) {
    return response(
      {
        code: "BUILDER_CLEANUP_UNAVAILABLE",
        error: "Sandbox cleanup authorization is not configured.",
      },
      503,
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!matchesSecret(authorization, `Bearer ${secret}`)) {
    return response(
      { code: "BUILDER_CLEANUP_UNAUTHORIZED", error: "Unauthorized." },
      401,
    );
  }
  try {
    const minutes = idleMinutes(env);
    const now = dependencies.now?.() ?? new Date();
    const adapter = dependencies.runtime ?? new VercelSandboxRuntimeAdapter();
    const result = await adapter.cleanupIdle({
      idleBefore: new Date(now.getTime() - minutes * 60_000),
      limit: 100,
    });
    return response({
      idleMinutes: minutes,
      inspected: result.inspected,
      stopped: result.stopped,
      failed: result.failed,
      completedAt: now.toISOString(),
    });
  } catch {
    return response(
      {
        code: "BUILDER_CLEANUP_FAILED",
        error: "Idle Sandbox cleanup could not be completed.",
      },
      503,
    );
  }
}

export async function GET(request: NextRequest) {
  return handleBuilderCleanupRequest(request);
}

export async function POST(request: NextRequest) {
  return handleBuilderCleanupRequest(request);
}
