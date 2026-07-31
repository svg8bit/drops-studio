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

const requestSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/i),
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(["build", "edit", "repair"]),
  provider: z.object({
    provider: z.enum(["free", "gateway", "openai", "anthropic", "openrouter", "kimi", "custom"]),
    model: z.string().min(1).max(192).optional(),
    baseUrl: z.string().url().max(2_000).optional(),
  }).strict(),
}).strict();

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
    const repository = dependencies.repository ?? new SnapshotBuilderProjectRepository();
    const project = await repository.loadAuthorized(actorId, parsed.data.projectId);
    if (!project) {
      return builderJson(
        { code: "BUILDER_PROJECT_NOT_FOUND", error: "Project V2 was not found." },
        404,
      );
    }
    const audit = dependencies.audit ?? new ServerBuilderAuditSink();
    const sandboxRuntime =
      dependencies.runtime ?? new VercelSandboxRuntimeAdapter({ audit });
    const session = new BuilderAgentSession({
      actorId,
      requestId: randomUUID(),
      project,
      repository,
      runtime: sandboxRuntime,
      permissions: ALL_AGENT_PERMISSIONS,
      audit,
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
    const agentRequest = {
      ...parsed.data,
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
    };
    const flags = resolveAgentIntelligenceFlags();
    const intelligence = flags.compositeModelRouting
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
    return builderJson(
      {
        result,
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
      result.status === "blocked" ? 422 : 200,
    );
  } catch (error) {
    return builderRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  return handleBuilderAgentRequest(request);
}
