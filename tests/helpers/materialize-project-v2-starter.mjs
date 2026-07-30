import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        path.endsWith(".ts") ? path : `${path}.ts`,
        new URL("../../", import.meta.url),
      ).href,
    };
  },
});

const [presetId, outputArgument] = process.argv.slice(2);
if (!presetId || !outputArgument) {
  throw new Error(
    "Usage: node tests/helpers/materialize-project-v2-starter.mjs <preset-id> <absolute-output-directory>",
  );
}
if (!isAbsolute(outputArgument)) {
  throw new Error("The output directory must be absolute.");
}

const outputDirectory = resolve(outputArgument);
const temporaryRoot = resolve(tmpdir());
const temporaryRelativePath = relative(temporaryRoot, outputDirectory);
if (
  temporaryRelativePath === "" ||
  temporaryRelativePath.startsWith("..") ||
  isAbsolute(temporaryRelativePath)
) {
  throw new Error("The output directory must be a dedicated temporary directory.");
}

const { projectPresetIds } = await import("../../lib/presets.ts");
if (!projectPresetIds.includes(presetId)) {
  throw new Error(`Unknown preset: ${presetId}`);
}

const { createProjectSpec } = await import("../../lib/project-factory.ts");
const { materializeProjectV2Template } = await import(
  "../../lib/project-template-materializer.ts"
);

const spec = createProjectSpec({
  presetId,
  values: {},
  prompt: `Build a category-native ${presetId} product`,
  tools: ["DropsTab API", "Drops Bot"],
  provider: "free",
  model: "Free compiler",
  market: [],
  prediction: { title: "No prediction", probability: null, change: null },
  origin: "https://drops-studio.example",
});
const project = await materializeProjectV2Template({
  id: `build-matrix-${presetId}`,
  spec,
  now: "2026-07-30T12:00:00.000Z",
});

for (const file of Object.values(project.files)) {
  const destination = join(outputDirectory, file.path);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, file.content, "utf8");
}

process.stdout.write(
  JSON.stringify({ presetId, files: Object.keys(project.files).length }) + "\n",
);
