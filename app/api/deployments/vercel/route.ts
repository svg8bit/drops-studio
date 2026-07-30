import { NextRequest, NextResponse } from "next/server.js";
import {
  hasProjectV2ReleaseReceipt,
  ProjectV2ReleaseReceiptStorageUnavailableError,
} from "@/db/project-v2-release-receipts";
import { readProjectV2Snapshot } from "@/db/project-v2-snapshots";
import {
  GUEST_IDENTITY_COOKIE,
  resolveStudioProjectActor,
  STUDIO_ACCOUNT_COOKIE,
  type StudioProjectActor,
} from "@/lib/access-tier";
import { secretFreeRuntimeMessage } from "@/lib/project-runtime-adapter";
import type { ProjectCheckpointV2, ProjectV2 } from "@/lib/project-v2-types";
import {
  cancelVercelDeployment,
  createVercelPreviewDeployment,
  getVercelDeployment,
  getVercelDeploymentLogs,
  VercelDeploymentError,
  vercelDeploymentReadiness,
  waitForVercelDeployment,
  type VercelDeploymentCredentials,
  type VercelDeploymentFile,
} from "@/lib/vercel-deployment";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";
import { consumeRequestLimit } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 3_900_000;
const NO_STORE = { "cache-control": "no-store, max-age=0" };

function json(payload: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...NO_STORE, ...headers } });
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "")
      || request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    const parsed = new URL(origin).origin;
    return parsed === request.nextUrl.origin || parsed === visibleOrigin;
  } catch {
    return false;
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = decodeUtf8Body(await readBoundedRequestBody(request, MAX_BODY_BYTES));
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      throw new VercelDeploymentError(
        "The deployment request exceeds the bounded direct-upload size.",
        413,
        "VERCEL_REQUEST_TOO_LARGE",
      );
    }
    throw new VercelDeploymentError("A valid JSON deployment request is required.", 400, "VERCEL_REQUEST_INVALID");
  }
}

function headerCredential(request: NextRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim() ?? "";
  return value && value.length <= 512 && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function actor(request: NextRequest): StudioProjectActor {
  const resolved = resolveStudioProjectActor({
    accountCookie: request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    guestCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
  });
  if (!resolved) {
    throw new VercelDeploymentError(
      "Start a signed Studio session before using Vercel deployment.",
      401,
      "VERCEL_SESSION_REQUIRED",
    );
  }
  return resolved;
}

function credentials(
  request: NextRequest,
  input: Record<string, unknown>,
  projectActor: StudioProjectActor,
): VercelDeploymentCredentials {
  const sessionToken = headerCredential(request, "x-vercel-access-token");
  if (sessionToken) {
    return {
      accessToken: sessionToken,
      teamId: typeof input.teamId === "string" ? input.teamId : undefined,
      projectId: typeof input.projectId === "string" ? input.projectId : undefined,
    };
  }
  if (projectActor.kind !== "member") {
    throw new VercelDeploymentError(
      "Connect a session-only Vercel token before deploying as a guest.",
      403,
      "VERCEL_CONNECTION_REQUIRED",
    );
  }
  const accessToken = process.env.VERCEL_DEPLOY_TOKEN?.trim() ?? "";
  const projectId = process.env.VERCEL_GENERATED_PROJECT_ID?.trim() ?? "";
  if (!accessToken || !projectId) {
    throw new VercelDeploymentError(
      "Platform Vercel deployment is not configured. Connect a session-only token.",
      503,
      "VERCEL_CONFIGURATION_REQUIRED",
    );
  }
  // Platform credentials always use server-owned scope. Client-supplied team
  // and project identifiers are accepted only with the visitor's own token.
  return {
    accessToken,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId,
  };
}

function deploymentId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sourceFiles(value: ProjectV2["files"]): VercelDeploymentFile[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([path, item]) => {
    if (typeof item === "string") return { path, content: item };
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const file = item as Record<string, unknown>;
      return { path, content: typeof file.content === "string" ? file.content : "" };
    }
    return { path, content: "" };
  });
}

function studioProjectId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value)) {
    throw new VercelDeploymentError(
      "A valid Studio Project V2 id is required.",
      400,
      "VERCEL_PROJECT_ID_INVALID",
    );
  }
  return value;
}

async function authorizedProject(projectActor: StudioProjectActor, value: unknown): Promise<ProjectV2> {
  const stored = await readProjectV2Snapshot(projectActor.identity, studioProjectId(value));
  if (!stored) {
    throw new VercelDeploymentError(
      "The authorized Project V2 snapshot was not found.",
      404,
      "VERCEL_PROJECT_NOT_FOUND",
    );
  }
  return stored.project;
}

function verifiedForDeployment(project: ProjectV2): ProjectCheckpointV2 | null {
  const checkpoint = [...project.checkpoints]
    .reverse()
    .find((entry) => /^Verified (?:AI|deterministic) build$/.test(entry.label));
  if (
    !checkpoint ||
    checkpoint.snapshot.revision !== project.revision ||
    checkpoint.snapshot.contentHash !== project.contentHash ||
    project.preview?.status !== "ready" ||
    project.preview.projectRevision !== project.revision ||
    !project.preview.url?.startsWith("https://")
  ) {
    return null;
  }
  const requiredKinds = (["build", "typecheck", "lint", "test"] as const)
    .filter((kind) => kind === "build" || Boolean(project.manifest.scripts[kind]));
  const successfulTaskIds = new Set(
    project.runs
      .filter((run) => run.projectRevision === project.revision && run.status === "succeeded")
      .map((run) => run.taskId),
  );
  const checksPassed = requiredKinds.every((kind) =>
    project.tasks.some((task) => task.kind === kind && successfulTaskIds.has(task.id)),
  );
  const browserChecked = project.logs.some((log) => {
    if (log.stream !== "browser") return false;
    return project.runs.some((run) =>
      run.id === log.runId && run.projectRevision === project.revision,
    );
  });
  return checksPassed && browserChecked ? checkpoint : null;
}

async function requireReleaseReceipt(
  projectActor: StudioProjectActor,
  project: ProjectV2,
  checkpoint: ProjectCheckpointV2,
): Promise<void> {
  let found = false;
  try {
    found = await hasProjectV2ReleaseReceipt({
      actorId: projectActor.identity,
      projectId: project.id,
      revision: checkpoint.snapshot.revision,
      contentHash: checkpoint.snapshot.contentHash,
      checkpointId: checkpoint.id,
      snapshotHash: checkpoint.snapshotHash,
    });
  } catch (error) {
    if (error instanceof ProjectV2ReleaseReceiptStorageUnavailableError) {
      throw new VercelDeploymentError(
        "Private release receipt storage is unavailable. Rebuild after storage recovers.",
        503,
        "VERCEL_RELEASE_RECEIPT_UNAVAILABLE",
      );
    }
    throw error;
  }
  if (!found) {
    throw new VercelDeploymentError(
      "This source snapshot has no server-issued Sandbox release receipt. Rebuild it before deployment.",
      409,
      "VERCEL_RELEASE_RECEIPT_REQUIRED",
    );
  }
}

function ownedDeploymentId(project: ProjectV2, value: unknown): string {
  const requested = deploymentId(value);
  if (!requested || project.deployment?.deploymentId !== requested) {
    throw new VercelDeploymentError(
      "The deployment receipt is not owned by this Project V2 snapshot.",
      404,
      "VERCEL_DEPLOYMENT_NOT_FOUND",
    );
  }
  return requested;
}

export async function GET() {
  return json({
    provider: "vercel",
    ...vercelDeploymentReadiness(),
    sessionTokenSupported: true,
    explicitApprovalRequired: true,
    claims: "disabled-until-provider-confirms",
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return json({ error: "Cross-origin deployment requests are not allowed.", code: "VERCEL_CROSS_ORIGIN" }, 403);
  }
  if (!hasJsonMediaType(request)) {
    return json({ error: "Deployment requests require application/json.", code: "VERCEL_CONTENT_TYPE" }, 415);
  }
  try {
    const projectActor = actor(request);
    const limit = await consumeRequestLimit({
      identity: projectActor.identity,
      namespace: "vercel-project-deploy",
      max: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL ? 100 : 12,
      windowMs: 24 * 60 * 60 * 1_000,
    }).catch(() => "unavailable" as const);
    if (limit === "limited") {
      return json({ error: "The daily deployment limit has been reached.", code: "VERCEL_DEPLOY_LIMIT" }, 429, { "retry-after": "86400" });
    }
    if (limit === "unavailable") {
      return json({ error: "Durable deployment rate limiting is unavailable.", code: "VERCEL_RATE_LIMIT_UNAVAILABLE" }, 503);
    }
    const input = await body(request);
    const action = typeof input.action === "string" ? input.action : "deploy";
    const project = await authorizedProject(projectActor, input.studioProjectId);
    const auth = credentials(request, input, projectActor);
    if (
      ["status", "logs", "cancel"].includes(action) &&
      !headerCredential(request, "x-vercel-access-token")
    ) {
      throw new VercelDeploymentError(
        "Connect a session-only Vercel token to inspect or cancel an existing deployment.",
        403,
        "VERCEL_CONNECTION_REQUIRED",
      );
    }
    if (action === "status") {
      return json({ deployment: await getVercelDeployment({ credentials: auth, deploymentId: ownedDeploymentId(project, input.deploymentId) }) });
    }
    if (action === "logs") {
      return json({ logs: await getVercelDeploymentLogs({ credentials: auth, deploymentId: ownedDeploymentId(project, input.deploymentId) }) });
    }
    if (action === "cancel") {
      if (input.approved !== true) {
        return json({ error: "Canceling an external deployment requires explicit approval.", code: "VERCEL_APPROVAL_REQUIRED" }, 409);
      }
      return json({ deployment: await cancelVercelDeployment({ credentials: auth, deploymentId: ownedDeploymentId(project, input.deploymentId) }) });
    }
    if (action !== "deploy" && action !== "rollback") {
      return json({ error: "Unsupported deployment action.", code: "VERCEL_ACTION_INVALID" }, 400);
    }
    if (input.approved !== true) {
      return json({ error: "Creating or restoring an external deployment requires explicit approval.", code: "VERCEL_APPROVAL_REQUIRED" }, 409);
    }
    const checkpoint = action === "rollback"
      ? project.checkpoints.find((entry) => entry.id === input.checkpointId)
      : null;
    if (action === "rollback" && !checkpoint) {
      return json({ error: "Select an owned Project V2 checkpoint to redeploy.", code: "VERCEL_CHECKPOINT_REQUIRED" }, 404);
    }
    if (action === "rollback") {
      await requireReleaseReceipt(projectActor, project, checkpoint!);
    } else {
      const verifiedCheckpoint = verifiedForDeployment(project);
      if (!verifiedCheckpoint) {
        return json({
          error: "This Project V2 revision has no complete verified Sandbox release gate. Rebuild it before deployment.",
          code: "VERCEL_RELEASE_GATE_REQUIRED",
        }, 409);
      }
      await requireReleaseReceipt(projectActor, project, verifiedCheckpoint);
    }
    const deploymentFiles = checkpoint?.snapshot.files ?? project.files;
    const created = await createVercelPreviewDeployment({
      credentials: auth,
      name: project.manifest.slug,
      files: sourceFiles(deploymentFiles),
      revisionHash: checkpoint?.snapshot.contentHash ?? project.contentHash,
    });
    const deployment = input.wait === false
      ? created
      : await waitForVercelDeployment({ credentials: auth, deploymentId: created.id });
    const logs = deployment.readyState === "READY"
      ? []
      : await getVercelDeploymentLogs({ credentials: auth, deploymentId: deployment.id }).catch(() => []);
    return json({
      deployment,
      logs,
      confirmedReady: deployment.readyState === "READY" && Boolean(deployment.url),
      operation: action === "rollback" ? "checkpoint-redeployment" : "preview-deployment",
    }, deployment.readyState === "ERROR" ? 422 : 200);
  } catch (error) {
    const failure = error instanceof VercelDeploymentError
      ? error
      : new VercelDeploymentError("Vercel deployment failed.");
    return json({
      error: secretFreeRuntimeMessage(failure, "Vercel deployment failed."),
      code: failure.code,
    }, failure.status);
  }
}
