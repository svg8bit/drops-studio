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

const evals = await import("../lib/agent/evals/index.ts");

test("benchmark registry contains at least twenty category-native fixtures", () => {
  assert.ok(evals.AGENT_BENCHMARK_CASES.length >= 20);
  const categories = new Set(evals.AGENT_BENCHMARK_CASES.map((entry) => entry.category));
  assert.deepEqual([...categories].sort(), ["build", "edit", "integration", "release", "repair", "retrieval", "security"]);
  assert.ok(evals.AGENT_BENCHMARK_CASES.some((entry) => /whale intelligence/i.test(entry.prompt)));
  assert.ok(evals.AGENT_BENCHMARK_CASES.some((entry) => /playable crypto game/i.test(entry.prompt)));
});

test("privacy-safe traces retain versions and metrics without credentials or private reasoning", () => {
  const trace = evals.createAgentRunTrace({
    actorId: "member-actor",
    projectId: "whale-eval",
    projectRevision: 2,
    prompt: `Build a whale product using sk-${"A".repeat(32)} and do not store private scratchpad`,
    configurationId: "balanced-hybrid-parallel",
  });
  assert.match(trace.actorHash, /^[a-f0-9]{64}$/);
  assert.equal(trace.versions.projectSchema, 2);
  assert.equal(JSON.stringify(trace).includes("sk-"), false);
  assert.throws(() => evals.finalizeAgentRunTrace(trace, {
    verification: {
      verdict: "PASS",
      deterministicGatePassed: false,
      setupRequired: [],
      evidenceIds: [],
    },
  }), /cannot upgrade/i);
});

test("offline contract benchmark compares routing configurations and records truthful mode evidence", async () => {
  const cases = evals.benchmarkCasesForSuite("local-fast");
  const report = await evals.runAgentBenchmark({
    suite: "local-fast",
    cases,
    configurations: evals.DEFAULT_BENCHMARK_CONFIGURATIONS,
    execute: evals.executeOfflineContractBenchmark,
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 6, 30, 12, 0, tick++));
    })(),
  });
  assert.equal(report.configurations.length, 2);
  assert.equal(report.cases.length, cases.length * 2);
  assert.ok(report.cases.every((entry) => entry.evidenceIds.some((id) => id.startsWith("offline-fixture:"))));
  assert.ok(report.configurations.every((entry) => entry.totalEstimatedCostUsd >= 0));
  assert.equal(report.releaseGate.passed, true);
});

test("release eval gate cannot hide deterministic or verifier regressions", () => {
  const fixture = evals.AGENT_BENCHMARK_CASES.find((entry) => entry.id === "release-verifier-blocks-build");
  assert.ok(fixture);
  const result = {
    caseId: fixture.id,
    configurationId: "broken",
    passed: true,
    routeMatched: true,
    contextRecall: 1,
    deterministicGatePassed: false,
    verdict: "PASS",
    firstPassSuccess: false,
    finalSuccess: true,
    repairCount: 0,
    latencyMs: 1,
    estimatedCostUsd: 0,
    failureClass: "build",
    evidenceIds: [],
  };
  const gate = evals.evaluateAgentReleaseGate([fixture], [result], {
    minimumSuccessRate: 0,
    minimumContextRecall: 0,
    maximumAverageRepairCount: 3,
    maximumUnsafeVerdicts: 1,
  });
  assert.equal(gate.passed, false);
  assert.ok(gate.blockers.some((entry) => /upgraded a deterministic failure/i.test(entry)));
});

test("experiment assignment is stable and auto-pause protects quality and cost", () => {
  const experiment = {
    experimentId: "routing-canary",
    version: "2",
    status: "canary",
    variants: [
      { id: "control", weight: 90, configurationId: "balanced" },
      { id: "candidate", weight: 10, configurationId: "quality" },
    ],
    minimumSamples: 20,
    maximumFailureRate: 0.1,
    maximumCostRegression: 0.2,
  };
  const first = evals.assignAgentExperiment(experiment, "a".repeat(64), "project");
  const second = evals.assignAgentExperiment(experiment, "a".repeat(64), "project");
  assert.deepEqual(first, second);
  const pause = evals.experimentAutoPause({
    experiment,
    control: { id: "control", label: "Control", cases: 20, successRate: 0.95, firstPassRate: 0.8, averageRepairCount: 0.5, averageLatencyMs: 100, totalEstimatedCostUsd: 1, deterministicBlockers: 0 },
    candidate: { id: "candidate", label: "Candidate", cases: 20, successRate: 0.7, firstPassRate: 0.5, averageRepairCount: 1.5, averageLatencyMs: 150, totalEstimatedCostUsd: 1.5, deterministicBlockers: 1 },
  });
  assert.equal(pause.pause, true);
  assert.ok(pause.reasons.length >= 2);
});

test("local trace store is private, bounded, retained and project-deletable", async () => {
  const previous = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_AGENT_EVAL_TRACES__ = new Map();
  try {
    const store = new evals.DefaultAgentEvalStore();
    const trace = evals.finalizeAgentRunTrace(evals.createAgentRunTrace({
      actorId: "member-a",
      projectId: "trace-project",
      projectRevision: 1,
      prompt: "Build a safe whale dashboard",
      configurationId: "balanced",
      startedAt: "2026-07-30T12:00:00.000Z",
    }), {
      finishedAt: "2026-07-30T12:01:00.000Z",
      status: "completed",
      failureClass: "none",
      verification: { verdict: "PASS", deterministicGatePassed: true, setupRequired: [], evidenceIds: ["build"] },
      final: { build: true, preview: true, browser: true, primaryInteraction: true },
    });
    await store.writeTrace(trace);
    assert.equal((await store.listTraces()).length, 1);
    await store.deleteProject(trace.actorHash, trace.projectId);
    assert.equal((await store.listTraces()).length, 0);
  } finally {
    globalThis.__DROPS_AGENT_EVAL_TRACES__ = undefined;
    if (previous === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previous;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});
