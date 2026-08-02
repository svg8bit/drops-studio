import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server.js";
import { z } from "zod";
import {
  writeProjectV2ReleaseReceipt,
  type ProjectV2ReleaseReceipt,
  type ProjectV2ReleaseReceiptDescriptor,
} from "../../../../db/project-v2-release-receipts.ts";
import {
  BuilderAgentSession,
  materializedProjectDeterministicFallback,
  runBuilderAgent,
  type BuilderAgentAuditSink,
  type BuilderAgentRunnerFactory,
  type BuilderBrowserChecker,
  type BuilderConnectionRequester,
  type BuilderDeterministicFallback,
  type BuilderModelResolver,
  type BuilderProjectPublisher,
  type BuilderProjectRepository,
} from "../../../../lib/builder-agent/index.ts";
import {
  DefaultAgentEvalStore,
  type AgentEvalStore,
} from "../../../../lib/agent/evals/index.ts";
import { resolveAgentIntelligenceFlags } from "../../../../lib/agent/flags.ts";
import {
  runIntelligentBuilderAgent,
  type RunIntelligentBuilderAgentInput,
} from "../../../../lib/agent/runtime/index.ts";
import { VercelSandboxRuntimeAdapter } from "../../../../lib/vercel-sandbox-runtime-adapter.ts";
import { VercelAgentBrowserChecker } from "../../../../lib/vercel-agent-browser-checker.ts";
import type {
  ProjectRuntimeAdapter,
  RuntimeAuditSink,
} from "../../../../lib/project-runtime-adapter.ts";
import type { ProjectV2 } from "../../../../lib/project-v2-types.ts";
import {
  ServerBuilderAuditSink,
  SnapshotBuilderProjectRepository,
  BuilderRouteError,
  builderActor,
  builderJson,
  builderRouteError,
  consumeBuilderLimit,
  readBuilderBody,
  rememberedBuilderConnection,
  requireBuilderSameOrigin,
} from "../shared.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const BUILDER_EXECUTION_TIMEOUT_MS = 270_000;
const BUILDER_TIMEOUT_CLEANUP_MS = 5_000;

const requestSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/i),
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(["build", "edit", "repair"]),
  buildRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/).optional(),
  provider: z.object({
    provider: z.enum(["free", "gateway", "openai", "anthropic", "openrouter", "kimi", "custom"]),
    model: z.string().min(1).max(192).optional(),
    baseUrl: z.string().url().max(2_000).optional(),
  }).strict(),
}).strict();

function autoBuildRunId(requestId: string): string {
  return `auto:${requestId}`;
}

function withAutoBuildRun(
  project: ProjectV2,
  requestId: string,
  status: "running" | "succeeded" | "failed" | "stopped",
): ProjectV2 {
  const id = autoBuildRunId(requestId);
  const prior = project.runs.find((run) => run.id === id);
  const now = new Date().toISOString();
  const runs = [
    ...project.runs.filter((run) => run.id !== id),
    {
      id,
      taskId: "build",
      projectRevision: project.revision,
      status,
      runtime: "vercel-sandbox" as const,
      startedAt: status === "running" ? now : prior?.startedAt ?? now,
      ...(status === "running"
        ? {}
        : { finishedAt: now, exitCode: status === "succeeded" ? 0 : null }),
      logIds: prior?.logIds ?? [],
      auditEventIds: prior?.auditEventIds ?? [],
    },
  ].slice(-256);
  const retainedRunIds = new Set(runs.map((run) => run.id));
  return {
    ...project,
    runs,
    logs: project.logs.filter((log) => retainedRunIds.has(log.runId)),
    updatedAt: now,
  };
}

async function claimAutoBuildRequest(input: {
  actorId: string;
  project: ProjectV2;
  repository: BuilderProjectRepository;
  requestId: string;
}): Promise<{ status: "claimed" | "running"; project: ProjectV2 }> {
  let project = input.project;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = project.runs.find(
      (run) => run.id === autoBuildRunId(input.requestId),
    );
    if (existing?.status === "running" || existing?.status === "queued") {
      return { status: "running", project };
    }
    try {
      project = await input.repository.saveAuthorized(
        input.actorId,
        withAutoBuildRun(project, input.requestId, "running"),
        project.revision,
      );
      return { status: "claimed", project };
    } catch (error) {
      const current = await input.repository.loadAuthorized(
        input.actorId,
        project.id,
      );
      if (!current) throw error;
      const claimed = current.runs.find(
        (run) => run.id === autoBuildRunId(input.requestId),
      );
      if (claimed?.status === "running" || claimed?.status === "queued") {
        return { status: "running", project: current };
      }
      if (attempt === 1) throw error;
      project = current;
    }
  }
  return { status: "running", project };
}

async function settleAutoBuildRequest(input: {
  actorId: string;
  projectId: string;
  repository: BuilderProjectRepository;
  requestId: string;
  status: "succeeded" | "failed" | "stopped";
}): Promise<ProjectV2 | null> {
  const current = await input.repository.loadAuthorized(input.actorId, input.projectId);
  if (!current) return null;
  const run = current.runs.find(
    (item) => item.id === autoBuildRunId(input.requestId),
  );
  if (!run || run.status !== "running") return current;
  return input.repository.saveAuthorized(
    input.actorId,
    withAutoBuildRun(current, input.requestId, input.status),
    current.revision,
  );
}

const ALL_AGENT_PERMISSIONS = new Set([
  "files:read",
  "files:write",
  "runtime:execute",
  "runtime:network",
  "preview:start",
  "browser:check",
  "checkpoint:write",
  "checkpoint:restore",
  "connection:request",
  "project:publish",
] as const);

export interface BuilderAgentRouteDependencies {
  repository?: BuilderProjectRepository;
  runtime?: ProjectRuntimeAdapter;
  audit?: BuilderAgentAuditSink & RuntimeAuditSink;
  browser?: BuilderBrowserChecker;
  connections?: BuilderConnectionRequester;
  publisher?: BuilderProjectPublisher;
  deterministicFallback?: BuilderDeterministicFallback;
  modelResolver?: BuilderModelResolver;
  runnerFactory?: BuilderAgentRunnerFactory;
  evalStore?: Pick<AgentEvalStore, "writeTrace">;
  intelligenceRunner?: (
    input: RunIntelligentBuilderAgentInput,
  ) => ReturnType<typeof runIntelligentBuilderAgent>;
  writeReleaseReceipt?: (
    descriptor: ProjectV2ReleaseReceiptDescriptor,
  ) => Promise<ProjectV2ReleaseReceipt>;
  resolveApprovedTools?: (
    request: NextRequest,
  ) => Promise<ReadonlyArray<"delete_file" | "rename_file" | "restore_checkpoint" | "publish_project">>;
  executionTimeoutMs?: number;
}

async function boundedCleanup(operation: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BUILDER_TIMEOUT_CLEANUP_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withBuilderExecutionDeadline<T>(input: {
  timeoutMs: number;
  controller: AbortController;
  operation: () => Promise<T>;
  cleanup: () => Promise<void>;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let removeAbortListener: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error("builder-execution-aborted"));
      if (input.controller.signal.aborted) {
        onAbort();
        return;
      }
      input.controller.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => {
        input.controller.signal.removeEventListener("abort", onAbort);
      };
    });
    return await Promise.race([
      input.operation(),
      aborted,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          input.controller.abort();
          reject(new Error("builder-execution-timeout"));
        }, input.timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      await boundedCleanup(input.cleanup);
      throw new BuilderRouteError(
        504,
        "BUILDER_EXECUTION_TIMEOUT",
        "Builder verification exceeded its bounded server window. The Sandbox was stopped; choose Retry to restart it.",
      );
    }
    if (input.controller.signal.aborted) {
      await boundedCleanup(input.cleanup);
      throw new BuilderRouteError(
        499,
        "BUILDER_EXECUTION_CANCELLED",
        "Builder stopped. Saved project files and the last working preview were preserved.",
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener();
  }
}

async function stopInterruptedSession(input: {
  actorId: string;
  repository: BuilderProjectRepository;
  runtime: ProjectRuntimeAdapter;
  session: BuilderAgentSession;
  cancelled: boolean;
}): Promise<void> {
  const handle = await input.runtime.resume(input.session.runtimeContext).catch(() => null);
  if (handle) await input.runtime.stop(handle).catch(() => undefined);
  const project = input.session.project;
  const now = new Date().toISOString();
  const next = {
    ...project,
    ...(project.preview
      ? {
          preview: {
            status: input.cancelled ? "stopped" as const : "failed" as const,
            projectRevision: project.revision,
            ...(project.preview.sandboxId ? { sandboxId: project.preview.sandboxId } : {}),
            ...(project.preview.startedAt ? { startedAt: project.preview.startedAt } : {}),
            stoppedAt: now,
            error: input.cancelled
              ? "Builder stopped by the user."
              : "Builder execution exceeded its bounded server window.",
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
  await input.repository.saveAuthorized(
    input.actorId,
    next,
    project.revision,
  ).catch(() => undefined);
}

export async function handleBuilderAgentRequest(
  request: NextRequest,
  dependencies: BuilderAgentRouteDependencies = {},
) {
  try {
    requireBuilderSameOrigin(request);
    const actorId = builderActor(request);
    await Promise.all([
      consumeBuilderLimit(actorId, "builder-agent-session", {
        max: 20,
        windowMs: 24 * 60 * 60_000,
        retryAfter: 86_400,
      }),
      consumeBuilderLimit(actorId, "builder-agent-minute", {
        max: 4,
        windowMs: 60_000,
        retryAfter: 60,
      }),
    ]);
    const parsed = requestSchema.safeParse(await readBuilderBody(request));
    if (!parsed.success) {
      return builderJson(
        {
          code: "BUILDER_INVALID_REQUEST",
          error: "A valid bounded Project V2 builder request is required.",
        },
        400,
      );
    }
    if (parsed.data.buildRequestId && parsed.data.mode !== "build") {
      return builderJson(
        {
          code: "BUILDER_INVALID_REQUEST",
          error: "Automatic build request IDs are valid only for initial builds.",
        },
        400,
      );
    }
    const repository = dependencies.repository ?? new SnapshotBuilderProjectRepository();
    let project = await repository.loadAuthorized(actorId, parsed.data.projectId);
    if (!project) {
      return builderJson(
        { code: "BUILDER_PROJECT_NOT_FOUND", error: "Project V2 was not found." },
        404,
      );
    }
    if (parsed.data.buildRequestId) {
      const claim = await claimAutoBuildRequest({
        actorId,
        project,
        repository,
        requestId: parsed.data.buildRequestId,
      });
      project = claim.project;
      if (claim.status === "running") {
        return builderJson(
          {
            code: "BUILDER_REQUEST_IN_PROGRESS",
            status: "running",
            project,
          },
          202,
        );
      }
    }
    const audit = dependencies.audit ?? new ServerBuilderAuditSink();
    const sandboxRuntime =
      dependencies.runtime ?? new VercelSandboxRuntimeAdapter({ audit });
    const executionController = new AbortController();
    const abortForDisconnectedClient = () => executionController.abort();
    request.signal.addEventListener("abort", abortForDisconnectedClient, {
      once: true,
    });
    // A client can disconnect while the request body, rate limit, or project
    // snapshot is being resolved. EventTarget does not replay an abort event to
    // listeners registered afterward, so carry that already-aborted state into
    // the bounded execution controller explicitly.
    if (request.signal.aborted) executionController.abort();
    try {
    const session = new BuilderAgentSession({
      actorId,
      requestId: parsed.data.buildRequestId ?? randomUUID(),
      project,
      repository,
      runtime: sandboxRuntime,
      permissions: ALL_AGENT_PERMISSIONS,
      audit,
      signal: executionController.signal,
      browser: dependencies.browser ?? new VercelAgentBrowserChecker(),
      connections: dependencies.connections,
      publisher: dependencies.publisher,
    });
    // Approval evidence is resolved server-side. Tool names are intentionally
    // absent from the public JSON body so a model cannot approve its own call.
    const approvedTools = await (dependencies.resolveApprovedTools?.(request) ?? []);
    const remembered = await rememberedBuilderConnection(
      request,
      parsed.data.provider,
    );
    const builderInput = { ...parsed.data };
    delete builderInput.buildRequestId;
    const agentRequest = {
      ...builderInput,
      provider: remembered.selection,
      approvedTools: [...approvedTools],
    };
    const agentDependencies = {
      services: session,
      audit,
      credentials: remembered.credentials,
      deterministicFallback:
        dependencies.deterministicFallback ??
        materializedProjectDeterministicFallback,
      modelResolver: dependencies.modelResolver,
      runnerFactory: dependencies.runnerFactory,
      signal: executionController.signal,
    };
    const execution = await withBuilderExecutionDeadline({
      timeoutMs: Math.min(
        Math.max(dependencies.executionTimeoutMs ?? BUILDER_EXECUTION_TIMEOUT_MS, 25),
        BUILDER_EXECUTION_TIMEOUT_MS,
      ),
      controller: executionController,
      operation: async () => {
        const flags = resolveAgentIntelligenceFlags();
        // Initial builds are owned by the deterministic server release pipeline.
        // Letting the composite model choose lifecycle tools allowed checks to run
        // before dependency installation and left projects permanently pending.
        const useCompositeIntelligence =
          flags.compositeModelRouting && parsed.data.mode !== "build";
        const intelligence = useCompositeIntelligence
          ? await (dependencies.intelligenceRunner ?? runIntelligentBuilderAgent)({
              request: agentRequest,
              dependencies: agentDependencies,
              actor: {
                actorId,
                tenantId: actorId,
                workspaceId: actorId,
                branch: `project:${project.id}`,
              },
              project,
              flags,
              evalStore: dependencies.evalStore ?? new DefaultAgentEvalStore(),
            })
          : null;
        const result = intelligence?.result ?? await runBuilderAgent(
          agentRequest,
          agentDependencies,
        );
        return { intelligence, result };
      },
      cleanup: () => stopInterruptedSession({
        actorId,
        repository,
        runtime: sandboxRuntime,
        session,
        cancelled: request.signal.aborted,
      }),
    });
    const { intelligence, result } = execution;
    if (result.releaseGate.ok) {
      const checkpoint = result.project.checkpoints.at(-1);
      if (
        !checkpoint
        || !/^Verified (?:AI|deterministic) build$/.test(checkpoint.label)
        || checkpoint.snapshot.revision !== result.project.revision
        || checkpoint.snapshot.contentHash !== result.project.contentHash
      ) {
        throw new BuilderRouteError(
          503,
          "BUILDER_RELEASE_RECEIPT_UNAVAILABLE",
          "The verified build could not be bound to its server-side release receipt.",
        );
      }
      try {
        await (dependencies.writeReleaseReceipt ?? writeProjectV2ReleaseReceipt)({
          actorId,
          projectId: result.project.id,
          revision: checkpoint.snapshot.revision,
          contentHash: checkpoint.snapshot.contentHash,
          checkpointId: checkpoint.id,
          snapshotHash: checkpoint.snapshotHash,
        });
      } catch {
        throw new BuilderRouteError(
          503,
          "BUILDER_RELEASE_RECEIPT_UNAVAILABLE",
          "The build passed, but its private release receipt could not be persisted. Rebuild before deployment.",
        );
      }
    }
    const settledProject = parsed.data.buildRequestId
      ? await settleAutoBuildRequest({
          actorId,
          projectId: result.project.id,
          repository,
          requestId: parsed.data.buildRequestId,
          status: result.releaseGate.ok ? "succeeded" : "failed",
        })
      : null;
    const settledResult = settledProject
      ? { ...result, project: settledProject }
      : result;
    return builderJson(
      {
        result: settledResult,
        ...(intelligence
          ? {
              intelligence: {
                trace: intelligence.trace,
                verification: intelligence.verification,
                route: intelligence.route,
                tracePersistence: intelligence.tracePersistence,
              },
            }
          : {}),
      },
      settledResult.status === "blocked" ? 422 : 200,
    );
    } catch (error) {
      if (parsed.data.buildRequestId) {
        await settleAutoBuildRequest({
          actorId,
          projectId: project.id,
          repository,
          requestId: parsed.data.buildRequestId,
          status: request.signal.aborted ? "stopped" : "failed",
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      request.signal.removeEventListener("abort", abortForDisconnectedClient);
    }
  } catch (error) {
    return builderRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  return handleBuilderAgentRequest(request);
}
