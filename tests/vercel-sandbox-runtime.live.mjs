import assert from "node:assert/strict";
import test from "node:test";

const { VercelSandboxRuntimeAdapter } = await import(
  "../lib/vercel-sandbox-runtime-adapter.ts"
);

if (process.env.DROPS_STUDIO_LIVE_SANDBOX !== "1") {
  throw new Error(
    "Live Sandbox verification is external and credentialed. Run it explicitly with npm run test:live:sandbox.",
  );
}

function project() {
  const now = "2026-07-30T12:00:00.000Z";
  const source = {
    "package.json": JSON.stringify({
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        test: "node tests/smoke.mjs",
      },
      dependencies: {
        next: "16.2.12",
        react: "19.2.8",
        "react-dom": "19.2.8",
      },
    }),
    "app/page.tsx": "export default function Page(){ return <main>Ready</main>; }",
    "tests/smoke.mjs": 'console.log("test passed")',
  };

  return {
    schemaVersion: 2,
    id: "live-sandbox-smoke",
    revision: 1,
    contentHash: "0".repeat(64),
    manifest: {
      schemaVersion: 2,
      name: "Live Sandbox smoke",
      slug: "live-sandbox-smoke",
      packageManager: "npm",
      framework: { name: "nextjs", version: "16.2.12" },
      runtime: { name: "nodejs", version: "24" },
      scripts: {
        dev: "next dev",
        build: "next build",
        test: "node tests/smoke.mjs",
      },
      dependencies: {},
      devDependencies: {},
      entrypoints: ["app/page.tsx"],
      legacyFallback: {
        supported: true,
        adapter: "legacy-html",
        reason: "fallback",
        sourceSchemaVersion: 1,
      },
    },
    files: Object.fromEntries(
      Object.entries(source).map(([path, content]) => [
        path,
        {
          kind: "file",
          path,
          content,
          language: path.endsWith(".tsx")
            ? "tsx"
            : path.endsWith(".json")
              ? "json"
              : "javascript",
          role: path === "package.json" ? "manifest" : path.startsWith("tests/") ? "test" : "entry",
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
    createdAt: now,
    updatedAt: now,
  };
}

test("live stable Sandbox smoke writes files and runs the generated test task", {
  timeout: 300_000,
}, async () => {
  const adapter = new VercelSandboxRuntimeAdapter();
  const context = {
    actorId: "explicit-live-sandbox-smoke",
    project: project(),
    requestId: "live-smoke",
  };
  const handle = await adapter.writeProject(context);

  try {
    const result = await adapter.runTests(context, handle);
    assert.equal(result.exitCode, 0);
  } finally {
    await adapter.destroy(handle);
  }
});
