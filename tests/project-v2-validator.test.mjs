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

const { validateProjectV2 } = await import("../lib/project-v2-validator.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");

function spec() {
  return createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a sourced crypto market explorer",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

test("accepts a strict secret-free Project V2 envelope", async () => {
  const project = await materializeProjectV2Template({
    id: "project-validator",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  assert.equal((await validateProjectV2(project)).schemaVersion, 2);
});

test("rejects unknown fields, environment values, symlinks and stale hashes", async () => {
  const project = await materializeProjectV2Template({
    id: "project-validator-reject",
    spec: spec(),
    now: "2026-07-30T12:00:00.000Z",
  });
  await assert.rejects(() => validateProjectV2({ ...project, unexpected: true }), /Unrecognized key/i);
  await assert.rejects(
    () =>
      validateProjectV2({
        ...project,
        environment: [
          {
            name: "DROPSTAB_API_KEY",
            description: "Server-side provider key",
            required: false,
            secret: true,
            scope: "runtime",
            value: "must-not-be-stored",
          },
        ],
      }),
    /Unrecognized key/i,
  );
  const page = project.files["app/page.tsx"];
  await assert.rejects(
    () =>
      validateProjectV2({
        ...project,
        files: {
          ...project.files,
          "app/page.tsx": { ...page, kind: "symlink", target: "/etc/passwd" },
        },
      }),
    /Invalid input|kind/i,
  );
  await assert.rejects(
    () =>
      validateProjectV2({
        ...project,
        files: {
          ...project.files,
          "app/page.tsx": { ...page, content: `${page.content}\n// changed` },
        },
      }),
    /hash/i,
  );
});
