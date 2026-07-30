import assert from "node:assert/strict";
import test from "node:test";

const {
  AuthorizedModelRegistry,
  ModelRoleCircuitBreaker,
  ModelRoutingError,
  RoleInvocationError,
  executeRoutedRole,
  routeModel,
} = await import("../lib/agent/models/index.ts");

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
    allowedRoles: [
      "router",
      "planner",
      "coder",
      "quick-edit",
      "autofix",
      "verifier",
    ],
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

test("selected-only uses the exact authorized model and never creates a fallback chain", () => {
  const registry = new AuthorizedModelRegistry("2.0.0", [
    profile("selected", { cost: { inputPerMillion: 20, cachedInputPerMillion: 10, outputPerMillion: 60, currency: "USD" } }),
    profile("cheaper", { cost: { inputPerMillion: 0.1, cachedInputPerMillion: 0.05, outputPerMillion: 0.5, currency: "USD" } }),
  ]);
  const route = routeModel(registry, localEditRequest({
    mode: "selected-only",
    selected: { provider: "openai", model: "selected" },
  }));
  assert.equal(route.primaryRole, "quick-edit");
  assert.equal(route.model, "selected");
  assert.deepEqual(route.fallbackChain, []);
  assert.ok(route.reasonCodes.includes("SELECTED_MODEL_ONLY"));
});

test("unauthorized and unknown-capability profiles cannot satisfy a route", () => {
  const unauthorized = new AuthorizedModelRegistry("2.0.0", [
    profile("private", { authorized: false }),
  ]);
  assert.throws(
    () => routeModel(unauthorized, localEditRequest()),
    (error) => error instanceof ModelRoutingError && error.code === "NO_AUTHORIZED_MODEL",
  );

  const unknownTools = new AuthorizedModelRegistry("2.0.0", [
    profile("unknown-tools", { supportsTools: "unknown" }),
  ]);
  assert.throws(
    () => routeModel(unknownTools, localEditRequest()),
    (error) => error instanceof ModelRoutingError && error.code === "NO_AUTHORIZED_MODEL",
  );
});

test("live registry snapshots strip undeclared credential material", () => {
  const candidate = {
    ...profile("sanitized"),
    apiKey: "must-not-survive",
    credential: "must-not-survive",
  };
  const registry = new AuthorizedModelRegistry("2.0.0", [candidate]);
  const serialized = JSON.stringify(registry.publicSnapshot());
  assert.equal(serialized.includes("must-not-survive"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("credential"), false);
});

test("auto-economy chooses the least-cost capable authorized model", () => {
  const registry = new AuthorizedModelRegistry("2.0.0", [
    profile("frontier", { qualityClass: "frontier", cost: { inputPerMillion: 15, cachedInputPerMillion: 5, outputPerMillion: 60, currency: "USD" } }),
    profile("economy", { qualityClass: "utility", latencyClass: "fast", cost: { inputPerMillion: 0.2, cachedInputPerMillion: 0.1, outputPerMillion: 0.8, currency: "USD" } }),
  ]);
  const route = routeModel(registry, localEditRequest({ mode: "auto-economy" }));
  assert.equal(route.model, "economy");
  assert.equal(route.estimatedCostBand, "low");
  assert.ok(route.reasonCodes.includes("LOW_COST_REQUESTED"));
});

test("circuit breaker is scoped to one role/model pair and expires", () => {
  let time = 1000;
  const breaker = new ModelRoleCircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 5_000,
    now: () => time,
  });
  const ref = { provider: "openai", model: "fragile" };
  breaker.recordFailure("coder", ref, "timeout");
  assert.equal(breaker.isOpen("coder", ref), false);
  breaker.recordFailure("coder", ref, "rate-limit");
  assert.equal(breaker.isOpen("coder", ref), true);
  assert.equal(breaker.isOpen("planner", ref), false);
  time += 5_001;
  assert.equal(breaker.isOpen("coder", ref), false);
});

test("role runner retries one transient failure then records disclosed authorized fallback", async () => {
  const registry = new AuthorizedModelRegistry("2.0.0", [
    profile("primary"),
    profile("fallback", { provider: "anthropic" }),
  ]);
  const route = routeModel(registry, localEditRequest());
  assert.equal(route.model, "fallback", "balanced deterministic ordering may select provider/model key first");
  // Force a stable primary/fallback pair to exercise the execution policy.
  route.provider = "openai";
  route.model = "primary";
  route.fallbackChain = [{ provider: "anthropic", model: "fallback" }];
  const calls = [];
  const result = await executeRoutedRole({
    route,
    registry,
    invoke: async (input) => {
      calls.push(input);
      if (!input.fallback) throw new RoleInvocationError("timeout", "transient");
      return {
        output: "recovered",
        usage: { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100 },
      };
    },
  });
  assert.equal(result.output, "recovered");
  assert.equal(calls.length, 3);
  assert.equal(result.trace[0].errorClass, "transient");
  assert.equal(result.trace[1].errorClass, "transient");
  assert.equal(result.trace[2].fallback, true);
  assert.equal(result.trace[2].status, "succeeded");
  assert.equal(typeof result.trace[2].estimatedCostUsd, "number");
});
