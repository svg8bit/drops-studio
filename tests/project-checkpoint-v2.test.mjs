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
  createProjectCheckpointV2,
  restoreProjectCheckpointV2,
} = await import("../lib/project-checkpoint-v2.ts");
const { applyProjectV2FileOperations } = await import("../lib/project-v2-files.ts");
const { hashProjectV2CanonicalState } = await import("../lib/project-v2-hash.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

function spec() {
  return createProjectSpec({
    presetId: "alpha-channel",
    values: {},
    prompt: "Build a sourced alpha channel",
    tools: ["DropsTab API", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

test("captures the complete canonical snapshot and restores it as a new revision", async () => {
  const project = await materializeProjectV2Template({
    id: "checkpoint-project",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  const checkpoint = await createProjectCheckpointV2(project, {
    id: "checkpoint-1",
    label: "Initial build",
    source: "system",
    createdAt: "2026-07-30T12:00:30.000Z",
  });
  const changed = await applyProjectV2FileOperations(
    project,
    project.revision,
    [{
      type: "write",
      path: "app/page.tsx",
      content: "export default function Page(){ return <main>Changed</main>; }",
      provenance: "manual",
    }],
  );
  const restored = await restoreProjectCheckpointV2(changed, checkpoint, changed.revision, {
    now: () => new Date("2026-07-30T12:02:00.000Z"),
  });
  assert.equal(restored.files["app/page.tsx"].content, project.files["app/page.tsx"].content);
  assert.equal(restored.revision, changed.revision + 1);
  assert.equal(restored.checkpoints.at(-1).id, checkpoint.id);
  assert.notStrictEqual(restored.files, checkpoint.snapshot.files);
});

test("refuses to copy secret material into a checkpoint", async () => {
  const project = await materializeProjectV2Template({
    id: "checkpoint-secret",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  const unsafe = structuredClone(project);
  unsafe.productSpec.prompt = 'apiKey = "sk-this-is-a-secret-value-that-is-long"';
  unsafe.contentHash = await hashProjectV2CanonicalState(unsafe);
  await assert.rejects(
    () =>
      createProjectCheckpointV2(unsafe, {
        id: "checkpoint-secret-1",
        label: "Unsafe snapshot",
        source: "system",
      }),
    /secret/i,
  );
});
