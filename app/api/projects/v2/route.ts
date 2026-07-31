import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";

import {
  deleteProjectV2ReleaseReceipts,
  ProjectV2ReleaseReceiptStorageUnavailableError,
} from "../../../../db/project-v2-release-receipts.ts";
import {
  deleteProjectV2Snapshot,
  PROJECT_V2_SNAPSHOT_LIMIT_BYTES,
  projectV2SnapshotStorageConfigured,
  ProjectV2SnapshotStorageUnavailableError,
  readProjectV2Snapshot,
  writeProjectV2Snapshot,
} from "../../../../db/project-v2-snapshots.ts";
import {
  GUEST_IDENTITY_COOKIE,
  resolveStudioProjectActor,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../../lib/access-tier.ts";
import { ArtifactSecretError } from "../../../../lib/artifact-security.ts";
import type { ProjectRuntimeAdapter } from "../../../../lib/project-runtime-adapter.ts";
import { consumeRequestLimit } from "../../../../lib/request-rate-limit.ts";
import { VercelSandboxRuntimeAdapter } from "../../../../lib/vercel-sandbox-runtime-adapter.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

class RouteError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(
    status: number,
    payload: Record<string, unknown>,
  ) {
    super(String(payload.error ?? "Project V2 request failed."));
    this.name = "ProjectV2RouteError";
    this.status = status;
    this.payload = payload;
  }
}

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function actor(request: NextRequest) {
  const resolved = resolveStudioProjectActor({
    accountCookie: request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    guestCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
  });
  if (!resolved) {
    throw new RouteError(401, {
      code: "STUDIO_SESSION_REQUIRED",
      error: "Start a signed Studio session before syncing Project V2 files.",
    });
  }
  return resolved;
}

function projectId(value: string | null): string {
  if (!value || !/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value)) {
    throw new RouteError(400, { error: "Project V2 id is invalid." });
  }
  return value;
}

function requireStorage(): void {
  if (!projectV2SnapshotStorageConfigured()) {
    throw new RouteError(503, {
      code: "PROJECT_V2_STORAGE_UNAVAILABLE",
      error: "Private Project V2 storage is not configured. The browser project remains available.",
    });
  }
}

function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new RouteError(403, { error: "Cross-origin Project V2 mutation rejected." });
  }
  const origin = request.headers.get("origin");
  if (!origin && process.env.NODE_ENV !== "production") return;
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "")
      || request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    const parsedOrigin = origin ? new URL(origin).origin : "";
    if (
      !parsedOrigin
      || (
        parsedOrigin !== request.nextUrl.origin
        && parsedOrigin !== visibleOrigin
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new RouteError(403, { error: "A same-origin Project V2 mutation is required." });
  }
}

async function enforceLimit(identity: string, mode: "read" | "write"): Promise<void> {
  const state = await consumeRequestLimit({
    identity,
    namespace: `project-v2-${mode}`,
    max: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL
      ? 5_000
      : 600,
    windowMs: 60 * 60 * 1_000,
  });
  if (state === "limited") {
    throw new RouteError(429, { error: "Project V2 sync is receiving too many requests. Retry shortly." });
  }
  if (state === "unavailable" && process.env.NODE_ENV === "production") {
    throw new RouteError(503, { error: "Project V2 sync protection is temporarily unavailable." });
  }
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RouteError(415, { error: "Project V2 sync requires application/json." });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) {
    throw new RouteError(413, { error: "Project V2 snapshot exceeds the private storage limit." });
  }
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) {
    throw new RouteError(413, { error: "Project V2 snapshot exceeds the private storage limit." });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new RouteError(400, { error: "Project V2 sync requires a valid JSON object." });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteError(400, { error: "Project V2 sync requires a JSON object." });
  }
  return value as Record<string, unknown>;
}

function responseError(error: unknown) {
  if (error instanceof RouteError) return json(error.payload, error.status);
  if (error instanceof ArtifactSecretError) {
    return json({
      code: "PROJECT_SECRET_REJECTED",
      error: "Project V2 sync stopped because source or checkpoint data contains credential-like material.",
    }, 400);
  }
  if (error instanceof ProjectV2SnapshotStorageUnavailableError) {
    return json({ error: error.message }, 503);
  }
  if (error instanceof ProjectV2ReleaseReceiptStorageUnavailableError) {
    return json({
      code: "PROJECT_V2_RELEASE_RECEIPT_CLEANUP_FAILED",
      error: error.message,
    }, 503);
  }
  console.error("Unexpected Project V2 sync failure.", error);
  return json({ error: "Project V2 sync is temporarily unavailable. The browser project remains available." }, 503);
}

export async function GET(request: NextRequest) {
  try {
    const account = actor(request);
    requireStorage();
    await enforceLimit(account.identity, "read");
    const stored = await readProjectV2Snapshot(
      account.identity,
      projectId(request.nextUrl.searchParams.get("id")),
    );
    if (!stored) return json({ error: "Project V2 snapshot was not found." }, 404);
    return json(stored);
  } catch (error) {
    return responseError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const account = actor(request);
    requireStorage();
    await enforceLimit(account.identity, "write");
    const input = await requestBody(request);
    if (Object.keys(input).some((field) => !["project", "expectedStorageRevision"].includes(field))) {
      throw new RouteError(400, { error: "Project V2 sync contains unsupported fields." });
    }
    const expected = input.expectedStorageRevision;
    if (!Number.isSafeInteger(expected) || Number(expected) < 0) {
      throw new RouteError(400, { error: "expectedStorageRevision must be non-negative." });
    }
    const result = await writeProjectV2Snapshot(
      account.identity,
      input.project,
      Number(expected),
    );
    if (result.status === "conflict") {
      return json({
        code: "PROJECT_V2_REVISION_CONFLICT",
        error: "Project V2 changed in another session.",
        storageRevision: result.storageRevision,
        project: result.project,
      }, 409);
    }
    if (result.status === "too-large") {
      return json({ error: "Project V2 snapshot and checkpoints exceed the private storage limit." }, 413);
    }
    return json(result);
  } catch (error) {
    return responseError(error);
  }
}

export interface DeleteProjectV2RouteDependencies {
  runtime?: ProjectRuntimeAdapter;
}

export async function handleDeleteProjectV2(
  request: NextRequest,
  dependencies: DeleteProjectV2RouteDependencies = {},
) {
  try {
    requireSameOrigin(request);
    const account = actor(request);
    requireStorage();
    await enforceLimit(account.identity, "write");
    const id = projectId(request.nextUrl.searchParams.get("id"));
    const stored = await readProjectV2Snapshot(account.identity, id);
    let sandboxDestroyed = false;
    if (stored) {
      const runtimeAdapter = dependencies.runtime ?? new VercelSandboxRuntimeAdapter();
      try {
        const context = {
          actorId: account.identity,
          project: stored.project,
          requestId: randomUUID(),
        };
        const handle = await runtimeAdapter.resume(context);
        if (handle) {
          await runtimeAdapter.destroy(handle);
          sandboxDestroyed = true;
        }
      } catch {
        throw new RouteError(503, {
          code: "PROJECT_V2_SANDBOX_CLEANUP_FAILED",
          error: "Sandbox cleanup could not be confirmed, so the project was not deleted. Retry shortly.",
        });
      }
    }
    await deleteProjectV2ReleaseReceipts(account.identity, id);
    await deleteProjectV2Snapshot(
      account.identity,
      id,
    );
    return json({ deleted: true, sandboxDestroyed });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest) {
  return handleDeleteProjectV2(request);
}
