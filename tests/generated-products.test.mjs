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
  assert.match(compiler, /data-action="run-engine"/);
  assert.match(compiler, /Generate sourced post/);
  assert.match(compiler, /Refresh live brief/);
  assert.match(compiler, /Run paper scenario/);
  assert.match(compiler, /play-catcher/);
  assert.doesNotMatch(compiler, /play-round/);
  assert.match(compiler, /data-action="save-holdings"/);
  assert.match(compiler, /data-vote/);
  assert.match(compiler, /speechSynthesis/);
  assert.match(compiler, /SpeechRecognition/);
  assert.match(compiler, /id="huntName"/);
  assert.doesNotMatch(compiler, /prompt\("Product name"/);
  assert.doesNotMatch(compiler, /\.telegram-workspace \.channel-editor\{display:none\}/);
  assert.doesNotMatch(compiler, /[✦⚡☀📈🔓🚀◎★☆↗‹⋮]/u);
  assert.match(compiler, /class="tg-message-source"><img src="\/brand\/dropstab-mark\.svg" alt="DropsTab source">/);
  assert.match(compiler, /class="tg-avatar"><img src="\/brand\/drops-bot-avatar\.jpg" alt="Drops Bot">/);
  assert.match(compiler, /<img class="tama-creature" src="\/assets\/market-wolf-catcher\.png" alt="Market Wolf portfolio companion"/);
  assert.doesNotMatch(compiler, /<svg\b/i);
  assert.doesNotMatch(compiler, /data:image/i);
  assert.doesNotMatch(compiler, /class="noise"|\.noise\{/);
  assert.match(compiler, /aria-pressed="'\+Boolean\(item\.viewerHasVoted\)\+'"/);
  assert.match(compiler, /data-hunt-vote/);
  assert.match(compiler, /function huntRequest\(action,payload\)/);
  assert.doesNotMatch(compiler, /\beval\s*\(/);
  assert.doesNotMatch(compiler, /new Function/);
});

test("publishing recompiles validated specs and persists recoverable public builds", async () => {
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
  assert.match(publishRoute, /consumeRequestLimit/);
  assert.match(publishRoute, /requestIdentity\(request\)/);
  assert.match(publishRoute, /namespace: "project-publish"/);
  assert.match(publishRoute, /status: 429/);
  assert.match(studio, /"x-drops-session": session/);
  assert.match(publicRoute, /text\/html; charset=utf-8/);
  assert.match(publicRoute, /content-security-policy/);
  assert.match(studio, /migrated\.publishedAt !== migrated\.updatedAt/);
  assert.match(studio, /publishedAt,[\s\S]{0,180}updatedAt:\s*publishedAt/);
  assert.match(studio, /function handleCloudPublish\(\)/);
  assert.match(studio, /onClick=\{handleCloudPublish\}/);
  assert.match(migration, /CREATE TABLE `published_projects`/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(persistence, /process\.env\.BLOB_READ_WRITE_TOKEN/);
  assert.match(persistence, /await import\("@vercel\/blob"\)/);
  assert.match(persistence, /presetIds\.has\(record\.presetId\)/);
  assert.match(persistence, /await put\(blobPath\(publicProject\.slug\)/);
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
  assert.match(director, /wantsBackgroundRemoval/);
  assert.match(director, /quotedCopy \? copy : copy\.replace/);
  assert.match(director, /Math\.max\(-500, x - 24\)/);
  assert.match(director, /Math\.min\(500, y \+ 24\)/);
  assert.match(compiler, /data-experience-layout=/);
  assert.match(compiler, /data-studio-block=/);
  assert.match(compiler, /module-strip/);
  assert.match(compiler, /data-has-art=/);
  assert.match(compiler, /url\(\$\{safeJson\(customExperienceArt\)\}\)/);
  assert.match(compiler, /const runtimeSpec = \{/);
  assert.match(compiler, /experience: \{ \.\.\.spec\.experience, backgroundImage: undefined \}/);
  assert.match(compiler, /state\.lastResult/);
  assert.match(compiler, /data-game-genre/);
  assert.match(compiler, /renderMarketRaceGame/);
  assert.match(compiler, /renderCoinQuizGame/);
  assert.match(compiler, /renderPortfolioBattleGame/);
  assert.match(compiler, /renderUnlockDodgeGame/);
  assert.match(compiler, /LOCAL SCORE/);
  assert.match(studio, /Professional experience/);
  assert.match(studio, /Product modules/);
  assert.match(studio, /Add product hero artwork/);
  assert.match(studio, /candidate\.size <= 240_000/);
  assert.match(studio, /gameDirection, backgroundImage: undefined/);
  assert.match(studio, /categoryPrompts/);
  assert.match(studio, /Apply changes/);
  assert.match(studio, /Reordered product modules/);
  assert.match(studio, /Owned source workspace/);
  assert.match(studio, /Validate & apply/);
  assert.match(studio, /Release checks/);
  assert.doesNotMatch(studio, /\{game && <label className="art-upload"/);
});

test("competitive benchmark and builder promise remain documented", async () => {
  const [home, benchmark, integrations] = await Promise.all([
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/COMPETITIVE-BENCHMARK.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/INTEGRATIONS.md", import.meta.url), "utf8"),
  ]);

  assert.match(home, /Your requested product comes first/);
  assert.match(home, /Build now/);
  assert.match(benchmark, /Replit Agent/);
  assert.match(benchmark, /Lovable/);
  assert.match(benchmark, /Bolt/);
  assert.match(benchmark, /Base44/);
  assert.match(integrations, /warm-runtime cache/);
  assert.match(integrations, /never poll DropsTab/);
});
