import { ToolLoopAgent, isStepCount, type LanguageModel, type ToolSet } from "ai";
import { boundedRuntimeOutput, secretFreeRuntimeMessage } from "../project-runtime-adapter.ts";
import { builderAuditEvent } from "./policy.ts";
import { resolveBuilderModel } from "./providers.ts";
import { createBuilderAgentTools, createBuilderToolApproval } from "./tools.ts";
import type {
  BuilderAgentAuditSink,
  BuilderAgentRequest,
  BuilderAgentResult,
  BuilderDeterministicFallback,
  BuilderModelEvidence,
  BuilderModelResolver,
  BuilderProviderCredentials,
  BuilderReleaseGateResult,
  BuilderToolExecutionServices,
  BuilderToolName,
} from "./types.ts";

const MAX_AUTOMATIC_REPAIRS = 3;
const AGENT_TIMEOUT_MS = 4 * 60_000;

const BUILDER_INSTRUCTIONS = `You are the Drops Studio Project V2 builder agent. Work only through the supplied strict tools and edit the real multi-file project.

Read relevant files before editing. Make the smallest coherent multi-file change that satisfies the user's crypto-product request and preserves category-native DropsTab, Drops Bot, Telegram, and project-data behavior. Generated external-data states must be truthful: label demo data as demo and use Setup required when a connection is absent.

Never request, write, echo, or infer credentials. Never create .env files, lockfiles, symlinks, executable shell snippets, child-process calls, eval, Function constructors, secret placeholders that resemble real tokens, or unrestricted proxies. Do not claim a command, test, browser check, preview, connection, publication, or deployment succeeded unless its tool returned verified success.

Use declared npm tasks only. Run typecheck, lint, tests, production build, live preview, and browser_check. Fix actual errors shown by tools. Destructive file operations, checkpoint restore, and publishing require explicit approval and may stop this turn with an approval request.`;

export interface BuilderAgentRunnerOutput {
  text: string;
  content?: Array<{
    type?: string;
    toolCall?: { toolName?: string };
  }>;
}

export interface BuilderAgentRunner {
  generate(input: {
    prompt: string;
    abortSignal: AbortSignal;
  }): Promise<BuilderAgentRunnerOutput>;
}

export type BuilderAgentRunnerFactory = (input: {
  model: LanguageModel;
  tools: ToolSet;
  approvedTools: ReadonlySet<BuilderToolName>;
}) => BuilderAgentRunner;

export interface RunBuilderAgentDependencies {
  services: BuilderToolExecutionServices;
  audit: BuilderAgentAuditSink;
  credentials?: BuilderProviderCredentials;
  modelResolver?: BuilderModelResolver;
  deterministicFallback?: BuilderDeterministicFallback;
  runnerFactory?: BuilderAgentRunnerFactory;
  signal?: AbortSignal;
}

export const materializedProjectDeterministicFallback: BuilderDeterministicFallback = {
  async run({ mode, services }) {
    if (mode !== "build") {
      throw new Error(
        "Free Auto can build the deterministic Project V2 starter, but AI file edits require a connected provider.",
      );
    }
    const files = services.listFiles();
    if (!files.includes("package.json") || files.length < 2) {
      throw new Error(
        "Free Auto requires an already materialized deterministic Project V2 starter.",
      );
    }
    await services.ensureRuntime();
    return {
      summary:
        "Free Auto prepared the deterministic Project V2 starter for bounded Sandbox verification without an AI provider.",
    };
  },
};

function defaultRunnerFactory(input: {
  model: LanguageModel;
  tools: ToolSet;
  approvedTools: ReadonlySet<BuilderToolName>;
}): BuilderAgentRunner {
  const agent = new ToolLoopAgent({
    id: "drops-studio-project-v2-builder",
    model: input.model,
    tools: input.tools,
    instructions: BUILDER_INSTRUCTIONS,
    maxRetries: 0,
    maxOutputTokens: 12_000,
    stopWhen: isStepCount(24),
    toolApproval: createBuilderToolApproval(input.approvedTools),
    include: {
      requestBody: false,
      requestMessages: false,
      responseBody: false,
    },
  });
  return {
    generate: ({ prompt, abortSignal }) =>
      agent.generate({ prompt, abortSignal, timeout: AGENT_TIMEOUT_MS }),
  };
}

function emptyGate(error: string): BuilderReleaseGateResult {
  return {
    ok: false,
    checks: [],
    blockingErrors: [error],
    previewUrl: null,
  };
}

function safeSummary(value: unknown, fallback: string): string {
  return boundedRuntimeOutput(
    typeof value === "string" ? value : "",
    "builder agent summary",
    4_000,
  ).value || fallback;
}

function approvalRequests(output: BuilderAgentRunnerOutput): BuilderToolName[] {
  const names = new Set<BuilderToolName>();
  for (const part of output.content ?? []) {
    if (part.type !== "tool-approval-request") continue;
    const name = part.toolCall?.toolName as BuilderToolName | undefined;
    if (name) names.add(name);
  }
  return [...names];
}

function agentPrompt(
  request: BuilderAgentRequest,
  attempt: number,
  gate: BuilderReleaseGateResult | null,
): string {
  if (attempt === 0) {
    return `User request:\n${request.prompt}\n\nMode: ${request.mode}. Inspect the real Project V2 files, implement the request, and verify the complete release gate.`;
  }
  const failures = gate?.blockingErrors.slice(0, 12).join("\n- ") || "The prior agent turn failed before verification.";
  return `Automatic repair ${attempt} of ${MAX_AUTOMATIC_REPAIRS}. Inspect current files and real logs, fix only the verified failures, then rerun checks.\n\nBlocking failures:\n- ${failures}`;
}

async function auditAgent(
  dependencies: RunBuilderAgentDependencies,
  status: "started" | "succeeded" | "failed" | "denied",
  detail?: unknown,
): Promise<void> {
  await dependencies.audit.record(
    builderAuditEvent({
      actorId: dependencies.services.actorId,
      requestId: dependencies.services.requestId,
      projectId: dependencies.services.project.id,
      tool: "agent",
      status,
      detail,
    }),
  );
}

export async function runBuilderAgent(
  request: BuilderAgentRequest,
  dependencies: RunBuilderAgentDependencies,
): Promise<BuilderAgentResult> {
  if (
    request.projectId !== dependencies.services.project.id ||
    !request.prompt.trim() ||
    request.prompt.length > 20_000
  ) {
    throw new Error("Builder agent request is invalid.");
  }
  await auditAgent(dependencies, "started");

  if (request.provider.provider === "free") {
    if (!dependencies.deterministicFallback) {
      const message = "Deterministic fallback generation is not configured.";
      await auditAgent(dependencies, "failed", message);
      return {
        status: "blocked",
        providerMode: "deterministic-fallback",
        summary: message,
        project: dependencies.services.project,
        attempts: 0,
        repairs: 0,
        releaseGate: emptyGate(message),
        evidence: null,
        approvalTools: [],
      };
    }
    try {
      const fallback = await dependencies.deterministicFallback.run({
        prompt: request.prompt,
        mode: request.mode,
        services: dependencies.services,
      });
      const releaseGate = await dependencies.services.runReleaseGate({ install: true });
      if (releaseGate.ok) {
        await dependencies.services.createCheckpoint("Verified deterministic build");
      }
      await auditAgent(
        dependencies,
        releaseGate.ok ? "succeeded" : "failed",
        releaseGate.ok ? undefined : releaseGate.blockingErrors.join("; "),
      );
      return {
        status: releaseGate.ok ? "fallback" : "blocked",
        providerMode: "deterministic-fallback",
        summary: safeSummary(
          fallback.summary,
          releaseGate.ok
            ? "Deterministic fallback build completed."
            : "Deterministic fallback build is blocked.",
        ),
        project: dependencies.services.project,
        attempts: 1,
        repairs: 0,
        releaseGate,
        evidence: null,
        approvalTools: [],
      };
    } catch (error) {
      const message = secretFreeRuntimeMessage(
        error,
        "Deterministic fallback build failed.",
      );
      await auditAgent(dependencies, "failed", message);
      return {
        status: "blocked",
        providerMode: "deterministic-fallback",
        summary: message,
        project: dependencies.services.project,
        attempts: 1,
        repairs: 0,
        releaseGate: emptyGate(message),
        evidence: null,
        approvalTools: [],
      };
    }
  }

  const resolved = await (dependencies.modelResolver ?? resolveBuilderModel)(
    request.provider,
    dependencies.credentials ?? {},
  );
  const approved = new Set(request.approvedTools ?? []);
  const tools = createBuilderAgentTools(dependencies.services, dependencies.audit);
  const runner = (dependencies.runnerFactory ?? defaultRunnerFactory)({
    model: resolved.model,
    tools,
    approvedTools: approved,
  });
  let gate: BuilderReleaseGateResult | null = null;
  let lastSummary = "AI builder did not return a completion summary.";

  for (let attempt = 0; attempt <= MAX_AUTOMATIC_REPAIRS; attempt += 1) {
    let output: BuilderAgentRunnerOutput;
    try {
      output = await runner.generate({
        prompt: agentPrompt(request, attempt, gate),
        abortSignal: dependencies.signal
          ? AbortSignal.any([
              dependencies.signal,
              AbortSignal.timeout(AGENT_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(AGENT_TIMEOUT_MS),
      });
      lastSummary = safeSummary(output.text, lastSummary);
    } catch (error) {
      if (dependencies.signal?.aborted) {
        gate = emptyGate("Builder execution was stopped by the user.");
        lastSummary = "Builder stopped. Saved project files and the last working preview were preserved.";
        break;
      }
      gate = emptyGate(
        secretFreeRuntimeMessage(error, "AI builder provider call failed."),
      );
      if (attempt < MAX_AUTOMATIC_REPAIRS) continue;
      break;
    }

    const approvals = approvalRequests(output);
    if (approvals.length) {
      await auditAgent(dependencies, "denied", "Explicit user approval is required.");
      return result({
        status: "approval-required",
        summary: lastSummary,
        attempts: attempt + 1,
        repairs: attempt,
        gate: gate ?? emptyGate("Explicit user approval is required."),
        evidence: resolved.evidence,
        approvals,
        services: dependencies.services,
      });
    }

    gate = await dependencies.services.runReleaseGate({ install: true });
    if (gate.ok) {
      try {
        await dependencies.services.createCheckpoint("Verified AI build");
      } catch (error) {
        gate = {
          ...gate,
          ok: false,
          blockingErrors: [
            ...gate.blockingErrors,
            secretFreeRuntimeMessage(error, "Verified checkpoint creation failed."),
          ],
        };
      }
    }
    if (gate.ok) {
      await auditAgent(dependencies, "succeeded");
      return result({
        status: "completed",
        summary: lastSummary,
        attempts: attempt + 1,
        repairs: attempt,
        gate,
        evidence: resolved.evidence,
        approvals: [],
        services: dependencies.services,
      });
    }
  }

  const finalGate = gate ?? emptyGate("AI builder stopped before release verification.");
  await auditAgent(dependencies, "failed", finalGate.blockingErrors.join("; "));
  return result({
    status: "blocked",
    summary: lastSummary,
    attempts: MAX_AUTOMATIC_REPAIRS + 1,
    repairs: MAX_AUTOMATIC_REPAIRS,
    gate: finalGate,
    evidence: resolved.evidence,
    approvals: [],
    services: dependencies.services,
  });
}

function result(input: {
  status: BuilderAgentResult["status"];
  summary: string;
  attempts: number;
  repairs: number;
  gate: BuilderReleaseGateResult;
  evidence: BuilderModelEvidence;
  approvals: BuilderToolName[];
  services: BuilderToolExecutionServices;
}): BuilderAgentResult {
  return {
    status: input.status,
    providerMode: "ai-agent",
    summary: input.summary,
    project: input.services.project,
    attempts: input.attempts,
    repairs: input.repairs,
    releaseGate: input.gate,
    evidence: input.evidence,
    approvalTools: input.approvals,
  };
}
