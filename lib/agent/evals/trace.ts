import { randomUUID } from "node:crypto";
import { assertPrivacySafeTrace, privacySafeActorHash, safePromptMetadata } from "./privacy.ts";
import type { AgentRunTrace, AgentTraceVersions } from "./types.ts";

export const AGENT_EVALS_VERSION = "2.0.0";

export const DEFAULT_AGENT_TRACE_VERSIONS: AgentTraceVersions = {
  runtimeContract: "2.0.0",
  prompt: "2.0.0",
  routing: "2.0.0",
  contextCompiler: "2.0.0",
  orchestrator: "2.0.0",
  evals: AGENT_EVALS_VERSION,
  projectSchema: 2,
  selectedSkills: {},
};

export function createAgentRunTrace(input: {
  runId?: string;
  actorId: string;
  projectId: string;
  projectRevision: number;
  prompt: string;
  configurationId: string;
  versions?: Partial<AgentTraceVersions>;
  experimentId?: string | null;
  assignment?: string | null;
  startedAt?: string;
}): AgentRunTrace {
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(input.projectId)) throw new Error("Trace project id is invalid.");
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) throw new Error("Trace revision is invalid.");
  const metadata = safePromptMetadata(input.prompt);
  const startedAt = new Date(input.startedAt ?? Date.now()).toISOString();
  const trace: AgentRunTrace = {
    schemaVersion: 2,
    traceId: randomUUID(),
    runId: input.runId ?? randomUUID(),
    actorHash: privacySafeActorHash(input.actorId),
    projectId: input.projectId,
    projectRevisionStart: input.projectRevision,
    projectRevisionFinal: input.projectRevision,
    ...metadata,
    versions: { ...DEFAULT_AGENT_TRACE_VERSIONS, ...input.versions },
    configurationId: input.configurationId,
    experimentId: input.experimentId ?? null,
    assignment: input.assignment ?? null,
    startedAt,
    finishedAt: startedAt,
    status: "blocked",
    failureClass: "unknown",
    routes: [],
    contextPackages: [],
    roleRuns: [],
    findings: [],
    checks: [],
    repairs: [],
    verification: {
      verdict: "BLOCKED",
      deterministicGatePassed: false,
      setupRequired: [],
      evidenceIds: [],
    },
    firstPass: { build: false, preview: false, browser: false },
    final: { build: false, preview: false, browser: false, primaryInteraction: false },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedModelCostUsd: 0,
      sandboxDurationMs: 0,
      totalLatencyMs: 0,
    },
  };
  assertPrivacySafeTrace(trace);
  return trace;
}

export function finalizeAgentRunTrace(
  trace: AgentRunTrace,
  patch: Partial<Pick<
    AgentRunTrace,
    | "projectRevisionFinal"
    | "status"
    | "failureClass"
    | "routes"
    | "contextPackages"
    | "roleRuns"
    | "findings"
    | "checks"
    | "repairs"
    | "verification"
    | "firstPass"
    | "final"
    | "usage"
  >> & { finishedAt?: string },
): AgentRunTrace {
  const finishedAt = new Date(patch.finishedAt ?? Date.now()).toISOString();
  const next: AgentRunTrace = {
    ...structuredClone(trace),
    ...structuredClone(patch),
    finishedAt,
    usage: {
      ...(patch.usage ?? trace.usage),
      totalLatencyMs: Math.max(
        patch.usage?.totalLatencyMs ?? trace.usage.totalLatencyMs,
        Date.parse(finishedAt) - Date.parse(trace.startedAt),
      ),
    },
  };
  if (next.repairs.length > 3) throw new Error("Agent trace exceeds the maximum repair iterations.");
  if (next.verification.verdict === "PASS" && !next.verification.deterministicGatePassed) {
    throw new Error("Verifier cannot upgrade a failed deterministic release gate to PASS.");
  }
  assertPrivacySafeTrace(next);
  return next;
}
