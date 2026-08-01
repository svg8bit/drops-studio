import assert from "node:assert/strict";
import test from "node:test";

const {
  MemoryRuntimeAuditSink,
} = await import("../lib/project-runtime-adapter.ts");
const {
  VercelSandboxRuntimeAdapter,
  sandboxNameFor,
} = await import("../lib/vercel-sandbox-runtime-adapter.ts");

function project(overrides = {}) {
  const now = "2026-07-30T12:00:00.000Z";
  const source = {
    "package.json": JSON.stringify({
      private: true,
      scripts: { dev: "next dev", build: "next build", test: "node tests/smoke.mjs" },
      dependencies: { next: "16.2.12", react: "19.2.8", "react-dom": "19.2.8" },
    }),
    "app/page.tsx": "export default function Page(){ return <main>Ready</main>; }",
    "tests/smoke.mjs": 'console.log("test passed")',
  };
  return {
    schemaVersion: 2,
    id: "sandbox-project",
    revision: 1,
    contentHash: "0".repeat(64),
    manifest: {
      schemaVersion: 2,
      name: "Sandbox project",
      slug: "sandbox-project",
      packageManager: "npm",
      framework: { name: "nextjs", version: "16.2.12" },
      runtime: { name: "nodejs", version: "24" },
      scripts: { dev: "next dev", build: "next build", test: "node tests/smoke.mjs" },
      dependencies: {},
      devDependencies: {},
      entrypoints: ["app/page.tsx"],
      legacyFallback: { supported: true, adapter: "legacy-html", reason: "fallback", sourceSchemaVersion: 1 },
    },
    files: Object.fromEntries(Object.entries(source).map(([path, content]) => [path, {
      kind: "file",
      path,
      content,
      language: path.endsWith(".tsx") ? "tsx" : path.endsWith(".json") ? "json" : "javascript",
      role: path === "package.json" ? "manifest" : path.startsWith("tests/") ? "test" : "entry",
      provenance: "generated",
      editable: true,
      bytes: new TextEncoder().encode(content).byteLength,
      hash: "0".repeat(64),
      createdAt: now,
      updatedAt: now,
    }])),
    productSpec: {}, integrations: [], environment: [], permissions: [], tasks: [],
    runs: [], logs: [], checkpoints: [], migration: {}, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

class MockCommand {
  constructor(id, lines = [{ stream: "stdout", data: "ok\n" }], exitCode = 0) {
    this.cmdId = id;
    this.cwd = "/vercel/sandbox";
    this.startedAt = Date.now();
    this.exitCode = exitCode;
    this.lines = lines;
    this.killed = [];
  }
  logs() {
    const lines = this.lines;
    const iterator = (async function* () {
      for (const line of lines) yield line;
    })();
    iterator.close = () => {};
    return iterator;
  }
  async wait() { return this; }
  async stdout() { return this.lines.filter((line) => line.stream === "stdout").map((line) => line.data).join(""); }
  async stderr() { return this.lines.filter((line) => line.stream === "stderr").map((line) => line.data).join(""); }
  async kill(signal) { this.killed.push(signal); this.exitCode = 143; }
}

class MockFileSystem {
  constructor() { this.files = new Map(); this.renames = []; }
  async mkdir() {}
  async rm(path) {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }
  async rename(from, to) {
    this.renames.push({ from, to });
    for (const [key, value] of [...this.files.entries()]) {
      if (key === from || key.startsWith(`${from}/`)) {
        this.files.delete(key);
        this.files.set(`${to}${key.slice(from.length)}`, value);
      }
    }
  }
  async readFile(path) {
    if (!this.files.has(path)) throw new Error("not found");
    return this.files.get(path);
  }
  async lstat(path) {
    if (!this.files.has(path)) throw new Error("not found");
    return { isSymbolicLink: () => false, isFile: () => true };
  }
  async readdir(path) {
    const prefix = `${path}/`;
    const children = new Map();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      if (!suffix) continue;
      const [name, ...rest] = suffix.split("/");
      children.set(name, rest.length > 0 ? "directory" : "file");
    }
    if (!children.size) throw new Error("not found");
    return [...children].map(([name, kind]) => ({
      name,
      isFile: () => kind === "file",
      isDirectory: () => kind === "directory",
      isSymbolicLink: () => false,
    }));
  }
}

class MockSandbox {
  constructor() {
    this.name = "";
    this.persistent = true;
    this.vcpus = 2;
    this.memory = 4096;
    this.runtime = "node24";
    this.status = "running";
    this.createdAt = new Date("2026-07-30T12:00:00.000Z");
    this.updatedAt = new Date("2026-07-30T12:01:00.000Z");
    this.expiresAt = new Date("2026-07-30T12:30:00.000Z");
    this.fs = new MockFileSystem();
    this.updates = [];
    this.commands = [];
    this.commandById = new Map();
    this.stopped = false;
    this.deleted = false;
    this.nextLines = null;
  }
  currentSession() { return { sessionId: "session-mock-1" }; }
  async writeFiles(files) { for (const file of files) this.fs.files.set(file.path, String(file.content)); }
  async runCommand(input) {
    this.commands.push(input);
    const preview = input.args[0] === "run" && input.args[1] === "dev";
    const command = new MockCommand(
      `command-${this.commands.length}`,
      this.nextLines ?? [{ stream: "stdout", data: "ok\n" }],
      preview ? null : 0,
    );
    this.nextLines = null;
    this.commandById.set(command.cmdId, command);
    return command;
  }
  async getCommand(id) { return this.commandById.get(id) ?? new MockCommand(id); }
  domain(port) { return `https://sandbox-${port}.vercel.run`; }
  async update(input) {
    this.updates.push(input);
    if (input.tags) this.tags = { ...input.tags };
  }
  async stop() { this.stopped = true; this.status = "stopped"; }
  async delete() { this.deleted = true; }
}

function provider(sandbox) {
  const calls = { create: [], get: [], list: [] };
  return {
    calls,
    api: {
      async getOrCreate(input) { calls.create.push(input); sandbox.name = input.name; return sandbox; },
      async get(input) { calls.get.push(input); return sandbox; },
      async list(input) {
        calls.list.push(input);
        return (async function* () {
          yield { name: sandbox.name, status: "running", createdAt: 1, updatedAt: 1 };
        })();
      },
    },
  };
}

test("stable adapter creates a private named persistent Node 24 sandbox with 2 vCPU", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const audit = new MemoryRuntimeAuditSink();
  const adapter = new VercelSandboxRuntimeAdapter({ provider: mock.api, audit, credentials: null });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-1" };
  const handle = await adapter.ensure(context);
  const create = mock.calls.create[0];
  assert.equal(create.name, sandboxNameFor(context.actorId, context.project.id));
  assert.equal(create.runtime, "node24");
  assert.deepEqual(create.resources, { vcpus: 2 });
  assert.equal(create.persistent, true);
  assert.deepEqual(create.ports, [3000, 8080]);
  assert.deepEqual(create.env, {});
  assert.equal(create.networkPolicy, "deny-all");
  assert.equal(handle.sessionId, "session-mock-1");
  assert.ok(!JSON.stringify(create).includes(context.actorId), "raw identity must not enter provider metadata");
  assert.ok(audit.events.some((event) => event.action === "sandbox.ensure" && event.status === "succeeded"));
});

test("files are staged atomically and install switches from registry to runtime allowlist", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const adapter = new VercelSandboxRuntimeAdapter({
    provider: mock.api,
    credentials: null,
    runtimeAllowedHosts: ["proxy.drops.studio"],
  });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-2" };
  const handle = await adapter.writeProject(context);
  assert.equal(await adapter.readFile(handle, "app/page.tsx"), context.project.files["app/page.tsx"].content);
  const result = await adapter.installDependencies(context, handle);
  assert.equal(result.exitCode, 0);
  const policies = sandbox.updates.filter((entry) => entry.networkPolicy).map((entry) => entry.networkPolicy);
  assert.ok(policies.some((entry) => entry.allow?.includes("registry.npmjs.org")));
  assert.deepEqual(policies.at(-1), { allow: ["proxy.drops.studio"] });
  const install = sandbox.commands.at(-1);
  assert.equal(install.cmd, "npm");
  assert.ok(install.args.includes("--ignore-scripts"));
  assert.equal(install.env.NPM_CONFIG_IGNORE_SCRIPTS, "true");
  assert.equal(install.env.VERCEL_OIDC_TOKEN, undefined);
  assert.equal(install.env.OPENAI_API_KEY, undefined);
});

test("a stateless adapter reuses an integrity-checked revision with install and build artifacts", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-stateless" };
  const first = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const handle = await first.writeProject(context);
  sandbox.fs.files.set(`${handle.workspaceRoot}/node_modules/pkg/index.js`, "runtime dependency");
  sandbox.fs.files.set(`${handle.workspaceRoot}/.next/cache/compiler.bin`, "runtime cache");
  sandbox.fs.files.set(`${handle.workspaceRoot}/next-env.d.ts`, "generated runtime typing");
  const sourceRenamesBefore = sandbox.fs.renames.filter(({ from }) =>
    from.includes(".staging-"),
  ).length;

  const second = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const resumed = await second.writeProject(context);
  assert.equal(resumed.workspaceRoot, handle.workspaceRoot);
  assert.equal(
    sandbox.fs.renames.filter(({ from }) => from.includes(".staging-")).length,
    sourceRenamesBefore,
    "verified source should not be rewritten",
  );
});

test("a stateless adapter fails closed when an existing source revision was mutated", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-tamper" };
  const first = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const handle = await first.writeProject(context);
  sandbox.fs.files.set(`${handle.workspaceRoot}/app/rogue.tsx`, "export default function Rogue(){}");

  const second = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  await assert.rejects(
    () => second.writeProject(context),
    /source-integrity verification/i,
  );
});

test("preview waits for a real HTTP response and exposes actual logs and status", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  let fetches = 0;
  const adapter = new VercelSandboxRuntimeAdapter({
    provider: mock.api,
    credentials: null,
    async fetch() { fetches += 1; return new Response("ready", { status: 200 }); },
  });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-3" };
  const handle = await adapter.writeProject(context);
  const preview = await adapter.startPreview(context, handle);
  assert.equal(preview.previewUrl, "https://sandbox-3000.vercel.run/");
  assert.equal(fetches, 1);
  const logs = await adapter.readLogs(handle, { commandId: preview.commandId, limit: 10 });
  assert.deepEqual(logs.map((line) => line.data), ["ok\n"]);
  const state = await adapter.status(handle);
  assert.equal(state.previewUrl, preview.previewUrl);
  assert.equal(state.vcpus, 2);
  assert.equal(state.memoryMb, 4096);
  const stateless = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const resumed = await stateless.resume(context);
  assert.ok(resumed);
  assert.equal(mock.calls.get.at(-1).resume, false, "status lookup must not restart a stopped Sandbox");
  assert.equal((await stateless.status(resumed)).previewUrl, preview.previewUrl);
  await adapter.stopProcess(handle, preview.commandId);
  assert.equal((await adapter.status(handle)).previewUrl, null);
});

test("stopped sandboxes never expose stale preview evidence or an active duration", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const adapter = new VercelSandboxRuntimeAdapter({
    provider: mock.api,
    credentials: null,
    async fetch() { return new Response("ready", { status: 200 }); },
  });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-stopped" };
  const handle = await adapter.writeProject(context);
  const preview = await adapter.startPreview(context, handle);
  assert.ok(preview.previewUrl);
  sandbox.status = "stopped";

  const state = await adapter.status(handle);
  assert.equal(state.status, "stopped");
  assert.equal(state.createdAt, null);
  assert.equal(state.activeDurationMs, null);
  assert.equal(state.previewUrl, null);
  assert.equal(state.previewCommandId, null);
});

test("a stateless preview restart terminates the prior tagged dev command", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-preview-restart" };
  const first = new VercelSandboxRuntimeAdapter({
    provider: mock.api,
    credentials: null,
    async fetch() { return new Response("ready", { status: 200 }); },
  });
  const handle = await first.writeProject(context);
  const initial = await first.startPreview(context, handle);
  const initialCommand = sandbox.commandById.get(initial.commandId);

  const second = new VercelSandboxRuntimeAdapter({
    provider: mock.api,
    credentials: null,
    async fetch() { return new Response("ready", { status: 200 }); },
  });
  const resumed = await second.resume(context);
  assert.ok(resumed);
  const restarted = await second.startPreview(context, resumed);
  assert.notEqual(restarted.commandId, initial.commandId);
  assert.ok(initialCommand.killed.includes("SIGTERM"));
});

test("checkpoint restore uses a full secret-free file snapshot and idle cleanup stops named sandboxes", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const adapter = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-4" };
  const handle = await adapter.writeProject(context);
  const checkpoint = await adapter.captureCheckpoint(handle, "safe-checkpoint", 1, ["package.json", "app/page.tsx", "tests/smoke.mjs"]);
  checkpoint.files.find((file) => file.path === "app/page.tsx").content = "export default function Page(){ return <main>Restored</main>; }";
  const restored = await adapter.restoreCheckpoint(context, checkpoint, handle);
  assert.match(await adapter.readFile(restored, "app/page.tsx"), /Restored/);
  const cleanup = await adapter.cleanupIdle({ idleBefore: new Date("2026-07-30T12:00:00.000Z") });
  assert.equal(cleanup.inspected, 1);
  assert.deepEqual(cleanup.stopped, [sandbox.name]);
  assert.equal(sandbox.stopped, true);
});

test("command and log output is truncated and redacted before leaving the adapter", async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  const adapter = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-output" };
  const handle = await adapter.writeProject(context);

  sandbox.nextLines = [{ stream: "stdout", data: "x".repeat(80_000) }];
  const bounded = await adapter.runBuild(context, handle);
  assert.equal(bounded.outputTruncated, true);
  assert.ok(new TextEncoder().encode(bounded.stdout).byteLength <= 64_000);

  sandbox.nextLines = [
    { stream: "stdout", data: "sk-proj-" },
    { stream: "stdout", data: "abcdefghijklmnopqrstuvwxyz1234567890" },
  ];
  const secret = await adapter.runBuild(context, handle);
  assert.equal(secret.stdout, "[redacted secret material]");
  const logs = await adapter.readLogs(handle, { commandId: secret.commandId });
  assert.ok(logs.every((entry) => entry.data === "[redacted secret material]"));
  assert.equal(JSON.stringify(secret).includes("abcdefghijklmnopqrstuvwxyz1234567890"), false);

  sandbox.nextLines = Array.from({ length: 20 }, () => ({
    stream: "stdout",
    data: "z".repeat(8_000),
  }));
  const verbose = await adapter.runBuild(context, handle);
  const verboseLogs = await adapter.readLogs(handle, { commandId: verbose.commandId });
  assert.ok(
    new TextEncoder().encode(verboseLogs.map((entry) => entry.data).join("")).byteLength <= 64_000,
  );
});

test("a timed-out command is killed and returns only a secret-free provider error", { timeout: 6_000 }, async () => {
  const sandbox = new MockSandbox();
  const mock = provider(sandbox);
  let hanging;
  sandbox.runCommand = async function runCommand(input) {
    this.commands.push(input);
    hanging = new MockCommand("command-hanging", [], null);
    hanging.logs = ({ signal }) => {
      const iterator = (async function* () {
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      })();
      iterator.close = () => {};
      return iterator;
    };
    this.commandById.set(hanging.cmdId, hanging);
    return hanging;
  };
  const adapter = new VercelSandboxRuntimeAdapter({ provider: mock.api, credentials: null });
  const context = { actorId: "signed-user-identity", project: project(), requestId: "request-timeout" };
  const handle = await adapter.writeProject(context);
  await assert.rejects(
    () => adapter.runCommand(context, handle, {
      id: "timeout-build",
      kind: "build",
      argv: ["npm", "run", "build"],
      timeoutMs: 1_000,
    }),
    /timeout/i,
  );
  assert.deepEqual(hanging.killed, ["SIGKILL"]);
});
