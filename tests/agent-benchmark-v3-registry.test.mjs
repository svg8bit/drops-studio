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

const registry = await import("../lib/agent/evals/benchmark-registry.ts");

const EXPECTED_DISTRIBUTION = {
  "new-product-generation": 24,
  "existing-project-editing": 18,
  "debugging-repair": 18,
  "drops-integrations": 15,
  "security-approval": 15,
  "context-retrieval": 10,
  "design-responsive": 10,
  "multi-agent-orchestration": 10,
};

test("V3 registry has exactly 120 unique non-trivial cases in the required distribution", () => {
  const cases = registry.AGENT_BENCHMARK_CASES;
  assert.equal(cases.length, 120);
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 120);
  assert.equal(new Set(cases.map((entry) => entry.intentKey)).size, 120);
  assert.deepEqual(
    Object.fromEntries(Object.keys(EXPECTED_DISTRIBUTION).map((suite) => [
      suite,
      cases.filter((entry) => entry.suite === suite).length,
    ])),
    EXPECTED_DISTRIBUTION,
  );
  assert.ok(cases.every((entry) => entry.requiredCapabilities.length >= 2));
  assert.ok(cases.every((entry) => entry.deterministicChecks.length >= 2));
  assert.ok(cases.every((entry) => entry.forbiddenClaims.length > 0 && entry.hardBlockers.length > 0));
});

test("legacy critical fixtures remain represented in the canonical V3 catalog", () => {
  const ids = new Set(registry.AGENT_BENCHMARK_CASES.map((entry) => entry.id));
  for (const id of [
    "build-whale-intelligence",
    "build-alpha-channel",
    "build-market-reactive-game",
    "edit-button-copy",
    "repair-typescript",
    "retrieve-project-symbol",
    "security-secret-source",
    "integration-dropstab-fallback",
    "release-verifier-blocks-build",
    "release-checkpoint-restore",
  ]) assert.ok(ids.has(id), `missing ${id}`);
});

test("suite selectors use the canonical catalog and CI exercises all deterministic cases", () => {
  const local = registry.benchmarkCasesForSuite("local-fast");
  const ci = registry.benchmarkCasesForSuite("ci");
  assert.equal(local.length, 16);
  assert.equal(new Set(local.map((entry) => entry.suite)).size, 8);
  assert.equal(ci.length, 120);
  assert.equal(registry.LIVE_STRATIFIED_BENCHMARK_CASE_IDS.length, 20);
  assert.equal(new Set(registry.LIVE_STRATIFIED_BENCHMARK_CASE_IDS).size, 20);
  assert.ok(registry.LIVE_STRATIFIED_BENCHMARK_CASE_IDS.every((id) => ci.some((entry) => entry.id === id)));
});

test("strict registry validation rejects unknown dependencies and duplicate semantics", () => {
  const cases = structuredClone(registry.AGENT_BENCHMARK_CASES);
  cases[0].fixtureProject = "unknown-fixture";
  assert.throws(() => registry.validateBenchmarkRegistryV3(cases), /unknown or missing fixture/i);

  const unknownSeed = structuredClone(registry.AGENT_BENCHMARK_CASES);
  unknownSeed[0].seededFailures = ["unknown-seed"];
  assert.throws(() => registry.validateBenchmarkRegistryV3(unknownSeed), /unknown failure seed/i);

  const unknownCheck = structuredClone(registry.AGENT_BENCHMARK_CASES);
  unknownCheck[0].deterministicChecks = ["project-v2-valid", "unknown-check"];
  assert.throws(() => registry.validateBenchmarkRegistryV3(unknownCheck), /unknown validator/i);

  const duplicatePrompt = structuredClone(registry.AGENT_BENCHMARK_CASES);
  duplicatePrompt[1].prompt = duplicatePrompt[0].prompt;
  assert.throws(() => registry.validateBenchmarkRegistryV3(duplicatePrompt), /duplicate benchmark prompts/i);
});

test("repository fixtures materialize deterministically and failure seeds never mutate canonical files", async () => {
  const first = await registry.materializeBenchmarkFixture("whale-intelligence", ["typescript-wallet-shape"]);
  const second = await registry.materializeBenchmarkFixture("whale-intelligence", ["typescript-wallet-shape"]);
  assert.equal(first.canonicalProject.contentHash, second.canonicalProject.contentHash);
  assert.deepEqual(first.canonicalProject.files, second.canonicalProject.files);
  assert.equal(first.failureSeeds[0].canonicalCommitAllowed, false);
  assert.equal(first.failureSeeds[0].id, "typescript-wallet-shape");
  assert.ok(!Object.keys(first.canonicalProject.files).some((path) => path.includes("typescript-wallet-shape")));
});

test("failure seed corpus is safe, deterministic, and contains no credential values", () => {
  assert.ok(registry.BENCHMARK_FAILURE_SEEDS.length >= 30);
  assert.ok(registry.BENCHMARK_FAILURE_SEEDS.every((entry) => entry.canonicalCommitAllowed === false));
  const serialized = JSON.stringify(registry.BENCHMARK_FAILURE_SEEDS);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(serialized, /gh[pousr]_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(serialized, /\d{6,12}:[A-Za-z0-9_-]{30,}/);
});
