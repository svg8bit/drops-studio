import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const presetIds = [
  "action-engine",
  "alpha-channel",
  "morning-alpha",
  "prediction-impact",
  "smart-money-copy",
  "crypto-aggregator",
  "crypto-game",
  "personal-companion",
  "portfolio-tamagotchi",
  "crypto-product-hunt",
  "crypto-radio",
  "crypto-siri",
];

test("the compiler contains a distinct runnable product for every preset", async () => {
  const [compiler, presets] = await Promise.all([
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/presets.ts", import.meta.url), "utf8"),
  ]);

  for (const id of presetIds) {
    assert.match(presets, new RegExp(`id: "${id}"`));
    assert.match(compiler, new RegExp(`"${id}":render`));
  }
  assert.match(compiler, /data-project-kind=/);
  assert.match(compiler, /Run decision engine/);
  assert.match(compiler, /Generate sourced post/);
  assert.match(compiler, /Refresh live brief/);
  assert.match(compiler, /Run paper copy/);
  assert.match(compiler, /play-round/);
  assert.match(compiler, /data-care="feed"/);
  assert.match(compiler, /data-vote/);
  assert.match(compiler, /speechSynthesis/);
  assert.match(compiler, /SpeechRecognition/);
  assert.doesNotMatch(compiler, /\beval\s*\(/);
  assert.doesNotMatch(compiler, /new Function/);
});

test("publishing recompiles validated specs and source export includes real hosting files", async () => {
  const [publishRoute, publicRoute, studio, migration, hosting, persistence, vercel, pkg] = await Promise.all([
    readFile(new URL("../app/api/projects/publish/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/p/[slug]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_pretty_shape.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/projects.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(publishRoute, /validateProjectSpec/);
  assert.match(publishRoute, /compileProject/);
  assert.match(publicRoute, /text\/html; charset=utf-8/);
  assert.match(publicRoute, /content-security-policy/);
  assert.match(studio, /"index\.html"/);
  assert.match(studio, /"project\.json"/);
  assert.match(studio, /"vercel\.json"/);
  assert.match(studio, /"netlify\.toml"/);
  assert.match(studio, /"wrangler\.toml"/);
  assert.match(studio, /pages\.yml/);
  assert.match(studio, /migrated\.publishedAt !== migrated\.updatedAt/);
  assert.match(studio, /publishedAt, updatedAt: publishedAt/);
  assert.match(migration, /CREATE TABLE `published_projects`/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(persistence, /process\.env\.BLOB_READ_WRITE_TOKEN/);
  assert.match(persistence, /await import\("@vercel\/blob"\)/);
  assert.match(persistence, /presetIds\.has\(record\.presetId\)/);
  assert.match(persistence, /await put\(blobPath\(project\.slug\)/);
  assert.match(persistence, /await get\(blobPath\(slug\)/);
  assert.match(persistence, /try \{\s+parsed = JSON\.parse\(text\)/);
  assert.match(persistence, /catch \{\s+return null/);
  assert.equal(JSON.parse(vercel).buildCommand, "npm run build:vercel");
  assert.equal(JSON.parse(pkg).dependencies["@vercel/blob"], "^2.6.1");
});

test("professional editing and category direction apply to every product", async () => {
  const [types, validator, director, compiler, studio] = await Promise.all([
    readFile(new URL("../lib/project-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-validator.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-director.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(types, /interface ProjectExperienceDirection/);
  assert.match(types, /assetSource: "free-vector" \| "uploaded" \| "ai-generated"/);
  assert.match(types, /backgroundImage\?: string/);
  assert.match(validator, /function backgroundImage\(value: unknown\)/);
  assert.match(validator, /base64,\[a-z0-9\+\/\]\+\=\{0,2\}\$\/i/);
  assert.match(validator, /parsed\.protocol !== "https:" \|\| parsed\.username \|\| parsed\.password/);
  for (const id of presetIds) assert.match(validator, new RegExp(`"${id}": \\{ archetype:`));
  assert.match(director, /draft\.experience\.layout = "dashboard"/);
  assert.match(director, /draft\.experience\.dataView = "table"/);
  assert.match(compiler, /data-experience-layout=/);
  assert.match(compiler, /data-studio-block=/);
  assert.match(compiler, /module-strip/);
  assert.match(compiler, /data-has-art=/);
  assert.match(compiler, /url\(\$\{safeJson\(customExperienceArt\)\}\)/);
  assert.match(compiler, /const runtimeSpec = \{/);
  assert.match(compiler, /experience: \{ \.\.\.spec\.experience, backgroundImage: undefined \}/);
  assert.match(compiler, /state\.lastResult/);
  assert.match(compiler, /COIN QUEST/);
  assert.match(compiler, /Daily league/);
  assert.match(studio, /Professional experience/);
  assert.match(studio, /Product modules/);
  assert.match(studio, /Add product hero artwork/);
  assert.match(studio, /candidate\.size <= 240_000/);
  assert.match(studio, /gameDirection, backgroundImage: undefined/);
  assert.match(studio, /categoryPrompts/);
  assert.match(studio, /Apply changes/);
  assert.match(studio, /Reordered product modules/);
  assert.doesNotMatch(studio, /\{game && <label className="art-upload"/);
});
