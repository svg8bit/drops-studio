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

test("registered validators require concrete artifacts and independent evidence", async () => {
  const fixture = registry.AGENT_BENCHMARK_CASES.find((entry) => entry.id === "build-whale-intelligence");
  assert.ok(fixture);
  const envelope = await registry.materializeBenchmarkFixture(fixture.fixtureProject, fixture.seededFailures);
  const evidence = Object.fromEntries(fixture.deterministicChecks.map((checkId) => [
    checkId,
    { passed: true, evidenceIds: [`evidence:${checkId}`] },
  ]));
  const passing = await registry.runBenchmarkValidators(fixture, {
    project: envelope.canonicalProject,
    expectedArtifacts: fixture.expectedArtifacts,
    observedArtifacts: fixture.expectedArtifacts,
    evidence,
  });
  assert.ok(passing.every((entry) => entry.passed));
  assert.ok(passing.every((entry) => entry.evidenceIds.length > 0));

  const missing = await registry.runBenchmarkValidators(fixture, {
    project: envelope.canonicalProject,
    expectedArtifacts: fixture.expectedArtifacts,
    observedArtifacts: [],
    evidence: {},
  });
  assert.ok(missing.some((entry) => entry.checkId === "expected-artifacts" && !entry.passed));
  assert.ok(missing.some((entry) => entry.hardBlocker));
});

test("browser flow schema is strict, relative-only, and contains no arbitrary evaluation action", () => {
  const valid = registry.AGENT_BENCHMARK_CASES.find((entry) => entry.browserFlow)?.browserFlow;
  assert.ok(valid);
  assert.deepEqual(registry.parseBrowserFlowSpec(valid), valid);
  assert.throws(() => registry.parseBrowserFlowSpec({
    ...valid,
    startPath: "https://attacker.example",
  }));
  assert.throws(() => registry.parseBrowserFlowSpec({
    ...valid,
    steps: [{ action: "evaluate", source: "globalThis.process" }, { action: "expect-no-console-errors" }],
  }));
});

test("bounded browser flow DSL executes only declared driver operations and returns step evidence", async () => {
  const calls = [];
  const driver = {
    navigate: async (path) => calls.push(["navigate", path]),
    click: async (selector) => calls.push(["click", selector]),
    fill: async (selector, value) => calls.push(["fill", selector, value]),
    press: async (selector, key) => calls.push(["press", selector, key]),
    expectVisible: async (selector) => calls.push(["visible", selector]),
    expectText: async (selector, text) => calls.push(["text", selector, text]),
    expectUrl: async (path) => calls.push(["url", path]),
    expectNoConsoleErrors: async () => calls.push(["console"]),
    expectNoFailedRequests: async () => calls.push(["network"]),
    expectNoHorizontalOverflow: async () => calls.push(["overflow"]),
    runAxe: async () => calls.push(["axe"]),
  };
  const spec = {
    id: "typed-browser-flow",
    version: "1.0.0",
    startPath: "/",
    timeoutMs: 2_000,
    steps: [
      { action: "fill", selector: "input", value: "BTC" },
      { action: "press", selector: "input", key: "Enter" },
      { action: "expect-text", selector: "main", text: "BTC" },
      { action: "expect-no-console-errors" },
      { action: "expect-no-failed-requests" },
      { action: "expect-no-horizontal-overflow" },
      { action: "axe-scan" },
    ],
  };
  const result = await registry.runBenchmarkBrowserFlow({ spec, driver });
  assert.equal(result.flowId, spec.id);
  assert.equal(result.evidenceIds.length, spec.steps.length + 1);
  assert.deepEqual(calls.map((entry) => entry[0]), ["navigate", "fill", "press", "text", "console", "network", "overflow", "axe"]);
});

test("every design fixture carries desktop, tablet, and mobile evidence contracts", () => {
  const designs = registry.AGENT_BENCHMARK_CASES.filter((entry) => entry.suite === "design-responsive");
  assert.equal(designs.length, 10);
  for (const fixture of designs) {
    assert.deepEqual(fixture.visualViewports.map((viewport) => viewport.width), [1440, 1024, 390]);
    assert.ok(fixture.browserFlow);
    assert.ok(fixture.deterministicChecks.includes("design-rubric"));
    assert.ok(fixture.deterministicChecks.includes("no-horizontal-overflow"));
  }
});
