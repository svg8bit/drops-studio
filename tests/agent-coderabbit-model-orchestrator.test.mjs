import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href,
    };
  },
});

const models = await import("../lib/agent/models/index.ts");
const orchestrator = await import("../lib/agent/orchestrator/index.ts");
const subagents = await import("../lib/agent/subagents/index.ts");

const HASH = "a".repeat(64);

function profile(model, overrides = {}) {
  return {
    provider: "openai",
    model,
    displayName: model,
    authorized: true,
    source: "user-byok",
    supportsTools: true,
    supportsParallelTools: false,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsEmbeddings: false,
    maxContextTokens: 128_000,
    maxOutputTokens: 16_000,
    latencyClass: "balanced",
    qualityClass: "standard",
    cost: {
      inputPerMillion: 2,
      cachedInputPerMillion: 1,
      outputPerMillion: 8,
      currency: "USD",
    },
    allowedRoles: ["router", "planner", "coder", "quick-edit", "autofix", "verifier"],
    verifiedAt: "2026-07-30T12:00:00.000Z",
    ...overrides,
  };
}

function localEditRequest(overrides = {}) {
  return {
    task: {
      goal: "Change the alert title",
      mutation: true,
      expectedFiles: 1,
      expectedChangedLines: 4,
    },
    mode: "auto-balanced",
    policyVersion: "2.0.0",
    ...overrides,
  };
}

function agentTask(taskId, overrides = {}) {
  const role = overrides.role ?? "frontend";
  const readOnly = role === "planner" || role === "qa" || role === "security";
  return {
    taskId,
    runId: "coderabbit-run",
    role,
    title: `${taskId} task`,
    objective: `Execute ${taskId}`,
    dependencies: [],
    priority: 10,
    baseRevision: 1,
    baseContentHash: HASH,
    readScopes: ["**"],
    writeScopes: readOnly ? [] : ["components/**"],
    protectedScopes: ["package.json"],
    integrationScopes: [],
    contextQueryIds: [],
    selectedSkills: [],
    modelRouteId: `route:${taskId}`,
    executionMode: readOnly ? "read-only" : "patch-only",
    acceptanceChecks: ["complete"],
    expectedArtifacts: [],
    risk: "low",
    estimatedCostUsd: 0,
    limits: {
      maxModelCalls: 1,
      maxToolCalls: 2,
      timeoutMs: 2_000,
      maxChangedFiles: readOnly ? 0 : 2,
      maxChangedLines: readOnly ? 0 : 100,
    },
    status: "queued",
    ...overrides,
  };
}

test("router reports missing authorization before applying a configured budget", () => {
  const registry = new models.AuthorizedModelRegistry("2.0.0", [
    profile("unauthorized", { authorized: false }),
  ]);
  assert.throws(
    () => models.routeModel(registry, localEditRequest({ maxInputCostPerMillion: 1 })),
    (error) => error instanceof models.ModelRoutingError && error.code === "NO_AUTHORIZED_MODEL",
  );

  const expensive = new models.AuthorizedModelRegistry("2.0.0", [profile("expensive")]);
  assert.throws(
    () => models.routeModel(expensive, localEditRequest({ maxInputCostPerMillion: 1 })),
    (error) => error instanceof models.ModelRoutingError && error.code === "BUDGET_EXCEEDED",
  );
});

test("high-cost routes cannot execute before explicit confirmation", async () => {
  const registry = new models.AuthorizedModelRegistry("2.0.0", [
    profile("frontier", {
      qualityClass: "frontier",
      cost: { inputPerMillion: 30, cachedInputPerMillion: 15, outputPerMillion: 90, currency: "USD" },
    }),
  ]);
  const route = models.routeModel(registry, localEditRequest({ mode: "auto-quality" }));
  assert.equal(route.requiresUserConfirmation, true);
  let calls = 0;
  await assert.rejects(
    () => models.executeRoutedRole({
      route,
      registry,
      invoke: async () => {
        calls += 1;
        return { output: "unexpected", usage: null };
      },
    }),
    (error) => error instanceof models.RoutedRoleExecutionError && error.code === "HIGH_COST_CONFIRMATION_REQUIRED",
  );
  assert.equal(calls, 0);

  const confirmed = await models.executeRoutedRole({
    route,
    registry,
    userConfirmedHighCost: true,
    invoke: async () => {
      calls += 1;
      return { output: "confirmed", usage: null };
    },
  });
  assert.equal(confirmed.output, "confirmed");
  assert.equal(calls, 1);
});

test("role runner records skipped candidates and returns a typed all-skipped outcome", async () => {
  const registry = new models.AuthorizedModelRegistry("2.0.0", [
    profile("primary"),
    profile("fallback", { provider: "anthropic", authorized: false }),
  ]);
  const route = models.routeModel(registry, localEditRequest());
  route.provider = "openai";
  route.model = "primary";
  route.fallbackChain = [{ provider: "anthropic", model: "fallback" }];
  const breaker = new models.ModelRoleCircuitBreaker({ failureThreshold: 1 });
  breaker.recordFailure(route.primaryRole, { provider: "openai", model: "primary" }, "timeout");
  breaker.recordFailure(route.primaryRole, { provider: "openai", model: "primary" }, "timeout");
  let calls = 0;
  await assert.rejects(
    () => models.executeRoutedRole({
      route,
      registry,
      circuitBreaker: breaker,
      invoke: async () => {
        calls += 1;
        return { output: "unexpected", usage: null };
      },
    }),
    (error) => {
      assert.ok(error instanceof models.RoutedRoleExecutionError);
      assert.equal(error.code, "ALL_CANDIDATES_SKIPPED");
      assert.deepEqual(error.trace.map((entry) => entry.status), ["skipped", "skipped"]);
      assert.deepEqual(error.trace.map((entry) => entry.skipReason), ["circuit-open", "unauthorized"]);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("selected-only execution ignores an injected fallback chain", async () => {
  const registry = new models.AuthorizedModelRegistry("2.0.0", [
    profile("selected"),
    profile("fallback", { provider: "anthropic" }),
  ]);
  const route = models.routeModel(registry, localEditRequest({
    mode: "selected-only",
    selected: { provider: "openai", model: "selected" },
  }));
  route.fallbackChain = [{ provider: "anthropic", model: "fallback" }];
  const calls = [];
  await assert.rejects(
    () => models.executeRoutedRole({
      route,
      registry,
      invoke: async (candidate) => {
        calls.push(candidate.model);
        throw new models.RoleInvocationError("permanent failure", "permanent");
      },
    }),
    (error) => error instanceof models.RoutedRoleExecutionError && error.code === "ALL_CANDIDATES_FAILED",
  );
  assert.deepEqual(calls, ["selected"]);
});

test("router budgets input context after reserving model output tokens", () => {
  const registry = new models.AuthorizedModelRegistry("2.0.0", [
    profile("bounded", { maxContextTokens: 18_000, maxOutputTokens: 16_000 }),
  ]);
  const route = models.routeModel(registry, localEditRequest({
    task: {
      goal: "Make a bounded edit",
      mutation: true,
      expectedFiles: 1,
      expectedChangedLines: 4,
      requiredContextTokens: 12_000,
    },
  }));
  assert.ok(route.contextBudgetTokens >= 12_000);
  assert.ok(route.outputBudgetTokens >= 1_024);
  assert.ok(route.contextBudgetTokens + route.outputBudgetTokens <= 18_000);
});

test("Verifier advisory escalation requires and preserves a concrete rationale", () => {
  const gates = [
    "project-schema",
    "typecheck",
    "lint",
    "tests",
    "build",
    "preview",
    "browser",
    "secret-scan",
    "permissions",
  ].map((name, index) => ({
    id: `gate-${index}`,
    name,
    passed: true,
    required: true,
    summary: "passed",
  }));
  const evidence = {
    projectRevision: "revision-1",
    evidenceHash: HASH,
    gates,
    setupRequired: [],
    unresolvedWarnings: [],
  };
  const ignored = models.verifyReleaseEvidence(evidence, {
    verifierModel: "verifier",
    verifierPromptVersion: "2.0.0",
    advisoryVerdict: "BLOCKED",
  });
  assert.equal(ignored.verdict, "PASS");
  assert.equal(ignored.advisoryEscalation, null);

  const escalated = models.verifyReleaseEvidence(evidence, {
    verifierModel: "verifier",
    verifierPromptVersion: "2.0.0",
    advisoryVerdict: "BLOCKED",
    advisoryRationale: "The verified primary interaction is unavailable in the supplied evidence.",
  });
  assert.equal(escalated.verdict, "BLOCKED");
  assert.deepEqual(escalated.advisoryEscalation, {
    verdict: "BLOCKED",
    rationale: "The verified primary interaction is unavailable in the supplied evidence.",
  });
});

test("Quick Edit rejects rename operations without a bounded new path", () => {
  const result = models.evaluateQuickEditPatch({
    baseRevision: "revision-1",
    taskId: "rename",
    files: [{
      path: "components/Old.tsx",
      expectedHash: HASH,
      operation: "rename",
    }],
    testsToRun: ["typecheck"],
    summary: ["Rename component"],
  }, {
    expectedRevision: "revision-1",
    allowedPaths: ["components/Old.tsx", "components/New.tsx"],
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("RENAME_TARGET_REQUIRED"));
});

test("task graph validates integration scopes and honors embedded dependency status", () => {
  assert.throws(
    () => orchestrator.validateTaskGraph([
      agentTask("invalid", { integrationScopes: ["dropstab:coins\0secret"] }),
    ]),
    /integration|scope|invalid/i,
  );

  const dependency = agentTask("dependency", { status: "merged" });
  const dependent = agentTask("dependent", { dependencies: ["dependency"] });
  const ready = orchestrator.readyTasks([dependency, dependent], new Map([["dependent", "queued"]]));
  assert.deepEqual(ready.map((entry) => entry.taskId), ["dependent"]);
});

test("role context deeply freezes the cloned task snapshot", () => {
  const task = agentTask("qa", {
    role: "qa",
    readScopes: ["components/**"],
    writeScopes: [],
    executionMode: "read-only",
    limits: {
      maxModelCalls: 1,
      maxToolCalls: 2,
      timeoutMs: 2_000,
      maxChangedFiles: 0,
      maxChangedLines: 0,
    },
  });
  const context = orchestrator.createRoleContext({
    project: {
      id: "project",
      revision: 1,
      contentHash: HASH,
      files: {
        "components/Card.tsx": { path: "components/Card.tsx", content: "export {};", hash: HASH },
      },
    },
    task,
    signal: new AbortController().signal,
  });
  assert.notEqual(context.task, task);
  assert.equal(Object.isFrozen(context.task), true);
  assert.equal(Object.isFrozen(context.task.limits), true);
  assert.equal(Object.isFrozen(context.task.readScopes), true);
  assert.throws(() => {
    context.task.limits.maxToolCalls = 99;
  }, TypeError);
});

test("bounded subagent counts actual tool calls and enforces mutation policy at runtime", async () => {
  const task = agentTask("qa", {
    role: "qa",
    readScopes: ["**"],
    writeScopes: [],
    executionMode: "read-only",
    limits: {
      maxModelCalls: 1,
      maxToolCalls: 2,
      timeoutMs: 2_000,
      maxChangedFiles: 0,
      maxChangedLines: 0,
    },
  });
  const context = orchestrator.createRoleContext({
    project: { id: "project", revision: 1, contentHash: HASH, files: {} },
    task,
    signal: new AbortController().signal,
  });
  const bounded = subagents.createBoundedSubagent({
    contract: {
      role: "qa",
      mutation: "none",
      capabilities: ["list-files", "read-file", "report-findings"],
      maxTools: 2,
      externalMutation: false,
    },
    execute: async (_roleContext, tools) => {
      await tools.run("list-files", async () => []);
      await tools.run("read-file", async () => null);
      await tools.run("report-findings", async () => null);
      return { findings: [], checksRequested: [], primaryFlowStatus: "passed", repairTasks: [] };
    },
  });
  await assert.rejects(() => bounded(context), /actual tool-call budget/i);

  const invalidContract = subagents.createBoundedSubagent({
    contract: {
      role: "qa",
      mutation: "none",
      capabilities: ["list-files", "read-file", "report-findings"],
      maxTools: 2,
      externalMutation: true,
    },
    execute: async () => ({ findings: [], checksRequested: [], primaryFlowStatus: "passed", repairTasks: [] }),
  });
  await assert.rejects(() => invalidContract(context), /external mutation/i);
});

test("scope overlap computes real glob intersection under bounded complexity", () => {
  assert.equal(
    orchestrator.scopePatternsOverlap("app/*/page.tsx", "app/*/layout.tsx"),
    false,
  );
  assert.equal(
    orchestrator.scopePatternsOverlap("app/**/page.tsx", "app/admin/**"),
    true,
  );
  assert.equal(
    orchestrator.scopePatternsOverlap("components/**/Card.tsx", "components/*/*/Table.tsx"),
    false,
  );
  assert.throws(
    () => orchestrator.normalizeScopePattern(Array.from({ length: 70 }, () => "segment").join("/")),
    /too (?:long|complex)|segments/i,
  );
});

test("AutoFix does not invoke either repair strategy for non-repairable evidence", async () => {
  let deterministicCalls = 0;
  let modelCalls = 0;
  let checkCalls = 0;
  const result = await models.runAutoFixLoop({
    initialEvidence: {
      id: "policy",
      failureClass: "security-policy",
      command: "secret-scan",
      sanitizedLog: "blocked",
      affectedPaths: [],
    },
    deterministicFix: () => {
      deterministicCalls += 1;
      return { changed: true };
    },
    modelFix: async () => {
      modelCalls += 1;
      return { changed: true };
    },
    check: async () => {
      checkCalls += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual({ deterministicCalls, modelCalls, checkCalls }, {
    deterministicCalls: 0,
    modelCalls: 0,
    checkCalls: 0,
  });
});
