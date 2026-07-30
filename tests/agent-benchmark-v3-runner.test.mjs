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

function passingResult(fixture, configurationId = "test-config") {
  return {
    caseId: fixture.id,
    configurationId,
    passed: true,
    routeMatched: true,
    contextRecall: 1,
    deterministicGatePassed: true,
    verdict: fixture.deterministicBlocker ? "BLOCKED" : "PASS",
    firstPassSuccess: !fixture.deterministicBlocker,
    finalSuccess: true,
    repairCount: 0,
    latencyMs: 1,
    estimatedCostUsd: 0,
    failureClass: fixture.seededFailure,
    evidenceIds: ["test:evidence"],
  };
}

const permissiveThresholds = {
  minimumSuccessRate: 0,
  minimumContextRecall: 0,
  maximumAverageRepairCount: 3,
  maximumUnsafeVerdicts: 10,
};

test("release gate rejects missing, unknown, and duplicate case results per configuration", () => {
  const fixtures = evals.AGENT_BENCHMARK_CASES.slice(0, 2);
  const first = passingResult(fixtures[0]);

  const missing = evals.evaluateAgentReleaseGate(fixtures, [first], permissiveThresholds);
  assert.equal(missing.passed, false);
  assert.ok(missing.blockers.some((entry) => entry.includes(`Missing benchmark result test-config:${fixtures[1].id}`)));

  const duplicate = evals.evaluateAgentReleaseGate([fixtures[0]], [first, structuredClone(first)], permissiveThresholds);
  assert.equal(duplicate.passed, false);
  assert.ok(duplicate.blockers.some((entry) => entry.includes("Duplicate benchmark result")));

  const unknownResult = { ...first, caseId: "unknown-case" };
  const unknown = evals.evaluateAgentReleaseGate([fixtures[0]], [first, unknownResult], permissiveThresholds);
  assert.equal(unknown.passed, false);
  assert.ok(unknown.blockers.some((entry) => entry.includes("Unknown benchmark result")));
});

test("runner enforces a real wall-clock timeout when executor ignores AbortSignal", async () => {
  const fixture = evals.AGENT_BENCHMARK_CASES[0];
  const startedAt = Date.now();
  await assert.rejects(() => evals.runAgentBenchmark({
    suite: "local-fast",
    cases: [fixture],
    configurations: [evals.DEFAULT_BENCHMARK_CONFIGURATIONS[0]],
    execute: async () => new Promise(() => {}),
    timeoutMs: 20,
  }), /timed out after 20ms/i);
  assert.ok(Date.now() - startedAt < 500, "executor must not keep the benchmark pending");
});

test("offline CI contract executes all 120 canonical fixtures exactly once", async () => {
  const cases = evals.benchmarkCasesForSuite("ci");
  const report = await evals.runAgentBenchmark({
    suite: "ci",
    cases,
    configurations: [evals.DEFAULT_BENCHMARK_CONFIGURATIONS[0]],
    execute: evals.executeOfflineContractBenchmark,
    concurrency: 8,
  });
  assert.equal(report.cases.length, 120);
  assert.equal(new Set(report.cases.map((entry) => entry.caseId)).size, 120);
  assert.equal(report.releaseGate.passed, true, report.releaseGate.blockers.join("\n"));
});
