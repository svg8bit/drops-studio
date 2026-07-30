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
  AgentSchedulerLimitError,
  AgentTaskGraphError,
  runDeterministicScheduler,
  validateTaskGraph,
} = await import("../lib/agent/orchestrator/index.ts");

const HASH = "a".repeat(64);

function task(taskId, overrides = {}) {
  const role = overrides.role ?? "frontend";
  const readOnly = role === "planner" || role === "qa" || role === "security";
  return {
    taskId,
    runId: "scheduler-run",
    role,
    title: `${taskId} task`,
    objective: `Execute ${taskId}`,
    dependencies: [],
    priority: 10,
    baseRevision: 1,
    baseContentHash: HASH,
    readScopes: ["**"],
    writeScopes: readOnly ? [] : [`${taskId}/**`],
    protectedScopes: ["package.json"],
    integrationScopes: [],
    contextQueryIds: [`ctx:${taskId}`],
    selectedSkills: [],
    modelRouteId: `route:${taskId}`,
    executionMode: readOnly ? "read-only" : "patch-only",
    acceptanceChecks: ["complete"],
    expectedArtifacts: [],
    risk: "low",
    estimatedCostUsd: 0.01,
    limits: {
      maxModelCalls: 1,
      maxToolCalls: 4,
      timeoutMs: 2_000,
      maxChangedFiles: readOnly ? 0 : 2,
      maxChangedLines: readOnly ? 0 : 100,
    },
    status: "queued",
    ...overrides,
  };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

test("rejects a cyclic task DAG before any role executes", () => {
  assert.throws(
    () => validateTaskGraph([
      task("a", { dependencies: ["b"] }),
      task("b", { dependencies: ["a"] }),
    ]),
    AgentTaskGraphError,
  );
});

test("overlapping write scopes never run concurrently while disjoint work does", async () => {
  const tasks = [
    task("a", { writeScopes: ["app/**"], priority: 30 }),
    task("b", { writeScopes: ["app/page.tsx"], priority: 20 }),
    task("c", { writeScopes: ["lib/**"], priority: 10 }),
  ];
  const active = new Set();
  let sawDisjointOverlap = false;
  let sawForbiddenOverlap = false;
  const result = await runDeterministicScheduler(tasks, async (entry, signal) => {
    active.add(entry.taskId);
    if (active.has("a") && active.has("c")) sawDisjointOverlap = true;
    if (active.has("a") && active.has("b")) sawForbiddenOverlap = true;
    await wait(18, signal);
    active.delete(entry.taskId);
    return entry.taskId;
  });
  assert.equal(sawDisjointOverlap, true);
  assert.equal(sawForbiddenOverlap, false);
  assert.equal(result.maxObservedConcurrency, 2);
  assert.deepEqual([...result.statuses.values()], ["merged", "merged", "merged"]);
});

test("scheduler performs real Promise.all overlap and preserves deterministic launch order", async () => {
  const tasks = [task("z", { priority: 10 }), task("a", { priority: 10 }), task("m", { priority: 20 })];
  const execute = async (entry, signal) => {
    await wait(10, signal);
    return entry.taskId;
  };
  const first = await runDeterministicScheduler(tasks, execute);
  const second = await runDeterministicScheduler(tasks, execute);
  const launchOrder = (result) => [...result.timelines]
    .sort((left, right) => left.startedOrder - right.startedOrder)
    .map((entry) => entry.taskId);
  assert.equal(first.maxObservedConcurrency, 3);
  assert.deepEqual(launchOrder(first), ["m", "a", "z"]);
  assert.deepEqual(launchOrder(second), launchOrder(first));
});

test("enforces concurrency, role-call, model-call, and estimated-cost bounds", async () => {
  await assert.rejects(
    () => runDeterministicScheduler([task("a")], async () => "ok", { limits: { maxActiveSubagents: 4 } }),
    AgentSchedulerLimitError,
  );
  await assert.rejects(
    () => runDeterministicScheduler([task("a", { estimatedCostUsd: 2 })], async () => "ok", { limits: { maxEstimatedCostUsd: 1 } }),
    /cost budget/i,
  );
  await assert.rejects(
    () => runDeterministicScheduler([
      task("a", { limits: { ...task("x").limits, maxModelCalls: 8 } }),
      task("b", { limits: { ...task("x").limits, maxModelCalls: 8 } }),
    ], async () => "ok"),
    /model-call budget/i,
  );
});

test("cancellation aborts active work and blocks dependent tasks", async () => {
  const controller = new AbortController();
  const run = runDeterministicScheduler([
    task("active"),
    task("dependent", { dependencies: ["active"] }),
  ], async (_entry, signal) => wait(500, signal), { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("cancelled by test")), 15);
  const result = await run;
  assert.equal(result.statuses.get("active"), "cancelled");
  assert.equal(result.statuses.get("dependent"), "blocked");
  assert.equal(result.timelines[0].status, "cancelled");
});
