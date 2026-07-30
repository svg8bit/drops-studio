import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const {
  createProjectV2Archive,
  createProjectV2ArchiveBlob,
  projectV2ArchiveFilename,
} = await import("../lib/project-v2-export.ts");
const { createProjectCheckpointV2 } = await import("../lib/project-checkpoint-v2.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

const exportedAt = "2026-07-30T15:30:00.000Z";

async function projectWithRuntimeEvidence() {
  const spec = createProjectSpec({
    presetId: "alpha-channel",
    values: {},
    prompt: "Build a sourced AI alpha channel",
    tools: ["DropsTab API", "Drops Bot", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const base = await materializeProjectV2Template({
    id: "export-project-private-id",
    spec,
    now: "2026-07-30T12:00:00.000Z",
  });
  const checkpoint = await createProjectCheckpointV2(base, {
    id: "checkpoint-private-id",
    label: "Checkpoint private label",
    source: "system",
    createdAt: "2026-07-30T12:05:00.000Z",
  });
  return {
    ...base,
    runs: [
      {
        id: "run-private-id",
        taskId: "build",
        projectRevision: base.revision,
        status: "succeeded",
        runtime: "vercel-sandbox",
        startedAt: "2026-07-30T12:01:00.000Z",
        finishedAt: "2026-07-30T12:02:00.000Z",
        exitCode: 0,
        logIds: ["log-private-id"],
        auditEventIds: ["audit-private-id"],
      },
    ],
    logs: [
      {
        id: "log-private-id",
        runId: "run-private-id",
        stream: "stdout",
        bytes: 42,
        truncated: false,
        createdAt: "2026-07-30T12:01:30.000Z",
      },
    ],
    checkpoints: [checkpoint],
    preview: {
      status: "ready",
      projectRevision: base.revision,
      sandboxId: "sandbox-private-id",
      url: "https://sandbox-private.example",
      port: 3000,
      startedAt: "2026-07-30T12:01:00.000Z",
    },
    deployment: {
      status: "ready",
      provider: "vercel",
      deploymentId: "deployment-private-id",
      url: "https://deployment-private.example",
      createdAt: "2026-07-30T12:03:00.000Z",
    },
  };
}

function archiveText(files) {
  return Object.entries(files)
    .map(([path, bytes]) => `${path}\n${strFromU8(bytes)}`)
    .join("\n");
}

test("exports the real multi-file app with safe environment and self-host metadata", async () => {
  const project = await projectWithRuntimeEvidence();
  const bytes = await createProjectV2Archive(project, { timestamp: exportedAt });
  const files = unzipSync(bytes);

  for (const path of Object.keys(project.files)) {
    assert.ok(files[path], path);
    assert.equal(strFromU8(files[path]), project.files[path].content, path);
  }
  for (const path of ["package.json", "app/page.tsx", "tests/smoke.mjs", "vercel.json"]) {
    assert.ok(files[path], path);
  }
  assert.equal(files["index.html"], undefined, "the editor shell must not replace the Next.js app");

  const envExample = strFromU8(files[".env.example"]);
  const environmentNames = envExample
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=$/.test(line))
    .map((line) => line.slice(0, -1));
  assert.deepEqual(
    environmentNames,
    project.environment.map((definition) => definition.name).sort(),
  );
  assert.doesNotMatch(envExample, /=.+/);

  const metadata = JSON.parse(strFromU8(files[".drops-studio/export.json"]));
  assert.equal(metadata.projectSchemaVersion, 2);
  assert.equal(metadata.credentialsIncluded, false);
  assert.equal(metadata.exportedAt, exportedAt);
  assert.deepEqual(metadata.environmentVariableNames, environmentNames);
  const instructions = strFromU8(files[".drops-studio/EXPORT.md"]);
  assert.match(instructions, /npm install --ignore-scripts/);
  assert.match(instructions, /npm run build/);
  assert.match(instructions, /Node\.js 24/);
  assert.match(instructions, /Vercel/);

  const serialized = archiveText(files);
  for (const runtimeOnly of [
    project.id,
    "run-private-id",
    "log-private-id",
    "audit-private-id",
    "checkpoint-private-id",
    "Checkpoint private label",
    "sandbox-private-id",
    "deployment-private-id",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(runtimeOnly));
  }
  assert.ok(Object.keys(files).every((path) => !path.startsWith("/") && !path.split("/").includes("..")));
});

test("is deterministic for a fixed timestamp and exposes browser download helpers", async () => {
  const project = await projectWithRuntimeEvidence();
  const first = await createProjectV2Archive(project, { timestamp: exportedAt });
  const second = await createProjectV2Archive(project, { timestamp: exportedAt });
  assert.deepEqual(first, second);
  assert.equal(projectV2ArchiveFilename(project), `${project.manifest.slug}.zip`);

  const blob = await createProjectV2ArchiveBlob(project, { timestamp: exportedAt });
  assert.equal(blob.type, "application/zip");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), first);
});

test("rejects traversal and credential leakage before producing an archive", async () => {
  const project = await projectWithRuntimeEvidence();
  const page = project.files["app/page.tsx"];
  await assert.rejects(
    () =>
      createProjectV2Archive(
        {
          ...project,
          files: {
            ...project.files,
            "../escape.ts": { ...page, path: "../escape.ts" },
          },
        },
        { timestamp: exportedAt },
      ),
    /path|unsafe|traversal/i,
  );

  await assert.rejects(
    () =>
      createProjectV2Archive(
        {
          ...project,
          files: {
            ...project.files,
            "app/page.tsx": {
              ...page,
              content: `${page.content}\nexport const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";`,
            },
          },
        },
        { timestamp: exportedAt },
      ),
    /secret/i,
  );
});
