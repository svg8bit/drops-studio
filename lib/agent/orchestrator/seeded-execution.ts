import type { ProjectV2 } from "../../project-v2-types.ts";
import {
  createFrontendSubagent,
  createIntegrationSubagent,
  createPlannerSubagent,
  createQaSubagent,
  createSecuritySubagent,
} from "../subagents/index.ts";
import { MultiAgentOrchestrator } from "./orchestrator.ts";
import { timelinesOverlap } from "./scheduler.ts";
import type {
  AgentRunState,
  AgentTask,
  AgentTaskTimeline,
  BuilderSubagentResult,
  PlannerResult,
  QaResult,
  SecurityResult,
} from "./types.ts";

const FRONTEND_PATH = "components/AgentParallelPanel.tsx";
const INTEGRATION_PATH = "lib/drops-intelligence-agent.ts";

function task(input: {
  runId: string;
  project: ProjectV2;
  taskId: string;
  role: AgentTask["role"];
  dependencies?: string[];
  readScopes: string[];
  writeScopes?: string[];
}): AgentTask {
  const readOnly = input.role === "planner" || input.role === "qa" || input.role === "security";
  return {
    taskId: input.taskId,
    runId: input.runId,
    role: input.role,
    title: `${input.role} seeded task`,
    objective: `Execute the deterministic ${input.role} fixture.`,
    dependencies: input.dependencies ?? [],
    priority: input.role === "qa" || input.role === "security" ? 10 : 20,
    baseRevision: input.project.revision,
    baseContentHash: input.project.contentHash,
    readScopes: input.readScopes,
    writeScopes: input.writeScopes ?? [],
    protectedScopes: ["package.json"],
    integrationScopes: input.role === "integration" ? ["dropstab:coins"] : [],
    contextQueryIds: [`ctx:${input.taskId}`],
    selectedSkills: [`role:${input.role}`],
    modelRouteId: `seeded:${input.role}`,
    executionMode: readOnly ? "read-only" : "patch-only",
    acceptanceChecks: [`${input.role} fixture returns structured evidence`],
    expectedArtifacts: input.writeScopes ?? [],
    risk: "low",
    estimatedCostUsd: 0,
    limits: {
      maxModelCalls: 1,
      maxToolCalls: readOnly ? 8 : 12,
      timeoutMs: 2_000,
      maxChangedFiles: readOnly ? 0 : 2,
      maxChangedLines: readOnly ? 0 : 120,
    },
    status: "queued",
  };
}

function delay(signal: AbortSignal, ms = 12): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Seeded task cancelled."));
      },
      { once: true },
    );
  });
}

function timeline(state: AgentRunState, taskId: string): AgentTaskTimeline {
  const entry = state.timelines.find((item) => item.taskId === taskId);
  if (!entry) throw new Error(`Seeded task ${taskId} did not record a timeline.`);
  return entry;
}

export interface SeededParallelExecutionEvidence {
  run: AgentRunState;
  plannerExecuted: true;
  frontendIntegrationOverlap: boolean;
  qaSecurityOverlap: boolean;
  frontendTimeline: AgentTaskTimeline;
  integrationTimeline: AgentTaskTimeline;
  qaTimeline: AgentTaskTimeline;
  securityTimeline: AgentTaskTimeline;
}

export async function runSeededParallelExecution(input: {
  project: ProjectV2;
  runId?: string;
}): Promise<SeededParallelExecutionEvidence> {
  const runId = input.runId ?? "seeded-parallel-run";
  const frontend = task({
    runId,
    project: input.project,
    taskId: "frontend",
    role: "frontend",
    readScopes: ["app/**", "components/**"],
    writeScopes: ["components/**"],
  });
  const integration = task({
    runId,
    project: input.project,
    taskId: "integration",
    role: "integration",
    readScopes: ["lib/**"],
    writeScopes: ["lib/**"],
  });
  const qa = task({
    runId,
    project: input.project,
    taskId: "qa",
    role: "qa",
    dependencies: ["frontend", "integration"],
    readScopes: ["**"],
  });
  const security = task({
    runId,
    project: input.project,
    taskId: "security",
    role: "security",
    dependencies: ["frontend", "integration"],
    readScopes: ["**"],
  });
  const graph = [frontend, integration, qa, security];
  const plannerTask = task({
    runId,
    project: input.project,
    taskId: "planner",
    role: "planner",
    readScopes: ["**"],
  });

  const planner = createPlannerSubagent(async (context): Promise<PlannerResult> => {
    await delay(context.signal, 1);
    return {
      architecture: ["Frontend and DropsTab integration patches share one immutable Project V2 base."],
      taskGraph: graph,
      decisions: [{ decision: "Run disjoint builders concurrently.", reasonCodes: ["disjoint-scopes"] }],
      setupRequired: [],
      unsupported: [],
      acceptanceMatrix: ["parallel-overlap", "atomic-merge", "read-only-reviewers"],
    };
  });
  const frontendRunner = createFrontendSubagent(async (context): Promise<BuilderSubagentResult> => {
    await delay(context.signal);
    return {
      taskId: context.task.taskId,
      patchBundle: {
        taskId: context.task.taskId,
        role: "frontend",
        baseRevision: context.baseRevision,
        baseContentHash: context.baseContentHash,
        expectedFileHashes: { [FRONTEND_PATH]: context.files[FRONTEND_PATH]?.hash ?? null },
        operations: [
          {
            type: "write",
            path: FRONTEND_PATH,
            content: "export function AgentParallelPanel() { return <section aria-label=\"Parallel role evidence\">Whale intelligence ready</section>; }\n",
            provenance: "ai",
          },
        ],
        dependencyChanges: [],
        testsToRun: ["typecheck"],
        summary: "Add the seeded whale-intelligence UI evidence panel.",
        unresolvedAssumptions: [],
        contextProvenanceIds: context.contextQueryIds as string[],
      },
      evidenceIds: ["evidence:frontend-patch"],
      assumptions: [],
      followUps: [],
    };
  });
  const integrationRunner = createIntegrationSubagent(async (context): Promise<BuilderSubagentResult> => {
    await delay(context.signal);
    return {
      taskId: context.task.taskId,
      patchBundle: {
        taskId: context.task.taskId,
        role: "integration",
        baseRevision: context.baseRevision,
        baseContentHash: context.baseContentHash,
        expectedFileHashes: { [INTEGRATION_PATH]: context.files[INTEGRATION_PATH]?.hash ?? null },
        operations: [
          {
            type: "write",
            path: INTEGRATION_PATH,
            content: "export const dropsIntelligenceEvidence = { provider: \"DropsTab\", endpoint: \"coins\", mode: \"proxy-or-demo\" } as const;\n",
            provenance: "ai",
          },
        ],
        dependencyChanges: [],
        testsToRun: ["typecheck"],
        summary: "Add truthful seeded DropsTab provider evidence.",
        unresolvedAssumptions: [],
        contextProvenanceIds: context.contextQueryIds as string[],
      },
      evidenceIds: ["evidence:integration-patch"],
      assumptions: [],
      followUps: [],
    };
  });
  const qaRunner = createQaSubagent(async (context): Promise<QaResult> => {
    await delay(context.signal);
    return { findings: [], checksRequested: ["typecheck", "browser-smoke"], primaryFlowStatus: "passed", repairTasks: [] };
  });
  const securityRunner = createSecuritySubagent(async (context): Promise<SecurityResult> => {
    await delay(context.signal);
    return { findings: [], blocked: false, requiredApprovals: [], repairTasks: [] };
  });

  const orchestrator = new MultiAgentOrchestrator({
    limits: { maxActiveSubagents: 3, maxParallelModelCalls: 3, maxTotalRoleCallsPerRun: 12, maxEstimatedCostUsd: 1 },
  });
  const run = await orchestrator.run({
    runId,
    project: input.project,
    plannerTask,
    runners: {
      planner,
      frontend: frontendRunner,
      integration: integrationRunner,
      qa: qaRunner,
      security: securityRunner,
    },
  });
  if (run.status !== "completed") throw new Error(run.failure ?? "Seeded parallel run did not complete.");
  const frontendTimeline = timeline(run, "frontend");
  const integrationTimeline = timeline(run, "integration");
  const qaTimeline = timeline(run, "qa");
  const securityTimeline = timeline(run, "security");
  return {
    run,
    plannerExecuted: true,
    frontendIntegrationOverlap: timelinesOverlap(frontendTimeline, integrationTimeline),
    qaSecurityOverlap: timelinesOverlap(qaTimeline, securityTimeline),
    frontendTimeline,
    integrationTimeline,
    qaTimeline,
    securityTimeline,
  };
}
