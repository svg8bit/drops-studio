import { NextRequest, NextResponse } from "next/server.js";
import { createHash } from "node:crypto";

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
  durableProjectDataPostgresConfigured,
  neonProjectDataSqlClient,
  type ProjectDataSqlClient,
} from "@/lib/project-data/durable-backend";
import {
  connectionVaultConfigured,
  isStudioConnectionProvider,
  publicConnectionStatuses,
} from "@/lib/studio-account-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 40 * 1_024;
const CONNECTION_WRITE_LIMIT = 20;
const CONNECTION_WRITE_WINDOW_MS = 10 * 60 * 1_000;
const CONNECTION_RATE_LIMIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS drops_studio_account_connection_limits (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT drops_studio_account_connection_limit_count
      CHECK (request_count > 0)
  )
`;

let connectionRateSqlClientPromise: Promise<ProjectDataSqlClient> | null = null;
let connectionRateSchemaPromise: Promise<void> | null = null;

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

async function consumePostgresConnectionWriteLimit(
  accountIdentity: string,
): Promise<"allowed" | "limited" | "unavailable"> {
  if (!durableProjectDataPostgresConfigured()) return "unavailable";
  try {
    connectionRateSqlClientPromise ??= neonProjectDataSqlClient();
    const client = await connectionRateSqlClientPromise;
    connectionRateSchemaPromise ??= client
      .query(CONNECTION_RATE_LIMIT_SCHEMA)
      .then(() => undefined);
    try {
      await connectionRateSchemaPromise;
    } catch {
      connectionRateSchemaPromise = null;
      throw new Error("Connection limiter schema unavailable.");
    }
    const windowId = Math.floor(Date.now() / CONNECTION_WRITE_WINDOW_MS);
    const bucketKey = createHash("sha256")
      .update(`account-connection-write:${accountIdentity}:${windowId}`, "utf8")
      .digest("hex");
    const windowEndsAt = (windowId + 1) * CONNECTION_WRITE_WINDOW_MS;
    const result = await client.query(
      `WITH pruned AS (
         DELETE FROM drops_studio_account_connection_limits
         WHERE expires_at < NOW() - INTERVAL '1 hour'
       ), counted AS (
         INSERT INTO drops_studio_account_connection_limits
           (bucket_key, request_count, expires_at)
         VALUES ($1, 1, to_timestamp($2 / 1000.0))
         ON CONFLICT (bucket_key) DO UPDATE SET
           request_count = drops_studio_account_connection_limits.request_count + 1,
           expires_at = EXCLUDED.expires_at
         RETURNING request_count
       )
       SELECT request_count FROM counted`,
      [bucketKey, windowEndsAt],
    );
    const row = result.rows[0] as { request_count?: unknown } | undefined;
    const count = Number(row?.request_count);
    if (!Number.isSafeInteger(count) || count < 1) return "unavailable";
    return count > CONNECTION_WRITE_LIMIT ? "limited" : "allowed";
  } catch {
    return "unavailable";
  }
}

async function consumeConnectionWriteLimit(
  request: NextRequest,
  accountIdentity: string,
): Promise<"allowed" | "limited" | "unavailable"> {
  const primary = await consumeRequestLimit({
    identity: requestIdentity(request),
    namespace: "account-connection-write",
    max: CONNECTION_WRITE_LIMIT,
    windowMs: CONNECTION_WRITE_WINDOW_MS,
  }).catch(() => "unavailable" as const);
  return primary === "unavailable"
    ? consumePostgresConnectionWriteLimit(accountIdentity)
    : primary;
}

export async function PUT(request: NextRequest) {
  const actor = account(request);
  if (!actor) return response({ error: "Sign in to remember this connection." }, 401);
  if (!sameOrigin(request)) return response({ error: "Cross-origin connection storage rejected." }, 403);
  if (!connectionVaultConfigured()) return response({ error: "Encrypted connection vault is not configured." }, 503);
  const limit = await consumeConnectionWriteLimit(request, actor.identity);
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
