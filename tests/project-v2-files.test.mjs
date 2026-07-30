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
  applyProjectV2FileOperations,
  ProjectV2RevisionConflictError,
} = await import("../lib/project-v2-files.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

function spec() {
  return createProjectSpec({
    presetId: "crypto-game",
    values: {},
    prompt: "Build a playable market game",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

test("applies write, rename and delete as one CAS revision with provenance", async () => {
  const project = await materializeProjectV2Template({
    id: "project-files",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  const next = await applyProjectV2FileOperations(
    project,
    project.revision,
    [
      {
        type: "write",
        path: "components/ScoreCard.tsx",
        content: "export function ScoreCard(){ return <p>Score</p>; }",
        language: "tsx",
        role: "component",
        provenance: "ai",
      },
      {
        type: "rename",
        from: "lib/product-spec.ts",
        to: "lib/product-config.ts",
        provenance: "manual",
      },
      { type: "delete", path: "tests/smoke.mjs" },
    ],
    { now: () => new Date("2026-07-30T12:01:00.000Z") },
  );
  assert.equal(next.revision, project.revision + 1);
  assert.equal(next.files["components/ScoreCard.tsx"].provenance, "ai");
  assert.equal(next.files["lib/product-config.ts"].provenance, "manual");
  assert.equal(next.files["lib/product-spec.ts"], undefined);
  assert.equal(next.files["tests/smoke.mjs"], undefined);
  assert.notEqual(next.contentHash, project.contentHash);
});

test("rejects stale or unsafe operations without mutating the input", async () => {
  const project = await materializeProjectV2Template({
    id: "project-files-conflict",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  const before = structuredClone(project);
  await assert.rejects(
    () => applyProjectV2FileOperations(project, 0, []),
    ProjectV2RevisionConflictError,
  );
  await assert.rejects(
    () =>
      applyProjectV2FileOperations(project, project.revision, [
        {
          type: "write",
          path: "../../escape.ts",
          content: "export {};",
          language: "typescript",
          role: "source",
          provenance: "ai",
        },
      ]),
    /unsafe|traversal|path/i,
  );
  await assert.rejects(
    () =>
      applyProjectV2FileOperations(project, project.revision, [
        {
          type: "write",
          path: "lib/secret.ts",
          content: 'export const apiKey = "sk-this-is-a-secret-value-that-is-long";',
          language: "typescript",
          role: "source",
          provenance: "ai",
        },
      ]),
    /secret/i,
  );
  assert.deepEqual(project, before);
});
