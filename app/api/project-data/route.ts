import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";

import {
  MemoryProjectDataBackend,
  ProjectDataError,
  ProjectDataStore,
  authorizeProjectDataCapability,
  verifyProjectDataCapability,
  type ProjectDataCapabilityPayload,
  type ProjectDataPermission,
} from "../../../lib/project-data/index.ts";
import { consumeRequestLimit } from "../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_LIMIT_BYTES = 72 * 1_024;
const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Authorization",
};

function json(payload: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function backend() {
  if (globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__) {
    return globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__;
  }
  if (process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA !== "1") {
    throw new ProjectDataError(
      "storage_unavailable",
      "Project data storage is not configured. The generated app can continue with its labelled browser-local fallback.",
    );
  }
  globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__ = new MemoryProjectDataBackend();
  return globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__;
}

function store(): ProjectDataStore {
  return new ProjectDataStore(backend());
}

function bearer(request: NextRequest): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!match) throw new ProjectDataError("unauthorized", "A project data capability is required.");
  return match[1];
}

function capability(request: NextRequest): ProjectDataCapabilityPayload {
  const secret = process.env.PROJECT_DATA_CAPABILITY_SECRET;
  if (!secret) {
    throw new ProjectDataError("storage_unavailable", "Project data capability signing is not configured.");
  }
  const verified = verifyProjectDataCapability(bearer(request), secret);
  if (!verified) throw new ProjectDataError("unauthorized", "Project data capability is invalid or expired.");
  return verified;
}

async function enforceRateLimit(
  authorization: ProjectDataCapabilityPayload,
  mode: "read" | "write",
): Promise<void> {
  const identity = createHash("sha256")
    .update(
      `project-data:v1:${authorization.subject}:${authorization.projectId}:${authorization.nonce}`,
      "utf8",
    )
    .digest("hex");
  const status = await consumeRequestLimit({
    identity,
    namespace: `project-data-${mode}`,
    max: mode === "read" ? 600 : 240,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (status === "limited") {
    throw new ProjectDataError(
      "rate_limited",
      "Project data request limit reached. Retry after the current window.",
    );
  }
  if (status === "unavailable" && process.env.NODE_ENV === "production") {
    throw new ProjectDataError(
      "storage_unavailable",
      "Project data request protection is temporarily unavailable.",
    );
  }
}

function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ProjectDataError("forbidden", "Cross-origin project data mutation rejected.");
  }
  const origin = request.headers.get("origin");
  if (!origin) throw new ProjectDataError("forbidden", "A same-origin project data mutation is required.");
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error("origin mismatch");
  } catch {
    throw new ProjectDataError("forbidden", "Cross-origin project data mutation rejected.");
  }
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ProjectDataError("invalid_request", "Project data mutations require application/json.", { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT_BYTES) {
    throw new ProjectDataError("quota_exceeded", "Project data request body is too large.");
  }
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > BODY_LIMIT_BYTES) {
    throw new ProjectDataError("quota_exceeded", "Project data request body is too large.");
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProjectDataError("invalid_request", "Project data request body must be a JSON object.");
  }
}

function exactFields(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(input).filter((field) => !allowedSet.has(field));
  if (unsupported.length) {
    throw new ProjectDataError("invalid_request", `Unsupported project data fields: ${unsupported.join(", ")}.`);
  }
}

function scope(
  authorization: ProjectDataCapabilityPayload,
  input: Record<string, unknown>,
  permission: ProjectDataPermission,
): { projectId: string; namespace: string } {
  if (typeof input.projectId !== "string" || typeof input.namespace !== "string") {
    throw new ProjectDataError("invalid_request", "projectId and namespace are required.");
  }
  authorizeProjectDataCapability(authorization, {
    projectId: input.projectId,
    namespace: input.namespace,
    permission,
  });
  return { projectId: input.projectId, namespace: input.namespace };
}

function responseError(error: unknown): NextResponse {
  if (error instanceof ProjectDataError) {
    return json({
      code: error.code,
      error: error.message,
      ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
    }, error.status);
  }
  return json({
    code: "storage_unavailable",
    error: "Project data is temporarily unavailable. The browser-local fallback remains available.",
  }, 503);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authorization = capability(request);
    await enforceRateLimit(authorization, "read");
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    exactFields(query, ["projectId", "namespace", "id"]);
    const { projectId, namespace } = scope(authorization, query, "read");
    if (query.id) {
      const document = await store().get(projectId, namespace, query.id);
      if (!document) throw new ProjectDataError("not_found", "Project data document was not found.");
      return json({ document, persistence: backend().kind });
    }
    const documents = await store().list(projectId, namespace);
    return json({ documents, persistence: backend().kind });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const authorization = capability(request);
    await enforceRateLimit(authorization, "write");
    const input = await requestBody(request);
    exactFields(input, ["projectId", "namespace", "id", "data"]);
    const { projectId, namespace } = scope(authorization, input, "write");
    const document = await store().create({ projectId, namespace, id: input.id, data: input.data });
    return json({ document, persistence: backend().kind }, 201);
  } catch (error) {
    return responseError(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const authorization = capability(request);
    await enforceRateLimit(authorization, "write");
    const input = await requestBody(request);
    exactFields(input, ["projectId", "namespace", "id", "expectedRevision", "data"]);
    const { projectId, namespace } = scope(authorization, input, "write");
    const document = await store().update({
      projectId,
      namespace,
      id: input.id,
      expectedRevision: input.expectedRevision,
      data: input.data,
    });
    return json({ document, persistence: backend().kind });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const authorization = capability(request);
    await enforceRateLimit(authorization, "write");
    const input = await requestBody(request);
    exactFields(input, ["projectId", "namespace", "id", "expectedRevision"]);
    const { projectId, namespace } = scope(authorization, input, "delete");
    await store().delete(projectId, namespace, input.id, input.expectedRevision);
    return json({ deleted: true, persistence: backend().kind });
  } catch (error) {
    return responseError(error);
  }
}
