import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const output = new URL("../outputs/agent-evals/v3/", import.meta.url);

test("V3 evidence artifacts are reproducible and current", () => {
  const result = execFileSync(
    process.execPath,
    ["scripts/generate-agent-v3-evidence.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(result, /Verified 9 current Drops Agent V3 evidence artifacts/);
});

test("V3 evidence manifests preserve honest applicability and provider boundaries", async () => {
  const [manifest, benchmarks, repairs, clustering] = await Promise.all([
    readFile(new URL("manifest.json", output), "utf8").then(JSON.parse),
    readFile(new URL("benchmark-manifest.json", output), "utf8").then(JSON.parse),
    readFile(new URL("repair-manifest.json", output), "utf8").then(JSON.parse),
    readFile(new URL("failure-clustering-report.json", output), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.productionImpact.productionDefaultsChanged, false);
  assert.equal(benchmarks.caseCount, 120);
  assert.equal(benchmarks.executionEvidence.modelRunsCollected, false);
  assert.equal(benchmarks.executionEvidence.browserFlowsExecuted, false);
  assert.equal(repairs.acceptedCount, 36);
  assert.equal(repairs.rejectedCount, 0);
  assert.equal(repairs.applicability.buildEvidenceIds, 0);
  assert.equal(repairs.applicability.browserEvidenceIds, 0);
  assert.equal(repairs.providerEvidence.collected, false);
  assert.ok(clustering.report.quality.clusterCount > 1);
  assert.ok(clustering.regressionBenchmarkCandidates.length > 1);
  assert.ok(clustering.regressionBenchmarkCandidates.every((entry) =>
    entry.status === "candidate-only" && entry.registryMutationApplied === false));
  assert.match(clustering.limitations.join(" "), /No model or provider was invoked/);
  assert.match(clustering.limitations.join(" "), /No dependency installation/);
});
