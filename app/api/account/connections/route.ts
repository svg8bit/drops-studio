import { NextRequest, NextResponse } from "next/server.js";

import {
  deleteStudioConnection,
  saveStudioConnection,
  StudioAccountStateUnavailableError,
} from "@/db/studio-account-state";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import { consumeRequestLimit, requestIdentity } from "@/lib/request-rate-limit";
import {
  connectionVaultConfigured,
  isStudioConnectionProvider,
  publicConnectionStatuses,
} from "@/lib/studio-account-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 40 * 1_024;

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "cache-control": "no-store" } });
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "")
      || request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    const parsedOrigin = new URL(origin).origin;
    return parsedOrigin === request.nextUrl.origin || parsedOrigin === visibleOrigin;
  } catch {
    return false;
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function account(request: NextRequest) {
  return resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
}

export async function PUT(request: NextRequest) {
  const actor = account(request);
  if (!actor) return response({ error: "Sign in to remember this connection." }, 401);
  if (!sameOrigin(request)) return response({ error: "Cross-origin connection storage rejected." }, 403);
  if (!connectionVaultConfigured()) return response({ error: "Encrypted connection vault is not configured." }, 503);
  const limit = await consumeRequestLimit({
    identity: requestIdentity(request),
    namespace: "account-connection-write",
    max: 20,
    windowMs: 10 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") return response({ error: "Too many connection changes. Try again later." }, 429);
  if (limit === "unavailable" && process.env.NODE_ENV === "production") {
    return response({ error: "Connection write protection is temporarily unavailable." }, 503);
  }
  const input = await body(request);
  if (!input || !isStudioConnectionProvider(input.provider) || typeof input.credential !== "string") {
    return response({ error: "Connection payload is invalid." }, 400);
  }
  try {
    const state = await saveStudioConnection(actor.identity, {
      provider: input.provider,
      credential: input.credential,
      ...(typeof input.model === "string" ? { model: input.model } : {}),
      ...(typeof input.endpoint === "string" ? { endpoint: input.endpoint } : {}),
      ...(typeof input.label === "string" ? { label: input.label } : {}),
    });
    return response({ saved: true, connections: publicConnectionStatuses(state) });
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : "Connection could not be stored." },
      error instanceof StudioAccountStateUnavailableError ? 503 : 400,
    );
  }
}

export async function DELETE(request: NextRequest) {
  const actor = account(request);
  if (!actor) return response({ error: "Sign in to change remembered connections." }, 401);
  if (!sameOrigin(request)) return response({ error: "Cross-origin connection storage rejected." }, 403);
  const provider = request.nextUrl.searchParams.get("provider");
  if (!isStudioConnectionProvider(provider)) return response({ error: "Connection provider is invalid." }, 400);
  try {
    const state = await deleteStudioConnection(actor.identity, provider);
    return response({ deleted: true, connections: publicConnectionStatuses(state) });
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : "Connection could not be removed." },
      error instanceof StudioAccountStateUnavailableError ? 503 : 400,
    );
  }
}
