import assert from "node:assert/strict";
import test from "node:test";

const runtime = await import("../lib/project-runtime-adapter.ts");
const { LegacyHtmlRuntimeAdapter } = await import(
  "../lib/legacy-html-runtime-adapter.ts"
);

function project(files, overrides = {}) {
  const now = "2026-07-30T12:00:00.000Z";
  return {
    schemaVersion: 2,
    id: "project-runtime-contract",
    revision: 3,
    manifest: {
      schemaVersion: 2,
      name: "Runtime contract",
      slug: "runtime-contract",
      packageManager: "npm",
      framework: { name: "legacy-html", version: "1" },
      runtime: { name: "nodejs", version: "24" },
      scripts: {},
      dependencies: {},
      devDependencies: {},
      entrypoints: ["index.html"],
      legacyFallback: {
        supported: true,
        adapter: "legacy-html",
        reason: "Compatibility test",
        sourceSchemaVersion: 1,
      },
    },
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        {
          kind: "file",
          path,
          content,
          language: path.endsWith(".html") ? "html" : "text",
          role: path === "index.html" ? "entry" : "source",
          provenance: "generated",
          editable: true,
          bytes: new TextEncoder().encode(content).byteLength,
          hash: "0".repeat(64),
          createdAt: now,
          updatedAt: now,
        },
      ]),
    ),
    productSpec: {},
    integrations: [],
    environment: [],
    permissions: [],
    tasks: [],
    runs: [],
    logs: [],
    checkpoints: [],
    migration: {},
    contentHash: "0".repeat(64),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("runtime paths and commands reject traversal, eval, install bypasses, and secrets", () => {
  assert.equal(runtime.assertRuntimePath("app/page.tsx"), "app/page.tsx");
  for (const path of ["../escape", "/etc/passwd", "app\\page.tsx", "a/../b", "a\0b"]) {
    assert.throws(() => runtime.assertRuntimePath(path), /inside|POSIX/i);
  }
  assert.throws(
    () => runtime.assertRuntimeCommand({ id: "eval", kind: "command", argv: ["node", "-e", "process.exit()"] }),
    /flags/i,
  );
  assert.throws(
    () => runtime.assertRuntimeCommand({ id: "install", kind: "command", argv: ["npm", "install"] }),
    /installDependencies/i,
  );
  assert.throws(
    () => runtime.projectRuntimeFiles(project({ "index.html": '<p>safe</p>', "lib/key.ts": 'const apiKey = "sk-this-is-a-secret-token-value";' })),
    /secret/i,
  );
});

test("runtime revision digest is deterministic and changes with exact file bytes", () => {
  const files = [
    { path: "b.txt", content: "b" },
    { path: "a.txt", content: "a" },
  ];
  const first = runtime.runtimeRevisionDigest("project-id", 2, files);
  const second = runtime.runtimeRevisionDigest("project-id", 2, files);
  const changed = runtime.runtimeRevisionDigest("project-id", 2, [
    files[0],
    { path: "a.txt", content: "A" },
  ]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("runtime project ids accept the complete validated Project V2 identifier alphabet", () => {
  const fixture = project({ "index.html": "<!doctype html><title>Runtime</title>" });
  fixture.id = "project:v2.release_1";
  assert.equal(runtime.projectRuntimeId(fixture), fixture.id);
});

test("legacy adapter publishes real HTML through an injected compatibility publisher", async () => {
  const published = [];
  const audit = new runtime.MemoryRuntimeAuditSink();
  const adapter = new LegacyHtmlRuntimeAdapter({
    audit,
    publisher: {
      async publish(input) {
        published.push(input);
        return { id: "legacy-preview-1", url: "https://preview.example.test/p/runtime" };
      },
    },
  });
  const source = project({ "index.html": "<!doctype html><h1>Legacy product</h1>" });
  const context = {
    actorId: "actor-runtime-contract",
    project: source,
    requestId: "request-runtime-contract",
  };
  const handle = await adapter.writeProject(context);
  assert.equal(await adapter.readFile(handle, "index.html"), source.files["index.html"].content);
  const preview = await adapter.startPreview(context, handle);
  assert.equal(preview.previewUrl, "https://preview.example.test/p/runtime");
  assert.equal(published[0].html, source.files["index.html"].content);
  assert.equal((await adapter.status(handle)).previewUrl, preview.previewUrl);
  assert.ok(audit.events.some((event) => event.action === "legacy.preview"));
  await assert.rejects(() => adapter.runBuild(context, handle), /cannot execute/i);
});

test("legacy checkpoints restore the complete requested source snapshot", async () => {
  const adapter = new LegacyHtmlRuntimeAdapter();
  const source = project({ "index.html": "<h1>One</h1>", "app.txt": "state" });
  const context = { actorId: "actor-checkpoint", project: source, requestId: "request-checkpoint" };
  const handle = await adapter.writeProject(context);
  const checkpoint = await adapter.captureCheckpoint(
    handle,
    "checkpoint-one",
    source.revision,
    ["index.html", "app.txt"],
  );
  checkpoint.files.find((file) => file.path === "index.html").content = "<h1>Restored</h1>";
  const restored = await adapter.restoreCheckpoint(context, checkpoint, handle);
  assert.equal(await adapter.readFile(restored, "index.html"), "<h1>Restored</h1>");
  assert.equal(checkpoint.files.length, 2);
  await assert.rejects(
    () => adapter.restoreCheckpoint(context, {
      checkpointId: "checkpoint-secret",
      revision: 4,
      files: [{ path: "index.html", content: '<meta content="sk-this-is-a-secret-token-value">' }],
    }, restored),
    /secret/i,
  );
});

test("legacy runtime records are isolated by signed actor identity", async () => {
  const adapter = new LegacyHtmlRuntimeAdapter();
  const source = project({ "index.html": "<h1>Private</h1>" });
  const first = { actorId: "actor-one", project: source, requestId: "request-one" };
  const second = { actorId: "actor-two", project: source, requestId: "request-two" };
  const handle = await adapter.writeProject(first);
  assert.equal(await adapter.resume(first), handle);
  assert.equal(await adapter.resume(second), null);
});
