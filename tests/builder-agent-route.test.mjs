import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const { createGuestIdentityCookie, GUEST_IDENTITY_COOKIE, resolveGuestCookieSecret } = await import("../lib/access-tier.ts");
const { handleBuilderAgentRequest } = await import("../app/api/builder/agent/route.ts");
const { handleBuilderRuntimeRequest } = await import("../app/api/builder/runtime/route.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { hasProjectV2ReleaseReceipt } = await import("../db/project-v2-release-receipts.ts");

process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";

const fixtureProject = await materializeProjectV2Template({
  id: "builder-route-project",
  now: "2026-07-30T12:00:00.000Z",
  spec: createProjectSpec({
    presetId: "crypto-game",
    values: {},
    prompt: "Build a playable crypto market game",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://studio.example.test",
  }),
});

function project() {
  return structuredClone(fixtureProject);
}

function runtimeCommand(kind) {
  return {
    commandId: `command-${kind}`, runId: `run-${kind}`, kind, argv: ["npm", "run", kind], cwd: "/sandbox/project",
    exitCode: 0, stdout: `${kind} passed`, stderr: "", outputTruncated: false,
    startedAt: "2026-07-30T12:00:00.000Z", finishedAt: "2026-07-30T12:00:01.000Z", previewUrl: null,
  };
}

function dependencies() {
  let stored = project();
  const calls = { loadActors: [], ensure: 0, resume: 0, saves: 0 };
  const handle = {
    provider: "vercel-sandbox", projectId: stored.id, sandboxName: "sandbox-route", sessionId: "session-route",
    workspaceRoot: "/sandbox/project", revisionDigest: "a".repeat(64), createdAt: "2026-07-30T12:00:00.000Z", expiresAt: null,
  };
  const repository = {
    async loadAuthorized(actorId, projectId) { calls.loadActors.push(actorId); return projectId === stored.id ? structuredClone(stored) : null; },
    async saveAuthorized(_actorId, next, expectedRevision) {
      assert.equal(expectedRevision, stored.revision);
      stored = structuredClone(next); calls.saves += 1; return structuredClone(stored);
    },
  };
  const runtime = {
    provider: "vercel-sandbox",
    async ensure() { calls.ensure += 1; return handle; },
    async resume() { calls.resume += 1; return handle; },
    async status() { return { provider: "vercel-sandbox", status: "running", sandboxName: handle.sandboxName, sessionId: handle.sessionId, vcpus: 2, memoryMb: 4096, createdAt: handle.createdAt, updatedAt: handle.createdAt, expiresAt: null, activeDurationMs: 1000, previewUrl: "https://preview.example.test/", previewCommandId: "preview-command" }; },
    async writeProject() { return handle; },
    async readFile(_handle, path) { return stored.files[path].content; },
    async installDependencies() { return runtimeCommand("install"); },
    async runCommand() { return runtimeCommand("command"); },
    async startPreview() { return { ...runtimeCommand("preview"), exitCode: null, previewUrl: "https://preview.example.test/", port: 3000 }; },
    async readLogs() { return [{ sequence: 0, stream: "stdout", data: "real log", recordedAt: "2026-07-30T12:00:00.000Z" }]; },
    async stopProcess() {},
    async runTypecheck() { return runtimeCommand("typecheck"); },
    async runLint() { return runtimeCommand("lint"); },
    async runTests() { return runtimeCommand("test"); },
    async runBuild() { return runtimeCommand("build"); },
    async captureCheckpoint(_handle, checkpointId, revision, paths) { return { checkpointId, revision, files: paths.map((path) => ({ path, content: stored.files[path].content })) }; },
    async restoreCheckpoint() { return handle; }, async stop() {}, async destroy() {},
    async cleanupIdle() { return { inspected: 0, stopped: [], failed: [] }; },
  };
  return {
    calls,
    repository,
    runtime,
    audit: { async record() {} },
    browser: {
      async check() { return { ok: true, rendered: true, primaryInteractionChecked: true, statusCode: 200, pageErrors: [], consoleErrors: [], networkErrors: [], summary: "Rendered browser smoke passed." }; },
    },
  };
}

function guestCookie() {
  const secret = resolveGuestCookieSecret();
  return createGuestIdentityCookie("01234567-89ab-cdef-0123-456789abcdef", secret);
}

function request(path, body, headers = {}) {
  return new NextRequest(`https://studio.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example.test",
      host: "studio.example.test",
      "x-forwarded-proto": "https",
      cookie: `${GUEST_IDENTITY_COOKIE}=${guestCookie()}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("guest Free Auto route loads Project V2 server-side and completes the real release gate", async () => {
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__ = new Map();
  const deps = dependencies();
  const response = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project",
    prompt: "Build the materialized crypto starter.",
    mode: "build",
    provider: { provider: "free" },
  }, { "x-provider-key": "sk-request-only-route-key-value" }), deps);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const payload = await response.json();
  assert.equal(payload.result.status, "fallback");
  assert.equal(payload.result.providerMode, "deterministic-fallback");
  assert.equal(payload.result.releaseGate.ok, true);
  assert.equal(payload.result.releaseGate.previewUrl, "https://preview.example.test/");
  assert.deepEqual(payload.result.project.preview, {
    status: "ready",
    projectRevision: fixtureProject.revision,
    sandboxId: "session-route",
    url: "https://preview.example.test/",
    port: 3000,
    startedAt: "2026-07-30T12:00:00.000Z",
  });
  assert.ok(payload.result.project.runs.length >= 5);
  assert.deepEqual(
    new Set(payload.result.project.runs.map((run) => run.taskId)),
    new Set(["build", "typecheck", "lint", "test", "dev"]),
  );
  assert.ok(payload.result.project.logs.some((log) => log.stream === "stdout"));
  assert.ok(payload.result.project.logs.some((log) => log.stream === "browser"));
  assert.ok(payload.result.project.runs.every((run) => run.projectRevision === fixtureProject.revision));
  assert.match(deps.calls.loadActors[0], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(payload).includes("sk-request-only-route-key-value"), false);
  assert.ok(deps.calls.ensure >= 1);
  assert.ok(deps.calls.saves >= 7, "runs, logs, preview, browser, and checkpoint metadata must persist");
  const checkpoint = payload.result.project.checkpoints.at(-1);
  assert.ok(checkpoint);
  assert.equal(await hasProjectV2ReleaseReceipt({
    actorId: deps.calls.loadActors[0],
    projectId: payload.result.project.id,
    revision: checkpoint.snapshot.revision,
    contentHash: checkpoint.snapshot.contentHash,
    checkpointId: checkpoint.id,
    snapshotHash: checkpoint.snapshotHash,
  }), true);
});

test("agent route fails closed when a verified release receipt cannot be persisted", async () => {
  const deps = dependencies();
  const response = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project",
    prompt: "Build the materialized crypto starter.",
    mode: "build",
    provider: { provider: "free" },
  }), {
    ...deps,
    async writeReleaseReceipt() {
      throw new Error("private storage unavailable");
    },
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BUILDER_RELEASE_RECEIPT_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(payload), /private storage unavailable/);
});

test("agent route rejects project snapshots in the body and cross-origin execution", async () => {
  const deps = dependencies();
  const extraProject = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project", prompt: "Build it", mode: "build", provider: { provider: "free" }, project: project(),
  }), deps);
  assert.equal(extraProject.status, 400);
  const crossOrigin = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project", prompt: "Build it", mode: "build", provider: { provider: "free" },
  }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }), deps);
  assert.equal(crossOrigin.status, 403);
});

test("agent route forwards the Vercel Function OIDC token only to the request-scoped Gateway resolver", async () => {
  const deps = dependencies();
  const oidc = `ey${"A".repeat(30)}.ey${"B".repeat(30)}.${"C".repeat(40)}`;
  let receivedCredentials = null;
  const response = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project",
    prompt: "Inspect the canonical project without exposing credentials.",
    mode: "edit",
    provider: { provider: "gateway", model: "openai/gpt-5.6-sol" },
  }, { "x-vercel-oidc-token": oidc }), {
    ...deps,
    modelResolver(_selection, credentials) {
      receivedCredentials = structuredClone(credentials);
      return { model: {}, evidence: { provider: "gateway", model: "openai/gpt-5.6-sol", credentialOwner: "platform", keyPersisted: false } };
    },
    runnerFactory() {
      return {
        async generate() {
          return { text: "No source change was required.", toolCalls: [] };
        },
      };
    },
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(receivedCredentials.gatewayToken, oidc);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes(oidc), false);
});

test("failed release checks return bounded real diagnostics for the repair loop", async () => {
  const deps = dependencies();
  deps.runtime.runBuild = async () => ({
    ...runtimeCommand("build"),
    exitCode: 1,
    stdout: "",
    stderr: "Type error: app/page.tsx line 9 has an invalid property.",
  });
  const response = await handleBuilderAgentRequest(request("/api/builder/agent", {
    projectId: "builder-route-project",
    prompt: "Build it and repair real errors.",
    mode: "build",
    provider: { provider: "free" },
  }), deps);
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.result.releaseGate.ok, false);
  assert.match(payload.result.releaseGate.blockingErrors.join("\n"), /app\/page\.tsx line 9/);
  assert.equal(payload.result.project.preview, undefined);
});

test("runtime status resumes without creating or syncing a new Sandbox", async () => {
  const deps = dependencies();
  const response = await handleBuilderRuntimeRequest(request("/api/builder/runtime", {
    projectId: "builder-route-project",
    action: "status",
  }), deps);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.status, "running");
  assert.equal(payload.result.previewUrl, "https://preview.example.test/");
  assert.equal(deps.calls.resume, 1);
  assert.equal(deps.calls.ensure, 0);
});

test("runtime preview persists and returns real Project V2 preview metadata", async () => {
  const deps = dependencies();
  const response = await handleBuilderRuntimeRequest(request("/api/builder/runtime", {
    projectId: "builder-route-project",
    action: "preview",
    port: 3000,
  }), deps);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.previewUrl, "https://preview.example.test/");
  assert.deepEqual(payload.result.preview, {
    status: "ready",
    projectRevision: fixtureProject.revision,
    sandboxId: "session-route",
    url: "https://preview.example.test/",
    port: 3000,
    startedAt: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(deps.calls.saves, 1);
});

test("runtime restore and destroy require explicit confirmation", async () => {
  const deps = dependencies();
  for (const body of [
    { projectId: "builder-route-project", action: "restore", checkpointId: "checkpoint-1" },
    { projectId: "builder-route-project", action: "destroy" },
  ]) {
    const response = await handleBuilderRuntimeRequest(request("/api/builder/runtime", body), deps);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "BUILDER_RUNTIME_APPROVAL_REQUIRED");
  }
});
