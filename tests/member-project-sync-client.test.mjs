import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  materializeProjectWorkspace,
  updateWorkspaceFile,
} = await import("../lib/project-workspace.ts");
const {
  materializeMemberProject,
  memberProjectDraft,
} = await import("../lib/member-project-sync-client.ts");

test("member project materialization keeps the runtime compiler behind an async boundary", async () => {
  const source = await readFile(
    new URL("../lib/member-project-sync-client.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /^import\s+\{\s*compileProject\s*\}\s+from/m);
  assert.match(source, /await\s+import\(["']\.\/project-compiler\.ts["']\)/);
});

function record() {
  const spec = createProjectSpec({
    presetId: "morning-alpha",
    values: {},
    prompt: "A concise member brief",
    tools: ["DropsTab market data", "Drops Bot delivery"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "Waiting for a verified prediction market",
      probability: null,
      change: null,
    },
    origin: "https://drops.example",
  });
  return {
    schemaVersion: 1,
    id: "member-project-1",
    revision: 3,
    spec,
    checkpoints: [],
    futureCheckpoints: [
      {
        id: "future-1",
        label: "Redo version",
        createdAt: "2026-07-30T00:30:00.000Z",
        source: "manual",
        spec,
      },
    ],
    conversation: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T01:00:00.000Z",
  };
}

test("member cloud records materialize into runnable browser projects", async () => {
  const project = await materializeMemberProject(record());
  assert.equal(project.id, "member-project-1");
  assert.match(project.html, /^<!doctype html>/i);
  assert.equal(project.spec.presetId, "morning-alpha");
  assert.equal(project.quality?.checks.length > 0, true);
  assert.equal(project.futureCheckpoints?.[0]?.label, "Redo version");
});

test("member project drafts omit compiled artifacts and client-only state", async () => {
  const project = await materializeMemberProject(record());
  project.publishCapability = "must-never-sync";
  const draft = memberProjectDraft(project);
  assert.equal("html" in draft, false);
  assert.equal("quality" in draft, false);
  assert.equal("publishCapability" in draft, false);
  assert.equal(draft.id, project.id);
  assert.equal(draft.futureCheckpoints[0].label, "Redo version");
});

test("member project drafts round-trip canonical workspace source while stripping runtime evidence", async () => {
  const cloudRecord = record();
  const compiled = compileProject(cloudRecord.spec);
  const workspace = materializeProjectWorkspace({
    id: cloudRecord.id,
    spec: cloudRecord.spec,
    html: compiled,
    createdAt: cloudRecord.createdAt,
    updatedAt: cloudRecord.updatedAt,
  });
  cloudRecord.workspace = updateWorkspaceFile(
    cloudRecord.spec,
    workspace,
    "src/app.js",
    `${workspace.files.find((item) => item.path === "src/app.js").content}\nwindow.__sharedSource = "round-trip";`,
  );

  const project = await materializeMemberProject(cloudRecord);
  assert.match(project.html, /__sharedSource = "round-trip"/);
  assert.equal(project.workspace.revision, cloudRecord.workspace.revision);

  project.workspace.receipt = { runId: "run-private-123" };
  project.workspace.terminalOutput = "private sandbox stdout";
  project.workspace.runtime.providerKey = "request-only-provider-key";
  project.runtimeReceipt = { status: "completed" };
  project.terminalOutput = "private task output";
  project.providerKey = "request-only-provider-key";
  const draft = memberProjectDraft(project);
  const serialized = JSON.stringify(draft);

  assert.equal(draft.workspace.revision, cloudRecord.workspace.revision);
  assert.match(
    draft.workspace.files.find((item) => item.path === "src/app.js").content,
    /__sharedSource = "round-trip"/,
  );
  assert.equal("receipt" in draft.workspace, false);
  assert.equal("terminalOutput" in draft.workspace, false);
  assert.equal("providerKey" in draft.workspace.runtime, false);
  assert.equal("runtimeReceipt" in draft, false);
  assert.equal("terminalOutput" in draft, false);
  assert.equal("providerKey" in draft, false);
  assert.doesNotMatch(
    serialized,
    /sandbox stdout|task output|run-private|request-only-provider-key/i,
  );
});

test("member cloud drafts strip browser-owned source checkpoints", async () => {
  const project = await materializeMemberProject(record());
  project.sourceEditedAt = "2026-07-30T10:00:00.000Z";
  project.checkpoints = [
    {
      id: "source-checkpoint",
      label: "Edited runnable index.html",
      createdAt: project.sourceEditedAt,
      source: "manual",
      spec: project.spec,
      runtimeHtml: project.html,
      workspace: { revision: 2, files: [{ path: "src/app.js", content: "private edit" }] },
    },
  ];

  const draft = memberProjectDraft(project);
  assert.equal("sourceEditedAt" in draft, false);
  assert.equal("runtimeHtml" in draft.checkpoints[0], false);
  assert.equal("workspace" in draft.checkpoints[0], false);
  assert.doesNotMatch(JSON.stringify(draft), /<!doctype html>/i);
});

test("member project drafts keep the nearest redo versions when bounding history", async () => {
  const project = await materializeMemberProject(record());
  const nearest = project.futureCheckpoints[0];
  project.futureCheckpoints = Array.from({ length: 13 }, (_, index) => ({
    ...nearest,
    id: `future-${index}`,
    label: `Future ${index}`,
  }));

  const draft = memberProjectDraft(project);
  assert.equal(draft.futureCheckpoints.length, 12);
  assert.equal(draft.futureCheckpoints[0].id, "future-0");
  assert.equal(draft.futureCheckpoints.at(-1).id, "future-11");
});
