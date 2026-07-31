import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        path.endsWith(".ts") ? path : `${path}.ts`,
        new URL("../", import.meta.url),
      ).href,
    };
  },
});

const { MemoryBuilderAgentAuditSink } = await import(
  "../lib/builder-agent/index.ts"
);
const { runIntelligentBuilderAgent } = await import(
  "../lib/agent/runtime/index.ts"
);
const { materializeProjectV2Template } = await import(
  "../lib/project-template-materializer.ts"
);
const { createProjectSpec } = await import("../lib/project-factory.ts");

const ALL_PERMISSIONS = new Set([
  "files:read",
  "files:write",
  "runtime:execute",
  "runtime:network",
  "preview:start",
  "browser:check",
  "checkpoint:write",
]);

function productSpec() {
  return createProjectSpec({
    presetId: "smart-money-copy",
    values: {},
    prompt: "Build a whale intelligence workspace with sourced market context.",
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "No prediction",
      probability: null,
      change: null,
    },
    origin: "https://drops-studio.example",
  });
}

async function project(id = "agent-runtime-project") {
  return materializeProjectV2Template({
    id,
    spec: productSpec(),
    now: "2026-07-30T12:00:00.000Z",
  });
}

function browserEvidence() {
  return {
    ok: true,
    rendered: true,
    primaryInteractionChecked: true,
    statusCode: 200,
    pageErrors: [],
    consoleErrors: [],
    networkErrors: [],
    summary: "Rendered route and primary filter interaction passed.",
  };
}

function releaseGate({ build = true } = {}) {
  const passed = (name, extras = {}) => ({
    name,
    status: "passed",
    summary: `${name} passed with real evidence.`,
    ...extras,
  });
  return {
    ok: build,
    checks: [
      passed("install"),
      passed("typecheck"),
      passed("lint"),
      passed("tests"),
      build
        ? passed("build")
        : { name: "build", status: "failed", summary: "Seeded production build failure." },
      passed("preview"),
      passed("browser", { browser: browserEvidence() }),
    ],
    blockingErrors: build ? [] : ["Seeded production build failure."],
    previewUrl: "https://preview.example.test/",
  };
}

function services(value, gate = releaseGate()) {
  const state = { checkpoints: 0, gates: 0 };
  return {
    state,
    value: {
      actorId: "actor-runtime-1",
      requestId: `request-${value.id}`,
      permissions: ALL_PERMISSIONS,
      get project() {
        return structuredClone(value);
      },
      get runtimeContext() {
        return {
          actorId: this.actorId,
          requestId: this.requestId,
          project: this.project,
        };
      },
      listFiles: () => Object.keys(value.files).sort(),
      readFile: (path) => value.files[path]?.content ?? "",
      readFiles: (paths) => paths.map((path) => ({ path, content: value.files[path]?.content ?? "" })),
      searchFiles: () => [],
      async writeFile() { return value; },
      async applyPatch() { return value; },
      async deleteFile() { return value; },
      async renameFile() { return value; },
      async installPackage() { throw new Error("unused"); },
      async runTask() { throw new Error("unused"); },
      async startPreview() { throw new Error("unused"); },
      async readLogs() { return []; },
      async runTypecheck() { return null; },
      async runLint() { return null; },
      async runTests() { return null; },
      async runBuild() { throw new Error("unused"); },
      async browserCheck() { return browserEvidence(); },
      async createCheckpoint() {
        state.checkpoints += 1;
        return {
          project: value,
          checkpoint: { checkpointId: "runtime-verified", revision: value.revision, files: [] },
        };
      },
      async restoreCheckpoint() { return value; },
      async requestConnection() {
        return { status: "setup-required", message: "Setup required" };
      },
      async publishProject() { throw new Error("unused"); },
      async ensureRuntime() { return {}; },
      async runReleaseGate() {
        state.gates += 1;
        return structuredClone(gate);
      },
    },
  };
}

function actor() {
  return {
    actorId: "actor-runtime-1",
    tenantId: "tenant-runtime-1",
    workspaceId: "workspace-runtime-1",
    branch: "conversation-runtime-1",
  };
}

function request(projectId, provider = "openai", prompt) {
  return {
    projectId,
    prompt: prompt ??
      "Edit app/page.tsx to enrich wallet swaps through documented DropsTab GET /coins market cap and FDV context.",
    mode: "build",
    provider: {
      provider,
      ...(provider === "free" ? {} : { model: "test-model" }),
    },
  };
}

test("composite runtime resolves once, compiles redacted provenance, delegates, verifies, and persists", async () => {
  const value = await project();
  const session = services(value);
  const secret = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  const prompts = [];
  const traces = [];
  let resolutions = 0;
  const output = await runIntelligentBuilderAgent({
    request: request(
      value.id,
      "openai",
      `Edit app/page.tsx for DropsTab GET /coins FDV. Never expose ${secret}.`,
    ),
    dependencies: {
      services: session.value,
      audit: new MemoryBuilderAgentAuditSink(),
      credentials: { apiKey: "request-only-key-value" },
      modelResolver: async () => {
        resolutions += 1;
        return {
          model: {},
          evidence: {
            provider: "openai",
            model: "test-model",
            credentialOwner: "visitor",
            keyPersisted: false,
          },
        };
      },
      runnerFactory: () => ({
        async generate(input) {
          prompts.push(input.prompt);
          return { text: "Verified source-aware edit completed.", content: [] };
        },
      }),
    },
    actor: actor(),
    project: value,
    evalStore: {
      async writeTrace(trace) {
        traces.push(structuredClone(trace));
      },
    },
    now: () => new Date("2026-07-30T12:30:00.000Z"),
  });

  assert.equal(resolutions, 1, "the cached resolution must prevent a second provider lookup");
  assert.equal(output.route.primaryRole, "coder");
  assert.ok(output.trace.routes[0]);
  assert.equal(output.trace.routes[0].policy, "selected-only");
  assert.equal(output.trace.routes[0].provider, "openai");
  assert.equal(output.result.status, "completed");
  assert.equal(output.contextPackage.retrievalMode, "lexical-only");
  assert.ok(
    output.contextPackage.integrationEvidence.some(
      (item) => item.endpoint?.path === "/coins",
    ),
    "the documented endpoint registry must appear with endpoint provenance",
  );
  assert.ok(
    output.contextPackage.exactProjectFiles.some(
      (item) => item.path === "app/page.tsx",
    ),
    "an explicitly named small project file must be exact context",
  );
  assert.match(prompts[0], /# Drops Studio Agent/);
  assert.match(prompts[0], /<RUNTIME_MODULES>/);
  assert.match(prompts[0], /GET \/coins/);
  assert.match(prompts[0], /dropstab-integration/);
  assert.doesNotMatch(prompts[0], new RegExp(secret));
  assert.equal(output.verification.verdict, "PASS_WITH_SETUP_REQUIRED");
  assert.equal(output.trace.verification.deterministicGatePassed, true);
  assert.equal(output.tracePersistence.status, "persisted");
  assert.equal(traces.length, 1);
  assert.equal(JSON.stringify(output).includes(secret), false);
  assert.equal(session.state.checkpoints, 1);
});

test("platform Gateway is auto-balanced but never changes the resolved provider/model", async () => {
  const value = await project("agent-runtime-gateway");
  const session = services(value);
  let resolutions = 0;
  const output = await runIntelligentBuilderAgent({
    request: request(value.id, "gateway"),
    dependencies: {
      services: session.value,
      audit: new MemoryBuilderAgentAuditSink(),
      modelResolver: async () => {
        resolutions += 1;
        return {
          model: {},
          evidence: {
            provider: "gateway",
            model: "test-model",
            credentialOwner: "platform",
            keyPersisted: false,
          },
        };
      },
      runnerFactory: () => ({
        async generate() {
          return { text: "Gateway build complete.", content: [] };
        },
      }),
    },
    actor: actor(),
    project: value,
    requestedRoutingMode: "auto-quality",
  });
  assert.equal(resolutions, 1);
  assert.equal(output.route.provider, "gateway");
  assert.equal(output.route.model, "test-model");
  assert.equal(output.trace.routes[0].policy, "auto-balanced");
  assert.deepEqual(output.route.fallbackChain, []);
});

test("free fallback records no model route or model context while retaining deterministic verification", async () => {
  const value = await project("agent-runtime-free");
  const session = services(value);
  const output = await runIntelligentBuilderAgent({
    request: request(value.id, "free", "Build the deterministic category-native starter."),
    dependencies: {
      services: session.value,
      audit: new MemoryBuilderAgentAuditSink(),
      deterministicFallback: {
        async run() {
          return { summary: "Deterministic Project V2 starter materialized." };
        },
      },
      modelResolver: async () => {
        throw new Error("free fallback must not resolve a model");
      },
    },
    actor: actor(),
    project: value,
  });
  assert.equal(output.result.status, "fallback");
  assert.equal(output.route.primaryRole, "deterministic-fallback");
  assert.equal(output.contextPackage, null);
  assert.deepEqual(output.trace.routes, []);
  assert.deepEqual(output.trace.contextPackages, []);
  assert.equal(output.result.evidence, null);
  assert.equal(output.verification.verdict, "PASS_WITH_SETUP_REQUIRED");
});

test("read-only verifier cannot upgrade a seeded deterministic build failure and trace persistence is best effort", async () => {
  const value = await project("agent-runtime-failure");
  const session = services(value, releaseGate({ build: false }));
  const blockedResult = {
    status: "blocked",
    providerMode: "ai-agent",
    summary: "Build remains blocked.",
    project: value,
    attempts: 1,
    repairs: 0,
    releaseGate: releaseGate({ build: false }),
    evidence: {
      provider: "openai",
      model: "test-model",
      credentialOwner: "visitor",
      keyPersisted: false,
    },
    approvalTools: [],
  };
  const output = await runIntelligentBuilderAgent({
    request: request(value.id),
    dependencies: {
      services: session.value,
      audit: new MemoryBuilderAgentAuditSink(),
      modelResolver: async () => ({
        model: {},
        evidence: blockedResult.evidence,
      }),
    },
    actor: actor(),
    project: value,
    builderExecutor: async () => blockedResult,
    evalStore: {
      async writeTrace() {
        throw new Error("private Blob is unavailable");
      },
    },
  });
  assert.equal(output.verification.verdict, "RETRYABLE_FAILURE");
  assert.equal(output.trace.verification.deterministicGatePassed, false);
  assert.equal(output.trace.status, "blocked");
  assert.match(output.verification.failedCriteria.join("\n"), /build/);
  assert.equal(output.tracePersistence.status, "unavailable");
  assert.match(output.tracePersistence.reason, /Blob is unavailable/);
});

test("authorized tenant/project scope mismatch stops before indexing or model execution", async () => {
  const value = await project("agent-runtime-scope");
  const session = services(value);
  await assert.rejects(
    () => runIntelligentBuilderAgent({
      request: request(value.id),
      dependencies: {
        services: session.value,
        audit: new MemoryBuilderAgentAuditSink(),
      },
      actor: { ...actor(), actorId: "different-actor" },
      project: value,
    }),
    /scope does not match/,
  );
});
