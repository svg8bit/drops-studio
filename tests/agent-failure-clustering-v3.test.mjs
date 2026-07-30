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

const {
  clusterFailureFeatures,
  createAgentCandidate,
  criticalRegressionAutoPause,
  evaluateAgentCandidate,
  evaluateAgentDataGate,
  stableCanaryAssignment,
} = await import("../lib/agent/evals/index.ts");

const tenant = "a".repeat(64);

function feature(id, overrides = {}) {
  return {
    traceId: id,
    tenantScopeHash: tenant,
    occurredAt: "2026-07-30T18:00:00.000Z",
    failureClasses: ["typescript"],
    sanitizedErrorText: "WalletEventCard property marketCap is missing from WalletEvent",
    stackSymbols: ["WalletEventCard", "normalizeWalletEvent"],
    affectedPathCategories: ["components-tsx", "lib-ts"],
    roles: ["autofix"],
    models: ["gateway/model-a"],
    toolSequence: ["read-file", "apply-patch", "run-typecheck"],
    contextMissTypes: [],
    projectCategory: "whale-intelligence",
    integrationCategories: ["dropstab"],
    repairOutcome: "verified",
    buildStage: "typecheck",
    deterministicFixerIds: ["fix-import-wallet-event"],
    criticalSecurity: false,
    ...overrides,
  };
}

test("failure clustering is deterministic and promotes evidence by thresholds", () => {
  const input = [
    feature("trace-a"), feature("trace-b"), feature("trace-c"),
    feature("trace-d"), feature("trace-e"),
    feature("trace-security", {
      failureClasses: ["security"],
      sanitizedErrorText: "SSRF destination rejected by network policy",
      stackSymbols: ["assertPublicHttpsUrl"],
      affectedPathCategories: ["lib-ts"],
      roles: ["security"],
      repairOutcome: "not-attempted",
      buildStage: "security",
      deterministicFixerIds: [],
      criticalSecurity: true,
    }),
  ];
  const first = clusterFailureFeatures(input);
  const second = clusterFailureFeatures([...input].reverse());
  assert.deepEqual(first, second);
  const repairCluster = first.clusters.find((cluster) => cluster.verifiedRepairCount === 5);
  assert.ok(repairCluster?.candidateActions.includes("benchmark"));
  assert.ok(repairCluster?.candidateActions.includes("deterministic-fixer"));
  const security = first.clusters.find((cluster) => cluster.memberTraceIds.includes("trace-security"));
  assert.equal(security?.outlier, true, "a single critical trace remains visibly outlier data");
});

test("clustering rejects cross-tenant and credential-bearing inputs", () => {
  assert.throws(() => clusterFailureFeatures([
    feature("trace-a"),
    feature("trace-b", { tenantScopeHash: "b".repeat(64) }),
  ]), /cannot mix tenant scopes/);
  assert.throws(() => clusterFailureFeatures([
    feature("trace-secret", { sanitizedErrorText: `token ghp_${"a".repeat(40)}` }),
  ]), /credential-like/);
});

test("data gate blocks rewrites until every required artifact exists", () => {
  const blocked = evaluateAgentDataGate({
    baselineId: "v2",
    benchmarkCases: 119,
    baselineResultsRecorded: true,
    authorizedModelCount: 2,
    measuredModelCount: 1,
    verifiedRepairCount: 29,
    failureClusterCount: 0,
    designBenchmarkCount: 9,
    designReportRecorded: false,
    promptTokenReportRecorded: false,
  });
  assert.equal(blocked.passed, false);
  assert.ok(blocked.blockers.length >= 6);
  assert.throws(() => createAgentCandidate({
    gate: { baselineId: "v2", benchmarkCases: 119, baselineResultsRecorded: true, authorizedModelCount: 2, measuredModelCount: 1, verifiedRepairCount: 29, failureClusterCount: 0, designBenchmarkCount: 9, designReportRecorded: false, promptTokenReportRecorded: false },
    kind: "router", version: "3.1.0", hypothesis: "measured", linkedFailureClusterIds: ["c1"], expectedMetric: "preview", affectedBenchmarkSlices: ["repair"], safetyGuardrails: ["no security regression"], defaultVersion: "2.0.0", featureFlag: "DROPS_AGENT_ROUTER_VNEXT", experimentId: "router-vnext",
  }), /data-gated/);
});

test("candidate thresholds keep production unchanged and configure only a 5 percent canary", () => {
  const baseline = { workingPreviewRate: 0.7, estimatedCostUsd: 10, p95LatencyMs: 10_000, criticalSecurityRegressions: 0, hardBlockerRegressions: 0, cryptoSliceRegression: 0, integrationTruthRegression: 0, designSliceRegression: 0, samples: 100 };
  const candidate = { ...baseline, workingPreviewRate: 0.74, estimatedCostUsd: 9, p95LatencyMs: 9_000 };
  const result = evaluateAgentCandidate(baseline, candidate);
  assert.equal(result.verdict, "promote-to-canary");
  assert.equal(result.canaryPercent, 5);
  assert.equal(result.productionDefaultChanged, false);
  assert.equal(
    stableCanaryAssignment({ experimentId: "e1", version: "1", actorHash: tenant, projectId: "p1" }),
    stableCanaryAssignment({ experimentId: "e1", version: "1", actorHash: tenant, projectId: "p1" }),
  );
  assert.equal(criticalRegressionAutoPause({ criticalSecurityRegressions: 1, hardBlockerRegressions: 0, failureRateDelta: 0, costDelta: 0 }).paused, true);
});

test("canary assignment honors exact zero and one hundred percent boundaries", () => {
  const input = {
    experimentId: "experiment-v3",
    version: "candidate-1",
    actorHash: "a".repeat(64),
    projectId: "project-v3",
  };
  assert.equal(stableCanaryAssignment({ ...input, percent: 0 }), "control");
  assert.equal(stableCanaryAssignment({ ...input, percent: 100 }), "candidate");
});
