import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`, projectRoot).href,
    };
  },
});

const [{ presets }, { createProjectSpec }, { compileProject }, { createProjectArchive }] = await Promise.all([
  import("../lib/presets.ts"),
  import("../lib/project-factory.ts"),
  import("../lib/project-compiler.ts"),
  import("../lib/project-export.ts"),
]);

const archiveAssets = {
  brand: {
    dropstabMarkSvg: new Uint8Array(await readFile(new URL("../public/brand/dropstab-mark.svg", import.meta.url))),
    dropsBotAvatarJpeg: new Uint8Array(await readFile(new URL("../public/brand/drops-bot-avatar.jpg", import.meta.url))),
  },
  game: {
    marketCatcherBackgroundPng: new Uint8Array(await readFile(new URL("../public/assets/market-catcher-retro.png", import.meta.url))),
    marketWolfSpritePng: new Uint8Array(await readFile(new URL("../public/assets/market-wolf-catcher.png", import.meta.url))),
  },
};

const quality = {
  score: 100,
  readyToPublish: true,
  launchStatus: "web-ready",
  deliveryMode: "web-native",
  externalSetupRequired: false,
  checkedAt: "2026-07-30T00:00:00.000Z",
  checks: [],
  criticalFailures: [],
};

test("all 12 compiled presets export with a closed local asset graph", () => {
  const exported = [];
  for (const preset of presets) {
    const spec = createProjectSpec({
      presetId: preset.id,
      values: Object.fromEntries(preset.fields.map((field) => [field.id, field.value])),
      prompt: `Build the ${preset.title} proof product`,
      tools: preset.tools,
      provider: "free",
      model: "Free Auto",
      market: [],
      prediction: { title: "No prediction selected", probability: null, change: null },
      origin: "https://drops-studio.example",
    });
    const project = {
      id: `export-${preset.id}`,
      spec,
      html: compileProject(spec),
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    };
    const files = unzipSync(createProjectArchive(project, quality, archiveAssets));
    const html = strFromU8(files["index.html"]);
    const references = new Set(
      [...html.matchAll(/\.\/((?:assets|brand)\/[a-z0-9._/-]+)/gi)].map((match) => match[1]),
    );
    for (const reference of references) {
      assert.ok(files[reference]?.byteLength, `${preset.id} is missing ${reference}`);
    }
    assert.match(html, new RegExp(`data-project-kind=["']${preset.id}["']`));
    exported.push(preset.id);
  }

  assert.equal(exported.length, 12);
  assert.equal(new Set(exported).size, 12);
});
