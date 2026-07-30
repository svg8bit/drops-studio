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
  compileWorkspaceRuntime,
  materializeProjectWorkspace,
  updateWorkspaceFile,
} = await import("../lib/project-workspace.ts");
const {
  commitProjectCheckpoint,
  redoProjectCheckpoint,
  undoProjectCheckpoint,
} = await import("../lib/project-history.ts");

function spec(name) {
  return createProjectSpec({
    presetId: "morning-alpha",
    values: {},
    prompt: name,
    tools: ["DropsTab API", "Drops Bot"],
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
}

function checkpoint(id, name, createdAt) {
  return {
    id,
    label: name,
    createdAt,
    source: "manual",
    spec: spec(name),
  };
}

function project() {
  const baseline = checkpoint(
    "checkpoint-baseline",
    "Working baseline",
    "2026-07-30T00:00:00.000Z",
  );
  const second = checkpoint(
    "checkpoint-second",
    "Second version",
    "2026-07-30T00:01:00.000Z",
  );
  return {
    id: "history-project",
    spec: second.spec,
    html: "<!doctype html><title>Second version</title>",
    createdAt: baseline.createdAt,
    updatedAt: second.createdAt,
    checkpoints: [baseline, second],
    futureCheckpoints: [],
  };
}

test("undo preserves the current version and redo restores it", () => {
  const undone = undoProjectCheckpoint(
    project(),
    "2026-07-30T00:02:00.000Z",
  );
  assert.ok(undone);
  assert.equal(undone.project.spec.name, "Working baseline");
  assert.deepEqual(
    undone.project.futureCheckpoints.map((item) => item.id),
    ["checkpoint-second"],
  );

  const redone = redoProjectCheckpoint(
    undone.project,
    "2026-07-30T00:03:00.000Z",
  );
  assert.ok(redone);
  assert.equal(redone.project.spec.name, "Second version");
  assert.deepEqual(redone.project.futureCheckpoints, []);
  assert.equal(redone.project.checkpoints.at(-1).id, "checkpoint-second");
});

test("undo keeps the complete redo chain until a new edit branches", () => {
  const third = checkpoint(
    "checkpoint-third",
    "Third version",
    "2026-07-30T00:02:00.000Z",
  );
  const withThird = commitProjectCheckpoint(project(), third).project;
  const firstUndo = undoProjectCheckpoint(
    withThird,
    "2026-07-30T00:03:00.000Z",
  );
  const secondUndo = undoProjectCheckpoint(
    firstUndo.project,
    "2026-07-30T00:04:00.000Z",
  );

  assert.deepEqual(
    secondUndo.project.futureCheckpoints.map((item) => item.id),
    ["checkpoint-second", "checkpoint-third"],
  );

  const branch = checkpoint(
    "checkpoint-branch",
    "New visual direction",
    "2026-07-30T00:05:00.000Z",
  );
  const committed = commitProjectCheckpoint(secondUndo.project, branch);
  assert.equal(committed.branched, true);
  assert.equal(committed.replacedFutureCount, 2);
  assert.deepEqual(committed.project.futureCheckpoints, []);
  assert.deepEqual(committed.project.checkpoints.at(-1).branch, {
    fromCheckpointId: "checkpoint-baseline",
    replacedCheckpointCount: 2,
  });
});

test("past and future history stay bounded", () => {
  let current = project();
  for (let index = 0; index < 20; index += 1) {
    current = commitProjectCheckpoint(
      current,
      checkpoint(
        `checkpoint-${index}`,
        `Version ${index}`,
        `2026-07-30T00:${String(index + 2).padStart(2, "0")}:00.000Z`,
      ),
    ).project;
  }
  assert.equal(current.checkpoints.length, 12);

  for (let index = 0; index < 11; index += 1) {
    current = undoProjectCheckpoint(
      current,
      `2026-07-30T01:${String(index).padStart(2, "0")}:00.000Z`,
    ).project;
  }
  assert.equal(current.futureCheckpoints.length, 11);
  assert.equal(
    undoProjectCheckpoint(current, "2026-07-30T02:00:00.000Z"),
    null,
  );
});

test("manual runtime source survives undo and redo without becoming cloud code", () => {
  const initial = project();
  const runtimeHtml = compileProject(initial.spec).replace(
    "</body>",
    '<aside data-source-proof="true">Manual source</aside></body>',
  );
  const sourceCheckpoint = {
    id: "checkpoint-source",
    label: "Edited runnable index.html",
    createdAt: "2026-07-30T03:00:00.000Z",
    source: "manual",
    spec: initial.spec,
    runtimeHtml,
  };
  const edited = commitProjectCheckpoint(initial, sourceCheckpoint).project;
  assert.match(edited.html, /data-source-proof="true"/);
  assert.equal(edited.sourceEditedAt, sourceCheckpoint.createdAt);

  const undone = undoProjectCheckpoint(
    edited,
    "2026-07-30T03:01:00.000Z",
  );
  assert.ok(undone);
  assert.doesNotMatch(undone.project.html, /data-source-proof="true"/);
  assert.equal(undone.project.sourceEditedAt, undefined);

  const redone = redoProjectCheckpoint(
    undone.project,
    "2026-07-30T03:02:00.000Z",
  );
  assert.ok(redone);
  assert.match(redone.project.html, /data-source-proof="true"/);
  assert.equal(redone.project.sourceEditedAt, sourceCheckpoint.createdAt);
});

test("a later spec checkpoint cannot silently erase owned manual source", () => {
  const initial = project();
  const runtimeHtml = compileProject(initial.spec).replace(
    "</body>",
    '<aside data-source-proof="true">Manual source</aside></body>',
  );
  const edited = commitProjectCheckpoint(initial, {
    id: "checkpoint-source",
    label: "Edited runnable index.html",
    createdAt: "2026-07-30T03:00:00.000Z",
    source: "manual",
    spec: initial.spec,
    runtimeHtml,
  }).project;
  const nextSpec = {
    ...edited.spec,
    name: "Renamed after source edit",
  };
  const afterSpecEdit = commitProjectCheckpoint(edited, {
    id: "checkpoint-settings",
    label: "Edited project settings",
    createdAt: "2026-07-30T03:01:00.000Z",
    source: "manual",
    spec: nextSpec,
  }).project;

  assert.match(afterSpecEdit.html, /data-source-proof="true"/);
  assert.match(
    compileWorkspaceRuntime(
      afterSpecEdit.spec,
      afterSpecEdit.checkpoints.at(-1).workspace,
    ),
    /data-source-proof="true"/,
  );
  assert.equal(afterSpecEdit.spec.name, "Renamed after source edit");
  assert.equal(afterSpecEdit.sourceEditedAt, "2026-07-30T03:01:00.000Z");
});

test("multi-file workspace edits survive undo and redo as one revision", () => {
  const initialSpec = spec("Workspace history");
  const initial = {
    id: "workspace-history",
    spec: initialSpec,
    html: compileProject(initialSpec),
    createdAt: "2026-07-30T04:00:00.000Z",
    updatedAt: "2026-07-30T04:00:00.000Z",
    checkpoints: [
      checkpoint(
        "checkpoint-workspace-base",
        "Workspace history",
        "2026-07-30T04:00:00.000Z",
      ),
    ],
    futureCheckpoints: [],
  };
  const baselineWorkspace = materializeProjectWorkspace(initial);
  const app = baselineWorkspace.files.find((file) => file.path === "src/app.js");
  assert.ok(app);
  const workspace = updateWorkspaceFile(
    initial.spec,
    baselineWorkspace,
    "src/app.js",
    `${app.content}\nwindow.__historyWorkspace = true;`,
  );
  const edited = commitProjectCheckpoint(initial, {
    id: "checkpoint-workspace-edit",
    label: "Edited src/app.js",
    createdAt: "2026-07-30T04:01:00.000Z",
    source: "manual",
    spec: initial.spec,
    workspace,
  }).project;

  assert.equal(edited.workspace.revision, 2);
  assert.match(edited.html, /__historyWorkspace = true/);
  assert.equal(edited.html, compileWorkspaceRuntime(initial.spec, workspace));

  const undone = undoProjectCheckpoint(edited, "2026-07-30T04:02:00.000Z");
  assert.ok(undone);
  assert.equal(undone.project.workspace.revision, 1);
  assert.doesNotMatch(undone.project.html, /__historyWorkspace = true/);

  const redone = redoProjectCheckpoint(
    undone.project,
    "2026-07-30T04:03:00.000Z",
  );
  assert.ok(redone);
  assert.equal(redone.project.workspace.revision, 2);
  assert.match(redone.project.html, /__historyWorkspace = true/);
});
