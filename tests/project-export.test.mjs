import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { createProjectArchive } from "../lib/project-export.ts";

const project = {
  id: "project-1",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  html: '<!doctype html><html data-project-kind="crypto-game"><body>DropsTab · Drops Bot</body></html>',
  spec: {
    presetId: "crypto-game",
    slug: "crypto-game",
    name: "Crypto Game",
    dataEndpoint: "https://example.com/api/public-data",
    brain: { provider: "openrouter", model: "openrouter/free", enhanced: true },
  },
};

const quality = {
  score: 100,
  readyToPublish: true,
  checkedAt: "2026-07-29T00:00:00.000Z",
  checks: [],
  criticalFailures: [],
};

test("creates a runnable, host-ready ZIP with source, safeguards and game assets", () => {
  const archive = createProjectArchive(project, quality, new Uint8Array([137, 80, 78, 71]));
  assert.deepEqual([...archive.slice(0, 4)], [80, 75, 3, 4]);
  const files = unzipSync(archive);
  const names = Object.keys(files).sort();
  for (const expected of [
    ".github/workflows/pages.yml",
    "README.md",
    "api/telegram/verify.mjs",
    "assets/market-catcher-retro.png",
    "drops.config.json",
    "index.html",
    "netlify.toml",
    "project.json",
    "quality-report.json",
    "tests/smoke.mjs",
    "vercel.json",
    "wrangler.toml",
  ]) assert.ok(names.includes(expected), expected);

  const manifest = JSON.parse(strFromU8(files["drops.config.json"]));
  assert.deepEqual(manifest.data, {
    provider: "DropsTab Public API",
    endpoint: "https://example.com/api/public-data",
    polling: false,
    sharedCacheSeconds: 900,
  });
  assert.equal(manifest.actions.automaticExecution, false);
  assert.equal(manifest.ai.keyIncluded, false);
  assert.match(strFromU8(files["api/telegram/verify.mjs"]), /getChatMember/);
  assert.match(strFromU8(files["api/telegram/verify.mjs"]), /sendMessage/);
  assert.match(strFromU8(files["README.md"]), /does not claim that an external Telegram channel/);
  assert.match(strFromU8(files["tests/smoke.mjs"]), /data-project-kind="crypto-game"/);
  assert.doesNotMatch(strFromU8(files["index.html"]), /sk-(?:proj-|ant-|or-v1-)/i);
});
