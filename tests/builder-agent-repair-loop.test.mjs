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
  MemoryBuilderAgentAuditSink,
  materializedProjectDeterministicFallback,
  runBuilderAgent,
} = await import("../lib/builder-agent/index.ts");

function releaseGate(ok, message = "passed") {
  return {
    ok,
    checks: [],
    blockingErrors: ok ? [] : [message],
    previewUrl: ok ? "https://preview.example.test/" : null,
  };
}

function services(gates) {
  const project = { id: "repair-loop-project", revision: 1, files: {} };
  const calls = { gates: 0, checkpoints: 0 };
  return {
    calls,
    value: {
      actorId: "repair-loop-actor",
      requestId: "repair-loop-request",
      permissions: new Set(),
      get project() { return structuredClone(project); },
      get runtimeContext() { return { actorId: this.actorId, requestId: this.requestId, project }; },
      listFiles: () => [], readFile: () => "", readFiles: () => [], searchFiles: () => [],
      async writeFile() { return project; }, async applyPatch() { return project; }, async deleteFile() { return project; }, async renameFile() { return project; },
      async installPackage() { throw new Error("unused"); }, async runTask() { throw new Error("unused"); }, async startPreview() { throw new Error("unused"); },
      async readLogs() { return []; }, async runTypecheck() { return null; }, async runLint() { return null; }, async runTests() { return null; }, async runBuild() { throw new Error("unused"); },
      async browserCheck() { throw new Error("unused"); },
      async createCheckpoint() { calls.checkpoints += 1; return { project, checkpoint: { checkpointId: "verified", revision: 1, files: [] } }; },
      async restoreCheckpoint() { return project; }, async requestConnection() { return { status: "setup-required", message: "Setup required" }; },
      async publishProject() { throw new Error("unused"); }, async ensureRuntime() { return {}; },
      async runReleaseGate() { const gate = gates[Math.min(calls.gates, gates.length - 1)]; calls.gates += 1; return gate; },
    },
  };
}

function request(provider = "openai") {
  return {
    projectId: "repair-loop-project",
    prompt: "Build a category-native whale intelligence dashboard.",
    mode: "build",
    provider: { provider, model: provider === "free" ? undefined : "test-model" },
  };
}

const modelResolver = async () => ({
  model: {},
  evidence: { provider: "openai", model: "test-model", credentialOwner: "visitor", keyPersisted: false },
});

test("AI loop performs at most three automatic repairs and succeeds only after release gate", async () => {
  const service = services([
    releaseGate(false, "build failed"),
    releaseGate(false, "page error"),
    releaseGate(false, "interaction failed"),
    releaseGate(true),
  ]);
  const prompts = [];
  const audit = new MemoryBuilderAgentAuditSink();
  const result = await runBuilderAgent(request(), {
    services: service.value,
    audit,
    modelResolver,
    credentials: { apiKey: "request-only-key-value" },
    runnerFactory: () => ({
      async generate(input) {
        prompts.push(input.prompt);
        return { text: `attempt ${prompts.length} complete`, content: [] };
      },
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 4);
  assert.equal(result.repairs, 3);
  assert.equal(service.calls.gates, 4);
  assert.equal(service.calls.checkpoints, 1);
  assert.match(prompts[1], /Automatic repair 1/);
  assert.match(prompts[3], /Automatic repair 3/);
  assert.equal(JSON.stringify(result).includes("request-only-key-value"), false);
  assert.ok(audit.events.some((event) => event.tool === "agent" && event.status === "succeeded"));
});

test("AI loop stops blocked after exactly three failed repair iterations", async () => {
  const service = services([releaseGate(false, "still broken")]);
  let calls = 0;
  const result = await runBuilderAgent(request(), {
    services: service.value,
    audit: new MemoryBuilderAgentAuditSink(),
    modelResolver,
    runnerFactory: () => ({ async generate() { calls += 1; return { text: "repair attempted", content: [] }; } }),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.attempts, 4);
  assert.equal(result.repairs, 3);
  assert.equal(calls, 4);
  assert.equal(service.calls.checkpoints, 0);
});

test("an injected source error is repaired through the real file tool before the second release gate", async () => {
  const service = services([]);
  let source = 'export const headline: string = 42; // injected-error';
  service.value.permissions = new Set(["files:read", "files:write"]);
  service.value.listFiles = () => ["app/page.tsx"];
  service.value.readFile = () => source;
  service.value.readFiles = () => [{ path: "app/page.tsx", content: source }];
  service.value.applyPatch = async (_path, replacements) => {
    for (const replacement of replacements) {
      assert.ok(source.includes(replacement.search));
      source = source.replace(replacement.search, replacement.replace);
    }
    return service.value.project;
  };
  service.value.runReleaseGate = async () => {
    service.calls.gates += 1;
    return source.includes("injected-error")
      ? releaseGate(false, "app/page.tsx: headline must be a string")
      : releaseGate(true);
  };
  let turns = 0;
  const result = await runBuilderAgent(request(), {
    services: service.value,
    audit: new MemoryBuilderAgentAuditSink(),
    modelResolver,
    runnerFactory: ({ tools }) => ({
      async generate() {
        turns += 1;
        if (turns === 2) {
          await tools.apply_patch.execute({
            path: "app/page.tsx",
            replacements: [{
              search: '42; // injected-error',
              replace: '"Whale intelligence";',
            }],
          }, {
            toolCallId: "repair-source",
            messages: [],
            abortSignal: AbortSignal.timeout(5_000),
            context: {},
          });
        }
        return { text: turns === 1 ? "Initial build complete." : "Verified repair applied.", content: [] };
      },
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(result.repairs, 1);
  assert.equal(service.calls.gates, 2);
  assert.match(source, /Whale intelligence/);
  assert.doesNotMatch(source, /injected-error/);
});

test("manual tool approval stops the loop before external execution", async () => {
  const service = services([releaseGate(true)]);
  const result = await runBuilderAgent(request(), {
    services: service.value,
    audit: new MemoryBuilderAgentAuditSink(),
    modelResolver,
    runnerFactory: () => ({
      async generate() {
        return {
          text: "Ready to publish after approval.",
          content: [{ type: "tool-approval-request", toolCall: { toolName: "publish_project" } }],
        };
      },
    }),
  });
  assert.equal(result.status, "approval-required");
  assert.deepEqual(result.approvalTools, ["publish_project"]);
  assert.equal(service.calls.gates, 0);
});

test("free mode is explicit deterministic fallback and never claims AI evidence", async () => {
  const service = services([releaseGate(true)]);
  let fallbackCalls = 0;
  const result = await runBuilderAgent(request("free"), {
    services: service.value,
    audit: new MemoryBuilderAgentAuditSink(),
    deterministicFallback: {
      async run() { fallbackCalls += 1; return { summary: "Deterministic compiler materialized the starter." }; },
    },
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.providerMode, "deterministic-fallback");
  assert.equal(result.evidence, null);
  assert.equal(fallbackCalls, 1);
  assert.equal(service.calls.checkpoints, 1);
});

test("production Free Auto fallback keeps materialized V2 files and runs the full gate", async () => {
  const service = services([releaseGate(true)]);
  service.value.listFiles = () => ["package.json", "app/page.tsx"];
  let ensured = 0;
  service.value.ensureRuntime = async () => { ensured += 1; return {}; };
  const result = await runBuilderAgent(request("free"), {
    services: service.value,
    audit: new MemoryBuilderAgentAuditSink(),
    deterministicFallback: materializedProjectDeterministicFallback,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.releaseGate.ok, true);
  assert.equal(service.calls.gates, 1);
  assert.equal(ensured, 1);
  assert.match(result.summary, /deterministic Project V2 starter/);
});
