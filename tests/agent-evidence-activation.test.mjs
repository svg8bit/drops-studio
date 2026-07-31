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
const { createAgentV3PlatformEvidence } = await import("../lib/agent/evals/dashboard-evidence.ts");

async function fullReport() {
  return evals.runAgentBenchmark({
    suite: "release",
    cases: evals.benchmarkCasesForSuite("release"),
    configurations: evals.DEFAULT_BENCHMARK_CONFIGURATIONS,
    execute: evals.executeOfflineContractBenchmark,
    concurrency: 8,
  });
}

function probePayload() {
  return JSON.stringify({
    route: "planner",
    capabilities: ["dropstab", "dropsbot", "telegram"],
    externalActionApprovalRequired: true,
    privateKeyCustody: false,
  });
}

test("full evidence activation records a real bounded model matrix and clears the V3 data gate", async () => {
  const report = await fullReport();
  let tick = 0;
  const snapshot = await evals.activateAgentV3Evidence(report, {
    now: () => new Date(Date.UTC(2026, 6, 31, 15, 0, tick++)),
    discoverModels: async () => [
      { id: "inclusionai/ling-3.0-flash-free", type: "language", pricing: { input: "0", output: "0" } },
      { id: "poolside/laguna-s-2.1-free", type: "language", pricing: { input: "0", output: "0" } },
    ],
    probeModel: async (modelId) => ({
      text: probePayload(),
      inputTokens: 42,
      outputTokens: 24,
      providerRequestId: `request-${modelId}`,
    }),
  });

  assert.equal(snapshot.baseline.registeredCaseCount, 120);
  assert.equal(snapshot.baseline.releaseGatePassed, true);
  assert.equal(snapshot.failureClustering.clusterCount, 8);
  assert.equal(snapshot.designAgent.caseCount, 10);
  assert.equal(snapshot.designAgent.passedResultCount, 20);
  assert.equal(snapshot.modelMatrix.passedModelCount, 2);
  assert.equal(snapshot.privacy.promptsStored, false);
  assert.equal(JSON.stringify(snapshot).includes(probePayload()), false);

  const platform = await createAgentV3PlatformEvidence({ snapshot });
  assert.equal(platform.dataGate.passed, true, platform.dataGate.blockers.join("\n"));
  assert.deepEqual(platform.dataGate.blockers, []);
  assert.equal(platform.receipts.modelMatrix.measuredModels, 2);
});

test("activation remains blocked unless two live model probes pass", async () => {
  const report = await fullReport();
  await assert.rejects(() => evals.activateAgentV3Evidence(report, {
    discoverModels: async () => [
      { id: "inclusionai/ling-3.0-flash-free", type: "language" },
      { id: "poolside/laguna-s-2.1-free", type: "language" },
    ],
    probeModel: async (modelId) => ({
      text: modelId.startsWith("inclusionai/") ? probePayload() : "not-json",
      inputTokens: 1,
      outputTokens: 1,
    }),
  }), /two verified measurements/i);
});

test("evidence snapshots are private, immutable and readable from the local eval store", async () => {
  const previousLocal = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_AGENT_EVIDENCE_SNAPSHOTS__ = new Map();
  try {
    const report = await fullReport();
    const snapshot = await evals.activateAgentV3Evidence(report, {
      discoverModels: async () => [
        { id: "inclusionai/ling-3.0-flash-free", type: "language" },
        { id: "poolside/laguna-s-2.1-free", type: "language" },
      ],
      probeModel: async () => ({ text: probePayload(), inputTokens: 1, outputTokens: 1 }),
    });
    const store = new evals.DefaultAgentEvalStore();
    await store.writeEvidenceSnapshot(snapshot);
    assert.deepEqual((await store.listEvidenceSnapshots(1))[0], snapshot);
    await assert.rejects(() => store.writeEvidenceSnapshot(snapshot), /already exists/i);
    await assert.rejects(
      () => store.writeEvidenceSnapshot({ ...snapshot, snapshotId: "invalid" }),
      /64-character lowercase hexadecimal digest/i,
    );
  } finally {
    globalThis.__DROPS_AGENT_EVIDENCE_SNAPSHOTS__ = undefined;
    if (previousLocal === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocal;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});
