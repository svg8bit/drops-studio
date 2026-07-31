import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server.js";
import { z } from "zod";
import {
  BuilderAgentSession,
  type BuilderAgentAuditSink,
  type BuilderProjectRepository,
} from "../../../../lib/builder-agent/index.ts";
import type {
  ProjectRuntimeAdapter,
  RuntimeAuditSink,
  RuntimeState,
} from "../../../../lib/project-runtime-adapter.ts";
import type { ProjectV2 } from "../../../../lib/project-v2-types.ts";
import { VercelSandboxRuntimeAdapter } from "../../../../lib/vercel-sandbox-runtime-adapter.ts";
import {
  ServerBuilderAuditSink,
  SnapshotBuilderProjectRepository,
  builderActor,
  builderJson,
  builderRouteError,
  consumeBuilderLimit,
  readBuilderBody,
  requireBuilderSameOrigin,
} from "../shared.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const runtimeRequestSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/i),
  action: z.enum([
    "ensure",
    "status",
    "sync",
    "install",
    "run",
    "typecheck",
    "lint",
    "tests",
    "build",
    "preview",
    "logs",
    "checkpoint",
    "restore",
    "stop",
    "destroy",
  ]),
  taskId: z.string().min(1).max(64).optional(),
  commandId: z.string().min(1).max(128).optional(),
  checkpointId: z.string().min(1).max(128).optional(),
  label: z.string().min(1).max(120).optional(),
  port: z.union([z.literal(3000), z.literal(8080)]).optional(),
  confirm: z.boolean().optional(),
}).strict();

const RUNTIME_PERMISSIONS = new Set([
  "files:read",
  "files:write",
  "runtime:execute",
  "runtime:network",
  "preview:start",
  "checkpoint:write",
  "checkpoint:restore",
] as const);

export interface BuilderRuntimeRouteDependencies {
  repository?: BuilderProjectRepository;
  runtime?: ProjectRuntimeAdapter;
  audit?: BuilderAgentAuditSink & RuntimeAuditSink;
}

function stoppedProject(
  project: ProjectV2,
  state: "failed" | "stopped",
  error?: string,
): ProjectV2 | null {
  const hasRunningRun = project.runs.some((run) => run.status === "running");
  if (!project.preview && !hasRunningRun) return null;
  const now = new Date().toISOString();
  const preview = project.preview;
  return {
    ...project,
    ...(preview
      ? {
          preview: {
            status: state,
            projectRevision: project.revision,
            ...(preview.sandboxId ? { sandboxId: preview.sandboxId } : {}),
            ...(preview.startedAt ? { startedAt: preview.startedAt } : {}),
            stoppedAt: now,
            ...(state === "failed" && error ? { error } : {}),
          },
        }
      : {}),
    runs: project.runs.map((run) =>
      run.status === "running"
        ? { ...run, status: "stopped" as const, finishedAt: now, exitCode: null }
        : run
    ),
    updatedAt: now,
  };
}

async function persistStoppedProject(
  repository: BuilderProjectRepository,
  actorId: string,
  project: ProjectV2,
  state: "failed" | "stopped",
  error?: string,
): Promise<void> {
  const next = stoppedProject(project, state, error);
  if (!next) return;
  // Runtime status must remain available even if another browser revision won
  // the optimistic-concurrency race. That next snapshot will be reconciled by
  // its own passive runtime status refresh.
  await repository.saveAuthorized(actorId, next, project.revision).catch(() => undefined);
}

async function reconcileRuntimeState(
  repository: BuilderProjectRepository,
  actorId: string,
  project: ProjectV2,
  state: RuntimeState,
): Promise<void> {
  if (state.status === "failed") {
    await persistStoppedProject(
      repository,
      actorId,
      project,
      "failed",
      "Vercel Sandbox reported a failed runtime.",
    );
    return;
  }
  if (state.status === "stopped") {
    await persistStoppedProject(repository, actorId, project, "stopped");
    return;
  }
  if (project.preview?.status === "ready" && !state.previewUrl) {
    await persistStoppedProject(
      repository,
      actorId,
      project,
      "failed",
      "The Sandbox preview process is no longer running.",
    );
  }
}

export async function handleBuilderRuntimeRequest(
  request: NextRequest,
  dependencies: BuilderRuntimeRouteDependencies = {},
) {
  try {
    requireBuilderSameOrigin(request);
    const actorId = builderActor(request);
    await consumeBuilderLimit(actorId, "builder-runtime-action", {
      max: 120,
      windowMs: 60 * 60_000,
      retryAfter: 3_600,
    });
    const parsed = runtimeRequestSchema.safeParse(await readBuilderBody(request));
    if (!parsed.success) {
      return builderJson(
        {
          code: "BUILDER_RUNTIME_INVALID_REQUEST",
          error: "A valid bounded runtime action is required.",
        },
        400,
      );
    }
    const input = parsed.data;
    if (
      ((input.action === "run" && !input.taskId) ||
        (input.action === "logs" && !input.commandId) ||
        (input.action === "restore" && !input.checkpointId))
    ) {
      return builderJson(
        {
          code: "BUILDER_RUNTIME_MISSING_ARGUMENT",
          error: "The selected runtime action is missing a required identifier.",
        },
        400,
      );
    }
    if ((input.action === "restore" || input.action === "destroy") && input.confirm !== true) {
      return builderJson(
        {
          code: "BUILDER_RUNTIME_APPROVAL_REQUIRED",
          error: `${input.action} requires explicit confirmation.`,
        },
        409,
      );
    }
    const repository = dependencies.repository ?? new SnapshotBuilderProjectRepository();
    const project = await repository.loadAuthorized(actorId, input.projectId);
    if (!project) {
      return builderJson(
        { code: "BUILDER_PROJECT_NOT_FOUND", error: "Project V2 was not found." },
        404,
      );
    }
    const audit = dependencies.audit ?? new ServerBuilderAuditSink();
    const runtimeAdapter =
      dependencies.runtime ?? new VercelSandboxRuntimeAdapter({ audit });
    const session = new BuilderAgentSession({
      actorId,
      requestId: randomUUID(),
      project,
      repository,
      runtime: runtimeAdapter,
      permissions: RUNTIME_PERMISSIONS,
      audit,
    });
    const existingOnly = new Set(["status", "logs", "stop", "destroy"]).has(
      input.action,
    );
    const existingHandle = existingOnly
      ? await runtimeAdapter.resume(session.runtimeContext)
      : null;
    if (!existingHandle && existingOnly) {
      if (input.action === "status") {
        await persistStoppedProject(repository, actorId, project, "stopped");
        return builderJson({
          action: input.action,
          result: {
            provider: runtimeAdapter.provider,
            status: "unavailable",
            sandboxName: null,
            sessionId: null,
            vcpus: null,
            memoryMb: null,
            createdAt: null,
            updatedAt: null,
            expiresAt: null,
            activeDurationMs: null,
            previewUrl: null,
            previewCommandId: null,
          },
        });
      }
      if (input.action === "stop" || input.action === "destroy") {
        await persistStoppedProject(repository, actorId, project, "stopped");
        return builderJson({
          action: input.action,
          result: input.action === "stop" ? { stopped: true } : { destroyed: true },
        });
      }
      return builderJson(
        {
          code: "BUILDER_RUNTIME_NOT_FOUND",
          error: "No active Sandbox command is available for this project.",
        },
        404,
      );
    }
    const handle = existingHandle ?? (await session.ensureRuntime());
    let result: unknown;
    switch (input.action) {
      case "ensure":
      case "sync":
        result = { handle, state: await runtimeAdapter.status(handle) };
        break;
      case "status":
        result = await runtimeAdapter.status(handle);
        await reconcileRuntimeState(
          repository,
          actorId,
          project,
          result as RuntimeState,
        );
        break;
      case "install":
        result = await runtimeAdapter.installDependencies(session.runtimeContext, handle);
        break;
      case "run":
        result = await session.runTask(input.taskId!);
        break;
      case "typecheck":
        result = await session.runTypecheck();
        break;
      case "lint":
        result = await session.runLint();
        break;
      case "tests":
        result = await session.runTests();
        break;
      case "build":
        result = await session.runBuild();
        break;
      case "preview": {
        const preview = await session.startPreview(undefined, input.port);
        result = { ...preview, preview: session.project.preview };
        break;
      }
      case "logs":
        result = await runtimeAdapter.readLogs(handle, {
          commandId: input.commandId!,
          limit: 256,
        });
        break;
      case "checkpoint":
        result = await session.createCheckpoint(input.label ?? "Manual checkpoint");
        break;
      case "restore":
        result = await session.restoreCheckpoint(input.checkpointId!);
        break;
      case "stop":
        await runtimeAdapter.stop(handle);
        await persistStoppedProject(repository, actorId, project, "stopped");
        result = { stopped: true };
        break;
      case "destroy":
        await runtimeAdapter.destroy(handle);
        await persistStoppedProject(repository, actorId, project, "stopped");
        result = { destroyed: true };
        break;
    }
    return builderJson({ action: input.action, result });
  } catch (error) {
    return builderRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  return handleBuilderRuntimeRequest(request);
}
