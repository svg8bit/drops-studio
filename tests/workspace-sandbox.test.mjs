import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const sandboxModule = await import("../lib/workspace-sandbox.ts").catch(
  () => null,
);
const routeModule = await import("../app/api/workspace/run/route.ts").catch(
  () => null,
);
const entitlementModule = await import(
  "../lib/workspace-ai-entitlement.ts"
).catch(() => null);
const {
  workspaceRunReceiptMatchesRevision,
  workspaceRunReceiptStatus,
} = await import(
  "../lib/workspace-run-receipt.ts"
);
const { createWorkspaceRunDigest } = await import(
  "../lib/workspace-run-digest.ts"
);

function api() {
  assert.ok(sandboxModule, "workspace sandbox module must exist");
  return sandboxModule;
}

function workspace(overrides = {}) {
  return {
    id: "workspace-safe-slice",
    revision: 3,
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          private: true,
          type: "module",
          scripts: { test: "node tests/smoke.mjs" },
          dependencies: { zod: "4.4.3" },
        }),
      },
      {
        path: "tests/smoke.mjs",
        content: 'console.log("workspace smoke passed");',
      },
    ],
    tasks: [
      {
        id: "test",
        argv: ["node", "tests/smoke.mjs"],
        timeoutMs: 5_000,
      },
    ],
    ...overrides,
  };
}

test("workspace digests use deterministic Unicode code-point ordering", async () => {
  const files = [
    { path: "🐱.txt", content: "cat" },
    { path: "ä.txt", content: "umlaut" },
    {
      path: "package.json",
      content: '{"z":1,"ä":2,"a":3,"🐱":4}',
    },
    { path: "z.txt", content: "zed" },
    { path: "𝒜.txt", content: "script-a" },
  ];
  const input = {
    files,
    task: { id: "test", argv: ["node", "test.mjs"] },
  };

  assert.equal(
    await createWorkspaceRunDigest(input),
    "a917755ea976aa3536ce49f37e8e43780ea6cbd2707ca86686efed8ee7e43ded",
  );
  assert.equal(
    await createWorkspaceRunDigest({ ...input, files: [...files].reverse() }),
    "a917755ea976aa3536ce49f37e8e43780ea6cbd2707ca86686efed8ee7e43ded",
  );
});

test("returns verified Vercel Sandbox evidence only after the provider succeeds", async () => {
  const { runWorkspaceSandbox } = api();
  let providerInput;
  const receipt = await runWorkspaceSandbox(
    { workspace: workspace(), taskId: "test" },
    {
      provider: {
        async execute(input) {
          providerInput = input;
          return {
            provider: "vercel-sandbox",
            isolation: "firecracker-microvm",
            providerRunId: "sbx-real-123:session-real-456",
            exitCode: 0,
            stdout: "workspace smoke passed\n",
            stderr: "",
            startedAt: "2026-07-30T12:00:00.000Z",
            finishedAt: "2026-07-30T12:00:01.250Z",
            previewUrl: "https://workspace-safe-slice.vercel.run",
          };
        },
      },
    },
  );

  assert.equal(providerInput.task.id, "test");
  assert.deepEqual(providerInput.task.argv, ["node", "tests/smoke.mjs"]);
  assert.deepEqual(providerInput.dependencies, { zod: "4.4.3" });
  assert.equal(receipt.provider, "vercel-sandbox");
  assert.equal(receipt.isolation, "firecracker-microvm");
  assert.equal(receipt.providerRunId, "sbx-real-123:session-real-456");
  assert.equal(receipt.workspaceId, "workspace-safe-slice");
  assert.equal(receipt.workspaceRevision, 3);
  const expectedDigest = await createWorkspaceRunDigest({
    files: workspace().files,
    task: {
      id: "test",
      argv: ["node", "tests/smoke.mjs"],
      timeoutMs: 5_000,
    },
  });
  assert.equal(receipt.workspaceDigest, expectedDigest);
  assert.match(receipt.workspaceDigest, /^[a-f0-9]{64}$/);
  const cwdDigest = await createWorkspaceRunDigest({
    files: workspace().files,
    task: {
      id: "test",
      argv: ["node", "tests/smoke.mjs"],
      cwd: "packages/other",
      timeoutMs: 5_000,
    },
  });
  const portDigest = await createWorkspaceRunDigest({
    files: workspace().files,
    task: {
      id: "test",
      argv: ["node", "tests/smoke.mjs"],
      timeoutMs: 5_000,
      previewPort: 4173,
    },
  });
  assert.notEqual(cwdDigest, expectedDigest);
  assert.notEqual(portDigest, expectedDigest);
  assert.equal(receipt.task, "test");
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.stdout, "workspace smoke passed\n");
  assert.equal(receipt.stderr, "");
  assert.equal(receipt.startedAt, "2026-07-30T12:00:00.000Z");
  assert.equal(receipt.finishedAt, "2026-07-30T12:00:01.250Z");
  assert.equal(
    receipt.previewUrl,
    "https://workspace-safe-slice.vercel.run/",
  );

  const editedWorkspace = { ...workspace(), revision: 4 };
  assert.equal(
    workspaceRunReceiptMatchesRevision(
      receipt,
      "workspace-safe-slice",
      workspace().revision,
    ),
    true,
  );
  assert.equal(
    workspaceRunReceiptMatchesRevision(
      receipt,
      "workspace-safe-slice",
      editedWorkspace.revision,
    ),
    false,
    "a run receipt must stop verifying the workspace immediately after an edit increments its revision",
  );
  assert.equal(
    receipt.stdout,
    "workspace smoke passed\n",
    "historical terminal output remains available after revision invalidation",
  );
  assert.equal(
    workspaceRunReceiptStatus(
      receipt,
      {
        workspaceId: "workspace-safe-slice",
        workspaceRevision: 3,
        workspaceDigest: expectedDigest,
        task: "test",
      },
      { running: true, error: "" },
    ),
    "previous",
    "a new attempt must demote the retained receipt before the attempt completes",
  );
  assert.equal(
    workspaceRunReceiptStatus(
      receipt,
      {
        workspaceId: "workspace-safe-slice",
        workspaceRevision: 3,
        workspaceDigest: expectedDigest,
        task: "test",
      },
      { running: false, error: "The new run failed" },
    ),
    "previous",
    "a failed new attempt must not present the retained receipt as that attempt's evidence",
  );

  const adversarialFiles = workspace().files.map((file) =>
    file.path === "tests/smoke.mjs"
      ? { ...file, content: 'console.log("changed without revision");' }
      : file,
  );
  const adversarialDigest = await createWorkspaceRunDigest({
    files: adversarialFiles,
    task: {
      id: "test",
      argv: ["node", "tests/smoke.mjs"],
      timeoutMs: 5_000,
    },
  });
  assert.notEqual(adversarialDigest, receipt.workspaceDigest);
  assert.equal(
    workspaceRunReceiptStatus(
      receipt,
      {
        workspaceId: "workspace-safe-slice",
        workspaceRevision: 3,
        workspaceDigest: adversarialDigest,
        task: "test",
      },
      { running: false, error: "" },
    ),
    "historical",
    "a caller cannot keep Verified by reusing a revision after changing exact workspace bytes",
  );
});

test("Studio verifies only the exact server-bound workspace revision and retains historical terminal output", async () => {
  const [sandboxSource, studioSource, dialogSource] = await Promise.all([
    readFile(new URL("../lib/workspace-sandbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/project-workspace-dialog.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(sandboxSource, /workspaceId: validated\.workspaceId,[\s\S]*workspaceRevision: validated\.revision,[\s\S]*workspaceDigest/);
  assert.match(
    studioSource,
    /receipt\.workspaceId !== currentProject\.id \|\|[\s\S]*receipt\.workspaceRevision !== workspace\.revision \|\|[\s\S]*receipt\.workspaceDigest !== submittedDigest \|\|[\s\S]*receipt\.task !== task\.id \|\|[\s\S]*receipt\.argv\.length !== submittedArgv\.length/,
  );
  assert.match(studioSource, /workspaceId=\{project\.id\}/);
  assert.match(studioSource, /currentWorkspaceDigest=\{[\s\S]*workspaceRunDigestEvidence\?\.project === project[\s\S]*workspaceRunDigestEvidence\.digest/);
  assert.doesNotMatch(
    studioSource,
    /setWorkspaceRunReceipt\(null\)/,
    "source revisions and subsequent runs must retain the last terminal receipt as historical output",
  );
  assert.match(dialogSource, /workspaceRunReceiptStatus\([\s\S]*receipt,[\s\S]*workspaceId,[\s\S]*workspaceRevision: workspace\.revision,[\s\S]*workspaceDigest: currentWorkspaceDigest/);
  assert.match(dialogSource, /Previous verified receipt · revision/);
  assert.match(dialogSource, /current run is pending or failed/);
  assert.match(dialogSource, /Historical receipt · revision/);
  assert.match(dialogSource, /Output retained from workspace revision/);
  assert.match(dialogSource, /current revision \{workspace\.revision\} needs a new sandbox run/);
  assert.match(dialogSource, /Open historical sandbox port/);
  assert.match(
    dialogSource,
    /<Textarea[\s\S]*?readOnly=\{!editable\}[\s\S]*?aria-label=/,
    "non-editable workspace files must expose native readonly semantics",
  );
});

test("normalizes the current ProjectWorkspace command and args contract into task argv", async () => {
  const { runWorkspaceSandbox } = api();
  const currentWorkspace = workspace({
    id: undefined,
    tasks: [
      {
        id: "start",
        label: "Start preview",
        command: "npm",
        args: ["start"],
        port: 4173,
      },
    ],
  });
  const manifest = JSON.parse(currentWorkspace.files[0].content);
  manifest.scripts.start = "node server.mjs";
  currentWorkspace.files[0].content = JSON.stringify(manifest);
  let providerInput;
  const receipt = await runWorkspaceSandbox(
    {
      workspaceId: "project-owned-workspace",
      workspace: currentWorkspace,
      taskId: "start",
    },
    {
      provider: {
        async execute(input) {
          providerInput = input;
          return {
            provider: "vercel-sandbox",
            isolation: "firecracker-microvm",
            providerRunId: "sbx-real-123:session-real-456",
            exitCode: 0,
            stdout: "preview ready",
            stderr: "",
            startedAt: "2026-07-30T12:00:00.000Z",
            finishedAt: "2026-07-30T12:00:01.250Z",
            previewUrl: "https://workspace-safe-slice.vercel.run",
          };
        },
      },
    },
  );

  assert.deepEqual(providerInput.task.argv, ["npm", "start"]);
  assert.equal(providerInput.task.previewPort, 4173);
  assert.equal(receipt.workspaceId, "project-owned-workspace");
  assert.deepEqual(receipt.argv, ["npm", "start"]);
});

test("validates explicit npm workspaces and runs scripts from the selected package manifest", () => {
  const { validateWorkspaceSandboxRun } = api();
  const root = {
    private: true,
    type: "module",
    workspaces: ["packages/frontend", "packages/api"],
    scripts: { test: "node tests/root.test.mjs" },
    dependencies: { zod: "4.4.3" },
  };
  const input = workspace({
    files: [
      { path: "package.json", content: JSON.stringify(root) },
      {
        path: "packages/frontend/package.json",
        content: JSON.stringify({
          private: true,
          scripts: { build: "node build.mjs" },
          dependencies: { react: "19.2.4" },
        }),
      },
      { path: "packages/frontend/build.mjs", content: 'console.log("built")' },
      {
        path: "packages/api/package.json",
        content: JSON.stringify({
          private: true,
          scripts: { test: "node tests/api.test.mjs" },
          devDependencies: { typescript: "5.9.3" },
        }),
      },
      { path: "packages/api/tests/api.test.mjs", content: 'console.log("passed")' },
    ],
    tasks: [
      {
        id: "api-test",
        argv: ["npm", "test"],
        cwd: "packages/api",
      },
    ],
  });

  const validated = validateWorkspaceSandboxRun({
    workspace: input,
    taskId: "api-test",
  });
  assert.equal(validated.task.cwd, "packages/api");
  assert.deepEqual(validated.workspaceDirectories, [
    "packages/frontend",
    "packages/api",
  ]);
  assert.deepEqual(validated.dependencies, {
    zod: "4.4.3",
    react: "19.2.4",
    typescript: "5.9.3",
  });
});

test("rejects missing package manifests, git dependencies and package cwd/script mismatches", () => {
  const { validateWorkspaceSandboxRun, WorkspaceSandboxValidationError } = api();
  const root = JSON.parse(workspace().files[0].content);
  root.workspaces = ["packages/api"];

  assert.throws(
    () =>
      validateWorkspaceSandboxRun({
        workspace: workspace({
          files: [{ path: "package.json", content: JSON.stringify(root) }],
        }),
        taskId: "test",
      }),
    /packages\/api\/package\.json.*required/i,
  );

  assert.throws(
    () =>
      validateWorkspaceSandboxRun({
        workspace: workspace({
          files: [
            { path: "package.json", content: JSON.stringify(root) },
            {
              path: "packages/api/package.json",
              content: JSON.stringify({
                private: true,
                scripts: { test: "node test.mjs" },
                devDependencies: {
                  unsafe: "git+https://example.invalid/repo.git",
                },
              }),
            },
          ],
        }),
        taskId: "test",
      }),
    /exact npm registry versions/i,
  );

  const files = [
    { path: "package.json", content: JSON.stringify(root) },
    {
      path: "packages/api/package.json",
      content: JSON.stringify({
        private: true,
        scripts: { build: "node build.mjs" },
      }),
    },
  ];
  assert.throws(
    () =>
      validateWorkspaceSandboxRun({
        workspace: workspace({
          files,
          tasks: [{ id: "api-test", argv: ["npm", "test"], cwd: "packages/api" }],
        }),
        taskId: "api-test",
      }),
    /declared package\.json script/i,
  );
  assert.throws(
    () =>
      validateWorkspaceSandboxRun({
        workspace: workspace({
          files,
          tasks: [{ id: "outside", argv: ["npm", "test"], cwd: "packages/other" }],
        }),
        taskId: "outside",
      }),
    WorkspaceSandboxValidationError,
  );
});

test("caps aggregate sandbox dependencies at 64 across root and package manifests", () => {
  const { validateWorkspaceSandboxRun } = api();
  const dependencies = (prefix, count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `${prefix}-${index}`,
        "1.0.0",
      ]),
    );
  const root = {
    private: true,
    workspaces: ["packages/api"],
    scripts: { test: "node root.test.mjs" },
    dependencies: dependencies("root", 32),
  };
  const child = {
    private: true,
    scripts: { test: "node api.test.mjs" },
    devDependencies: dependencies("child", 32),
  };
  const bounded = workspace({
    files: [
      { path: "package.json", content: JSON.stringify(root) },
      {
        path: "packages/api/package.json",
        content: JSON.stringify(child),
      },
    ],
    tasks: [{ id: "test", argv: ["npm", "test"] }],
  });

  const validated = validateWorkspaceSandboxRun({
    workspace: bounded,
    taskId: "test",
  });
  assert.equal(Object.keys(validated.dependencies).length, 64);

  child.devDependencies.extra = "1.0.0";
  bounded.files[1].content = JSON.stringify(child);
  assert.throws(
    () =>
      validateWorkspaceSandboxRun({ workspace: bounded, taskId: "test" }),
    /aggregate 64 dependency limit/i,
  );
});

test("installs declared workspaces from the root with scripts disabled before denying network", async () => {
  const source = await readFile(
    new URL("../lib/workspace-sandbox.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /--workspaces/);
  assert.match(source, /--ignore-scripts/);
  assert.match(source, /cwd:\s*WORKSPACE_ROOT/);
  assert.match(source, /registry\.npmjs\.org/);
  assert.match(source, /update\(\{ networkPolicy: "deny-all" \}\)/);
  const installAt = source.indexOf(
    "const install = await sandbox.runCommand({",
  );
  const denyNetworkAt = source.indexOf(
    'sandbox.update({ networkPolicy: "deny-all" })',
  );
  assert.ok(
    installAt >= 0 && denyNetworkAt >= 0,
    "install and deny-all transitions must both be present",
  );
  assert.ok(
    installAt < denyNetworkAt,
    "dependency installation must finish before runtime network is denied",
  );
});

test("starts preview servers detached and verifies the local port before returning a URL", async () => {
  const source = await readFile(
    new URL("../lib/workspace-sandbox.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /detached:\s*true/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /Preview process did not become ready/);
});

test("copies only referenced public runtime assets into a preview sandbox", async () => {
  const { loadWorkspaceRuntimeAssets } = api();
  const requested = [];
  const assets = await loadWorkspaceRuntimeAssets(
    [
      {
        path: "index.html",
        content:
          '<img src="/brand/dropstab-mark.svg"><img src="/assets/market-wolf-catcher.png">',
      },
    ],
    {
      origin: "https://drops-studio.example",
      fetch: async (url) => {
        requested.push(String(url));
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    },
  );

  assert.deepEqual(requested, [
    "https://drops-studio.example/brand/dropstab-mark.svg",
    "https://drops-studio.example/assets/market-wolf-catcher.png",
  ]);
  assert.deepEqual(
    assets.map((asset) => asset.path),
    ["brand/dropstab-mark.svg", "assets/market-wolf-catcher.png"],
  );
  assert.deepEqual([...assets[0].content], [1, 2, 3]);
});

test("bounds every runtime asset fetch with an independent timeout signal", async () => {
  const {
    loadWorkspaceRuntimeAssets,
    WorkspaceSandboxProviderError,
  } = api();
  const requests = [];

  await assert.rejects(
    loadWorkspaceRuntimeAssets(
      [
        {
          path: "index.html",
          content:
            '<img src="/brand/dropstab-mark.svg"><img src="/assets/market-wolf-catcher.png">',
        },
      ],
      {
        origin: "https://drops-studio.example",
        fetchTimeoutMs: 10,
        fetch: async (url, init) => {
          requests.push({ url: String(url), init });
          return new Promise((resolve, reject) => {
            const guard = setTimeout(
              () => reject(new Error("fetch timeout signal did not abort")),
              250,
            );
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(guard);
                reject(init.signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    ),
    (error) =>
      error instanceof WorkspaceSandboxProviderError
      && /timed out/i.test(error.message),
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.cache, "no-store");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.ok(requests[1].init.signal instanceof AbortSignal);
  assert.notEqual(requests[0].init.signal, requests[1].init.signal);
});

test("redacts a complete output stream when provider logs contain a secret", async () => {
  const { runWorkspaceSandbox } = api();
  const secret = "Bearer abcdefghijklmnopqrstuvwxyz123456";
  const receipt = await runWorkspaceSandbox(
    { workspace: workspace(), taskId: "test" },
    {
      provider: {
        async execute() {
          return {
            provider: "vercel-sandbox",
            isolation: "firecracker-microvm",
            providerRunId: "sbx-real-123:session-real-456",
            exitCode: 1,
            stdout: `provider said ${secret}`,
            stderr: `retry with ${secret}`,
            startedAt: "2026-07-30T12:00:00.000Z",
            finishedAt: "2026-07-30T12:00:01.250Z",
            previewUrl: null,
          };
        },
      },
    },
  );

  assert.equal(receipt.stdout, "[redacted secret material]");
  assert.equal(receipt.stderr, "[redacted secret material]");
  assert.doesNotMatch(JSON.stringify(receipt), /abcdefghijklmnopqrstuvwxyz/);
});

test("uses a null exit code only for a verified live detached preview", async () => {
  const {
    runWorkspaceSandbox,
    WorkspaceSandboxProviderError,
  } = api();
  const live = await runWorkspaceSandbox(
    { workspace: workspace(), taskId: "test" },
    {
      provider: {
        async execute() {
          return {
            provider: "vercel-sandbox",
            isolation: "firecracker-microvm",
            providerRunId: "sbx-live-123:session-live-456:cmd-live-789",
            exitCode: null,
            stdout: "Preview process is ready\n",
            stderr: "",
            startedAt: "2026-07-30T12:00:00.000Z",
            finishedAt: "2026-07-30T12:00:01.000Z",
            previewUrl: "https://workspace-live.vercel.run",
          };
        },
      },
    },
  );
  assert.equal(live.exitCode, null);
  assert.equal(live.previewUrl, "https://workspace-live.vercel.run/");

  await assert.rejects(
    runWorkspaceSandbox(
      { workspace: workspace(), taskId: "test" },
      {
        provider: {
          async execute() {
            return {
              provider: "vercel-sandbox",
              isolation: "firecracker-microvm",
              providerRunId: "sbx-false-live-123",
              exitCode: null,
              stdout: "",
              stderr: "",
              startedAt: "2026-07-30T12:00:00.000Z",
              finishedAt: "2026-07-30T12:00:01.000Z",
              previewUrl: null,
            };
          },
        },
      },
    ),
    WorkspaceSandboxProviderError,
  );
});

test("marks the provider and terminal state as running for a live preview", async () => {
  const [sandboxSource, dialogSource] = await Promise.all([
    readFile(new URL("../lib/workspace-sandbox.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../components/project-workspace-dialog.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    sandboxSource,
    /exitCode:\s*previewUrl\s*\?\s*null\s*:\s*output\.exitCode/,
  );
  assert.match(dialogSource, /receipt\.exitCode === null/);
  assert.match(dialogSource, /Process running in isolated preview/);
});

test("rejects a generic provider result that has no verified isolation evidence", async () => {
  const { runWorkspaceSandbox, WorkspaceSandboxProviderError } = api();
  await assert.rejects(
    runWorkspaceSandbox(
      { workspace: workspace(), taskId: "test" },
      {
        provider: {
          async execute() {
            return {
              providerRunId: "generic-run-123",
              exitCode: 0,
              stdout: "done",
              stderr: "",
              startedAt: "2026-07-30T12:00:00.000Z",
              finishedAt: "2026-07-30T12:00:01.000Z",
              previewUrl: null,
            };
          },
        },
      },
    ),
    WorkspaceSandboxProviderError,
  );
});

test("rejects unsafe workspace files, dependencies and lifecycle scripts before provider execution", async () => {
  const { runWorkspaceSandbox, WorkspaceSandboxValidationError } = api();
  let calls = 0;
  const provider = {
    async execute() {
      calls += 1;
      throw new Error("provider must not run");
    },
  };

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [{ path: "../escape.mjs", content: "nope" }],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [
            {
              path: "package.json",
              content: JSON.stringify({
                scripts: { postinstall: "node steal.mjs" },
                dependencies: {
                  unsafe: "https://example.com/package.tgz",
                },
              }),
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [
            {
              path: "secret.txt",
              content: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          tasks: [
            {
              id: "test",
              argv: ["npm", "install", "unsafe-package"],
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [
            ...workspace().files,
            {
              path: "package-lock.json",
              content: JSON.stringify({
                packages: {
                  "node_modules/unsafe": {
                    resolved: "https://example.com/unsafe.tgz",
                  },
                },
              }),
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  const packageWithWorkspace = JSON.parse(workspace().files[0].content);
  packageWithWorkspace.workspaces = ["packages/*"];
  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [
            {
              path: "package.json",
              content: JSON.stringify(packageWithWorkspace),
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  packageWithWorkspace.workspaces = ["packages/../api"];
  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          files: [
            {
              path: "package.json",
              content: JSON.stringify(packageWithWorkspace),
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  await assert.rejects(
    runWorkspaceSandbox(
      {
        workspace: workspace({
          tasks: [
            {
              id: "test",
              argv: ["npm", "test"],
              cwd: "nested-package",
            },
          ],
        }),
        taskId: "test",
      },
      { provider },
    ),
    WorkspaceSandboxValidationError,
  );

  assert.equal(calls, 0);
});

test("does not claim a provider or microVM when the provider is unavailable", async () => {
  const {
    runWorkspaceSandbox,
    WorkspaceSandboxUnavailableError,
  } = api();
  const secret = "Bearer abcdefghijklmnopqrstuvwxyz123456";

  await assert.rejects(
    runWorkspaceSandbox(
      { workspace: workspace(), taskId: "test" },
      {
        provider: {
          async execute() {
            throw new WorkspaceSandboxUnavailableError(
              `provider unavailable ${secret}`,
            );
          },
        },
      },
    ),
    (error) => {
      assert.equal(error.name, "WorkspaceSandboxUnavailableError");
      assert.doesNotMatch(error.message, /abcdefghijklmnopqrstuvwxyz/);
      assert.doesNotMatch(error.message, /firecracker|microvm/i);
      return true;
    },
  );
});

test("route rejects cross-origin requests and returns an honest unconfigured 503", async () => {
  assert.ok(routeModule, "workspace sandbox route must exist");

  const crossOrigin = await routeModule.POST(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
      },
      body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
    }),
  );
  assert.equal(crossOrigin.status, 403);

  const missingOriginRequest = new NextRequest("https://drops.example/api/workspace/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
    },
    body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
  });
  const missingOrigin = await routeModule.POST(missingOriginRequest);
  assert.equal(missingOrigin.status, 403);

  const keys = [
    "VERCEL_OIDC_TOKEN",
    "VERCEL_TEAM_ID",
    "VERCEL_PROJECT_ID",
    "VERCEL_TOKEN",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const unavailable = await routeModule.POST(
      new NextRequest("https://drops.example/api/workspace/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://drops.example",
          "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
        },
        body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
      }),
    );
    assert.equal(unavailable.status, 503);
    const payload = await unavailable.json();
    assert.match(payload.error, /not configured|unavailable/i);
    assert.equal("provider" in payload, false);
    assert.equal("isolation" in payload, false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("route grants the bounded sandbox provider its full five-minute execution window", () => {
  assert.ok(routeModule, "workspace sandbox route must exist");
  assert.equal(routeModule.maxDuration, 300);
});

test("route rejects JSON-like media types before touching execution services", async () => {
  assert.ok(routeModule, "workspace sandbox route must exist");
  let touched = false;
  const response = await routeModule.handleWorkspaceRunRequest(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers: {
        "content-type": "application/jsonp",
        origin: "https://drops.example",
        "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
      },
      body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
    }),
    {
      async consumeLimit() { touched = true; return "allowed"; },
      async reserveExecutionQuota() { touched = true; throw new Error("must not run"); },
      async run() { touched = true; throw new Error("must not run"); },
    },
  );

  assert.equal(response.status, 415);
  assert.equal(touched, false);
});

test("route distinguishes oversized and malformed execution bodies without caching", async () => {
  assert.ok(routeModule, "workspace sandbox route must exist");
  const dependencies = {
    async consumeLimit() { return "allowed"; },
    async reserveExecutionQuota() { throw new Error("must not reserve quota"); },
    async run() { throw new Error("must not run"); },
  };
  const headers = {
    "content-type": "application/json",
    origin: "https://drops.example",
    "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
  };

  const oversized = await routeModule.handleWorkspaceRunRequest(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: "x".repeat(1_750_000) }),
    }),
    dependencies,
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await oversized.json(), {
    code: "WORKSPACE_EXECUTION_BODY_TOO_LARGE",
    error: "The bounded workspace execution request exceeds 1.75 MB.",
  });

  const malformed = await routeModule.handleWorkspaceRunRequest(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers,
      body: "{not-json",
    }),
    dependencies,
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await malformed.json(), {
    code: "WORKSPACE_EXECUTION_INVALID_REQUEST",
    error: "A bounded workspace execution request is required.",
  });
});

test("route reserves an independent funded execution allowance before sandbox work", async () => {
  assert.ok(routeModule, "workspace sandbox route must exist");
  const steps = [];
  const response = await routeModule.handleWorkspaceRunRequest(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://drops.example",
        "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
      },
      body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
    }),
    {
      async consumeLimit() { steps.push("rate"); return "allowed"; },
      async reserveExecutionQuota() {
        steps.push("quota");
        return {
          tier: "guest",
          identity: "12345678-1234-1234-1234-123456789abc",
          account: null,
          limit: 3,
          used: 1,
          remaining: 2,
          reset: "daily-utc",
          cookies: [],
        };
      },
      async run() {
        steps.push("sandbox");
        return {
          provider: "vercel-sandbox",
          isolation: "firecracker-microvm",
          providerRunId: "sbx-real-123:session-real-456",
          workspaceId: "workspace-safe-slice",
          workspaceRevision: 3,
          workspaceDigest: "a".repeat(64),
          task: "test",
          argv: ["node", "tests/smoke.mjs"],
          exitCode: 0,
          stdout: "workspace smoke passed\n",
          stderr: "",
          startedAt: "2026-07-30T12:00:00.000Z",
          finishedAt: "2026-07-30T12:00:01.000Z",
          previewUrl: null,
        };
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(steps, ["rate", "quota", "sandbox"]);
  assert.equal(payload.quota.purpose, "execution");
  assert.equal(payload.quota.tier, "guest");
  assert.equal(payload.quota.remaining, 2);
  assert.equal(payload.receipt.provider, "vercel-sandbox");
});

test("route fails closed without running when the execution allowance is exhausted", async () => {
  assert.ok(routeModule, "workspace sandbox route must exist");
  assert.ok(entitlementModule, "workspace execution entitlement module must exist");
  let ran = false;
  const response = await routeModule.handleWorkspaceRunRequest(
    new NextRequest("https://drops.example/api/workspace/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://drops.example",
        "x-drops-session": "01234567-89ab-cdef-0123-456789abcdef",
      },
      body: JSON.stringify({ workspace: workspace(), taskId: "test" }),
    }),
    {
      async consumeLimit() { return "allowed"; },
      async reserveExecutionQuota() {
        throw new entitlementModule.WorkspaceAiQuotaLimitError("guest", 3);
      },
      async run() { ran = true; throw new Error("must not run"); },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 429);
  assert.equal(payload.code, "WORKSPACE_EXECUTION_DAILY_LIMIT");
  assert.equal(payload.limit, 3);
  assert.equal(ran, false);
});
