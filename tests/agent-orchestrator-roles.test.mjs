import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const {
  MemoryAgentRunStore,
  MultiAgentOrchestrator,
  SubagentApprovalError,
  assertSubagentActionAllowed,
  createRoleContext,
  runRoleTask,
  runSeededParallelExecution,
} = await import("../lib/agent/orchestrator/index.ts");

function spec() {
  return createProjectSpec({
    presetId: "whale-tracker",
    values: {},
    prompt: "Build whale intelligence",
    tools: ["DropsTab API", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

async function project() {
  return materializeProjectV2Template({ id: "role-fixture", spec: spec(), now: "2026-07-30T10:00:00.000Z" });
}

function task(current, role, overrides = {}) {
  const readOnly = role === "planner" || role === "qa" || role === "security";
  return {
    taskId: role,
    runId: "role-run",
    role,
    title: `${role} task`,
    objective: `${role} objective`,
    dependencies: [],
    priority: 10,
    baseRevision: current.revision,
    baseContentHash: current.contentHash,
    readScopes: ["components/**"],
    writeScopes: readOnly ? [] : ["components/**"],
    protectedScopes: ["package.json"],
    integrationScopes: [],
    contextQueryIds: [],
    selectedSkills: [],
    modelRouteId: `route:${role}`,
    executionMode: readOnly ? "read-only" : "patch-only",
    acceptanceChecks: ["complete"],
    expectedArtifacts: [],
    risk: "low",
    estimatedCostUsd: 0,
    limits: { maxModelCalls: 1, maxToolCalls: 4, timeoutMs: 2_000, maxChangedFiles: readOnly ? 0 : 2, maxChangedLines: readOnly ? 0 : 100 },
    status: "queued",
    ...overrides,
  };
}

function plannerResult(graph) {
  return {
    architecture: ["bounded patches"],
    taskGraph: graph,
    decisions: [],
    setupRequired: [],
    unsupported: [],
    acceptanceMatrix: ["canonical unchanged on failure"],
  };
}

test("role context includes scoped files only and reviewer has no mutation capability", async () => {
  const current = await project();
  const qa = task(current, "qa");
  const context = createRoleContext({ project: current, task: qa, signal: new AbortController().signal });
  assert.ok(Object.keys(context.files).every((path) => path.startsWith("components/")));
  assert.equal("package.json" in context.files, false);
  assert.deepEqual(context.capabilities, ["list-files", "read-file", "report-findings"]);
  assert.equal(context.capabilities.includes("propose-patch"), false);
  assert.throws(() => {
    context.files["components/Injected.tsx"] = { path: "components/Injected.tsx", content: "bad", hash: "a".repeat(64) };
  }, TypeError);
});

test("QA and Security mutation-shaped output is rejected", async () => {
  const current = await project();
  const qa = task(current, "qa");
  await assert.rejects(
    () => runRoleTask({
      project: current,
      task: qa,
      signal: new AbortController().signal,
      execute: async () => ({
        findings: [],
        checksRequested: [],
        primaryFlowStatus: "passed",
        repairTasks: [],
        patchBundle: {},
      }),
    }),
    /cannot return mutations/i,
  );
});

test("subagents cannot publish, deploy, push, register webhooks, or trade", () => {
  for (const action of ["github-push", "deploy", "register-webhook", "publish-telegram", "trade-action"]) {
    assert.throws(() => assertSubagentActionAllowed("integration", action), SubagentApprovalError);
  }
  assert.doesNotThrow(() => assertSubagentActionAllowed("integration", "read-official-docs"));
});

test("a failed builder leaves canonical Project V2 byte-for-byte unchanged", async () => {
  const current = await project();
  const before = structuredClone(current);
  const frontend = task(current, "frontend");
  const planner = task(current, "planner", { taskId: "planner" });
  const orchestrator = new MultiAgentOrchestrator();
  const run = await orchestrator.run({
    runId: "role-run",
    project: current,
    plannerTask: planner,
    runners: {
      planner: async () => plannerResult([frontend]),
      frontend: async () => { throw new Error("seeded frontend failure"); },
    },
  });
  assert.equal(run.status, "failed");
  assert.deepEqual(run.canonicalProject, before);
  assert.deepEqual(current, before);
});

test("failed durable run can resume from its canonical revision", async () => {
  const current = await project();
  const store = new MemoryAgentRunStore();
  const frontend = task(current, "frontend");
  const planner = task(current, "planner", { taskId: "planner" });
  const orchestrator = new MultiAgentOrchestrator({ store });
  const failed = await orchestrator.run({
    runId: "role-run",
    project: current,
    plannerTask: planner,
    runners: {
      planner: async () => plannerResult([frontend]),
      frontend: async () => { throw new Error("transient provider failure"); },
    },
  });
  assert.equal(failed.status, "failed");
  const resumed = await orchestrator.resume("role-run", {
    frontend: async (context) => ({
      taskId: "frontend",
      patchBundle: {
        taskId: "frontend",
        role: "frontend",
        baseRevision: context.baseRevision,
        baseContentHash: context.baseContentHash,
        expectedFileHashes: { "components/Resumed.tsx": null },
        operations: [{ type: "write", path: "components/Resumed.tsx", content: "export const Resumed = true;\n", provenance: "ai" }],
        dependencyChanges: [],
        testsToRun: ["typecheck"],
        summary: "Resume safely",
        unresolvedAssumptions: [],
        contextProvenanceIds: [],
      },
      evidenceIds: [],
      assumptions: [],
      followUps: [],
    }),
  });
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.canonicalProject.revision, current.revision + 1);
  assert.ok(resumed.canonicalProject.files["components/Resumed.tsx"]);
});

test("Orchestrator cancellation propagates to the active role without merging", async () => {
  const current = await project();
  const frontend = task(current, "frontend");
  const planner = task(current, "planner", { taskId: "planner" });
  const orchestrator = new MultiAgentOrchestrator();
  const running = orchestrator.run({
    runId: "role-run",
    project: current,
    plannerTask: planner,
    runners: {
      planner: async () => plannerResult([frontend]),
      frontend: async (context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      }),
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(orchestrator.cancel("role-run"), true);
  const cancelled = await running;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.canonicalProject.contentHash, current.contentHash);
});

test("critical Security evidence blocks verification without mutating canonical files", async () => {
  const current = await project();
  const security = task(current, "security");
  const planner = task(current, "planner", { taskId: "planner" });
  const orchestrator = new MultiAgentOrchestrator();
  const run = await orchestrator.run({
    runId: "role-run",
    project: current,
    plannerTask: planner,
    runners: {
      planner: async () => plannerResult([security]),
      security: async () => ({
        findings: [{
          findingId: "critical-secret",
          role: "security",
          severity: "critical",
          category: "secret",
          title: "Secret detected",
          detail: "Seeded blocking evidence.",
          evidenceIds: ["evidence:secret"],
          relevantPaths: ["lib/provider.ts"],
          recommendedAction: "Remove the secret.",
          blocksVerification: true,
        }],
        blocked: true,
        requiredApprovals: [],
        repairTasks: [],
      }),
    },
  });
  assert.equal(run.status, "failed");
  assert.match(run.failure, /blocks verification/i);
  assert.equal(run.findings[0].severity, "critical");
  assert.equal(run.canonicalProject.contentHash, current.contentHash);
  assert.equal(run.tasks.find((entry) => entry.taskId === "security")?.status, "failed");
});

test("duplicate active run ids cannot overwrite cancellation ownership", async () => {
  const current = await project();
  const planner = task(current, "planner", { taskId: "planner" });
  const orchestrator = new MultiAgentOrchestrator();
  const running = orchestrator.run({
    runId: "role-run",
    project: current,
    plannerTask: planner,
    runners: {
      planner: async (context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      }),
    },
  });
  await assert.rejects(
    () => orchestrator.run({
      runId: "role-run",
      project: current,
      plannerTask: planner,
      runners: { planner: async () => plannerResult([]) },
    }),
    /already active/,
  );
  assert.equal(orchestrator.cancel("role-run"), true);
  assert.equal((await running).status, "cancelled");
});

test("resume rejects a failed run that never produced a task graph", async () => {
  const current = await project();
  const store = new MemoryAgentRunStore();
  await store.save({
    runId: "empty-run",
    status: "failed",
    canonicalProject: current,
    tasks: [],
    timelines: [],
    findings: [],
    failure: "Planner failed before producing a graph.",
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
  });
  const orchestrator = new MultiAgentOrchestrator({ store });
  await assert.rejects(() => orchestrator.resume("empty-run", {}), /must be planned again/);
});

test("seeded fixture proves Planner, parallel builders, atomic merge, and parallel read-only reviewers", async () => {
  const current = await project();
  const evidence = await runSeededParallelExecution({ project: current, runId: "seeded-proof" });
  assert.equal(evidence.plannerExecuted, true);
  assert.equal(evidence.frontendIntegrationOverlap, true);
  assert.equal(evidence.qaSecurityOverlap, true);
  assert.equal(evidence.run.status, "completed");
  assert.equal(evidence.run.canonicalProject.revision, current.revision + 1);
  assert.ok(evidence.run.canonicalProject.files["components/AgentParallelPanel.tsx"]);
  assert.ok(evidence.run.canonicalProject.files["lib/drops-intelligence-agent.ts"]);
  assert.deepEqual(evidence.run.findings, []);
});
