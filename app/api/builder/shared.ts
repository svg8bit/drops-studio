import { NextRequest, NextResponse } from "next/server.js";
import {
  GUEST_IDENTITY_COOKIE,
  resolveStudioProjectActor,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../lib/access-tier.ts";
import {
  ProjectRuntimeProviderError,
  ProjectRuntimeUnavailableError,
  ProjectRuntimeValidationError,
  secretFreeRuntimeMessage,
  type RuntimeAuditEvent,
  type RuntimeAuditSink,
} from "../../../lib/project-runtime-adapter.ts";
import { ProjectV2RevisionConflictError } from "../../../lib/project-v2-files.ts";
import type { ProjectV2 } from "../../../lib/project-v2-types.ts";
import { consumeRequestLimit } from "../../../lib/request-rate-limit.ts";
import {
  ProjectV2SnapshotStorageUnavailableError,
  readProjectV2Snapshot,
  writeProjectV2Snapshot,
} from "../../../db/project-v2-snapshots.ts";
import type {
  BuilderAgentAuditEvent,
  BuilderAgentAuditSink,
  BuilderProjectRepository,
  BuilderProviderCredentials,
} from "../../../lib/builder-agent/types.ts";
import { BuilderModelUnavailableError } from "../../../lib/builder-agent/providers.ts";

export const BUILDER_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};
export const BUILDER_BODY_LIMIT_BYTES = 96_000;

export class BuilderRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "BuilderRouteError";
    this.status = status;
    this.code = code;
  }
}

export class SnapshotBuilderProjectRepository implements BuilderProjectRepository {
  async loadAuthorized(actorId: string, projectId: string): Promise<ProjectV2 | null> {
    return (await readProjectV2Snapshot(actorId, projectId))?.project ?? null;
  }

  async saveAuthorized(
    actorId: string,
    project: ProjectV2,
    expectedRevision: number,
  ): Promise<ProjectV2> {
    const current = await readProjectV2Snapshot(actorId, project.id);
    if (!current || current.project.revision !== expectedRevision) {
      throw new ProjectV2RevisionConflictError(
        current?.project.revision ?? 0,
        expectedRevision,
      );
    }
    const result = await writeProjectV2Snapshot(
      actorId,
      project,
      current.storageRevision,
    );
    if (result.status === "conflict") {
      throw new ProjectV2RevisionConflictError(
        result.project.revision,
        expectedRevision,
      );
    }
    if (result.status === "too-large") {
      throw new BuilderRouteError(
        413,
        "BUILDER_PROJECT_TOO_LARGE",
        "Project V2 snapshot exceeds the private storage limit.",
      );
    }
    return result.project;
  }
}

export class ServerBuilderAuditSink
  implements BuilderAgentAuditSink, RuntimeAuditSink
{
  async record(event: BuilderAgentAuditEvent | RuntimeAuditEvent): Promise<void> {
    // Vercel structured function logs are the durable operational audit stream.
    // Event constructors hash actor identity and redact provider error details.
    console.info(JSON.stringify({ source: "drops-studio-builder", ...event }));
  }
}

export function builderJson(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: BUILDER_NO_STORE_HEADERS,
  });
}

export function requireBuilderSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new BuilderRouteError(
      403,
      "BUILDER_CROSS_ORIGIN",
      "Cross-origin builder execution is not allowed.",
    );
  }
  const origin = request.headers.get("origin");
  if (!origin && process.env.NODE_ENV !== "production") return;
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    if (!origin || new URL(origin).origin !== visibleOrigin) throw new Error();
  } catch {
    throw new BuilderRouteError(
      403,
      "BUILDER_CROSS_ORIGIN",
      "A same-origin builder request is required.",
    );
  }
}

export function builderActor(request: NextRequest): string {
  const actor = resolveStudioProjectActor({
    accountCookie: request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    guestCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
  });
  if (!actor) {
    throw new BuilderRouteError(
      401,
      "BUILDER_SESSION_REQUIRED",
      "Start a signed Studio session before starting an isolated builder runtime.",
    );
  }
  return actor.identity;
}

export async function consumeBuilderLimit(
  actorId: string,
  namespace: string,
  options: { max: number; windowMs: number; retryAfter: number },
): Promise<void> {
  const local =
    process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" &&
    !process.env.VERCEL;
  const state = await consumeRequestLimit({
    identity: actorId,
    namespace,
    max: local ? Math.max(options.max, 1_000) : options.max,
    windowMs: options.windowMs,
  }).catch(() => "unavailable" as const);
  if (state === "limited") {
    throw new BuilderRouteError(
      429,
      "BUILDER_RATE_LIMIT",
      `Builder execution limit reached. Retry after ${options.retryAfter} seconds.`,
    );
  }
  if (state === "unavailable" && process.env.NODE_ENV === "production") {
    throw new BuilderRouteError(
      503,
      "BUILDER_RATE_LIMIT_UNAVAILABLE",
      "Secure builder rate limiting is temporarily unavailable.",
    );
  }
}

export async function readBuilderBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new BuilderRouteError(
      415,
      "BUILDER_JSON_REQUIRED",
      "Builder execution requires application/json.",
    );
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > BUILDER_BODY_LIMIT_BYTES) {
    throw new BuilderRouteError(
      413,
      "BUILDER_BODY_TOO_LARGE",
      "Builder request exceeds the bounded request limit.",
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > BUILDER_BODY_LIMIT_BYTES) {
    throw new BuilderRouteError(
      413,
      "BUILDER_BODY_TOO_LARGE",
      "Builder request exceeds the bounded request limit.",
    );
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BuilderRouteError(
      400,
      "BUILDER_INVALID_JSON",
      "Builder request must contain valid UTF-8 JSON.",
    );
  }
}

function headerCredential(request: NextRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!value) return undefined;
  if (value.length > 4_096 || /[\r\n\0]/.test(value)) {
    throw new BuilderRouteError(
      400,
      "BUILDER_CREDENTIAL_INVALID",
      "Request-only provider credential is invalid.",
    );
  }
  return value;
}

export function builderCredentials(request: NextRequest): BuilderProviderCredentials {
  return {
    apiKey: headerCredential(request, "x-provider-key"),
    openRouterKey: headerCredential(request, "x-openrouter-key"),
    // Vercel Functions receive their short-lived OIDC credential on the
    // request, not in process.env. Keep it request-scoped and pass it only to
    // the Gateway model resolver; it is never persisted, audited, or returned.
    gatewayToken: headerCredential(request, "x-vercel-oidc-token"),
  };
}

export function builderRouteError(error: unknown) {
  if (error instanceof BuilderRouteError) {
    return builderJson({ code: error.code, error: error.message }, error.status);
  }
  if (error instanceof ProjectV2RevisionConflictError) {
    return builderJson(
      {
        code: "BUILDER_REVISION_CONFLICT",
        error: "Project V2 changed in another session. Reload before continuing.",
        currentRevision: error.expectedRevision,
      },
      409,
    );
  }
  if (
    error instanceof ProjectRuntimeValidationError ||
    error instanceof BuilderModelUnavailableError
  ) {
    return builderJson({ code: "BUILDER_INVALID_REQUEST", error: error.message }, 400);
  }
  if (
    error instanceof ProjectRuntimeUnavailableError ||
    error instanceof ProjectV2SnapshotStorageUnavailableError
  ) {
    return builderJson({ code: "BUILDER_UNAVAILABLE", error: error.message }, 503);
  }
  if (error instanceof ProjectRuntimeProviderError) {
    return builderJson({ code: "BUILDER_PROVIDER_FAILURE", error: error.message }, 502);
  }
  console.error("Unexpected Drops Studio builder route failure.", {
    message: secretFreeRuntimeMessage(error, "Builder request failed."),
  });
  return builderJson(
    {
      code: "BUILDER_UNAVAILABLE",
      error: "Drops Studio builder is temporarily unavailable.",
    },
    503,
  );
}
