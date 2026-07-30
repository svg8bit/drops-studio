import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createProjectArchive, makeArchiveHtmlPortable } from "../lib/project-export.ts";

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

const project = {
  id: "project-1",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  html: '<!doctype html><html data-project-kind="crypto-game"><body><img src="/assets/market-catcher-retro.png" alt="Game world"><img src="/assets/market-wolf-catcher.png" alt="Market Wolf">DropsTab · Drops Bot</body></html>',
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

test("rewrites every Telegram verification URL with quote and whitespace tolerance", () => {
  const portable = makeArchiveHtmlPortable(`
    <script>
      const first = new URL( "/api/telegram/verify" , location.origin ).href;
      const second = new URL('/api/telegram/verify',location.origin).href;
    </script>
  `);

  assert.equal(
    portable.match(/new URL\("\.\/api\/telegram\/verify",location\.href\)/g)?.length,
    2,
  );
  assert.doesNotMatch(portable, /new URL\([^)]*\/api\/telegram\/verify[^)]*location\.origin/);
});

test("creates a runnable, host-ready ZIP with source, safeguards and game assets", () => {
  const archive = createProjectArchive(
    project,
    quality,
    archiveAssets,
  );
  assert.deepEqual([...archive.slice(0, 4)], [80, 75, 3, 4]);
  const files = unzipSync(archive);
  const names = Object.keys(files).sort();
  for (const expected of [
    ".github/workflows/pages.yml",
    "README.md",
    "api/telegram/verify.mjs",
    "assets/market-catcher-retro.png",
    "assets/market-wolf-catcher.png",
    "brand/dropstab-mark.svg",
    "brand/drops-bot-avatar.jpg",
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
    contract: "DropsTab-compatible adapter",
    providerEvidence: "unverified",
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
  assert.match(strFromU8(files["index.html"]), /data-provider-evidence="unverified"/);
  assert.doesNotMatch(strFromU8(files["index.html"]), /sk-(?:proj-|ant-|or-v1-)/i);
  assert.deepEqual(files["brand/dropstab-mark.svg"], archiveAssets.brand.dropstabMarkSvg);
  assert.deepEqual(files["brand/drops-bot-avatar.jpg"], archiveAssets.brand.dropsBotAvatarJpeg);
  assert.deepEqual(files["assets/market-catcher-retro.png"], archiveAssets.game.marketCatcherBackgroundPng);
  assert.deepEqual(files["assets/market-wolf-catcher.png"], archiveAssets.game.marketWolfSpritePng);
});

test("creates a portable Portfolio Tamagotchi ZIP with its real local companion asset", () => {
  const tamagotchi = {
    ...project,
    html: '<!doctype html><html data-project-kind="portfolio-tamagotchi"><body><img class="tama-creature" src="/assets/market-wolf-catcher.png" alt="Market Wolf portfolio companion">DropsTab · Drops Bot</body></html>',
    spec: {
      ...project.spec,
      presetId: "portfolio-tamagotchi",
      slug: "portfolio-tamagotchi",
      name: "Portfolio Tamagotchi",
    },
  };
  const files = unzipSync(createProjectArchive(tamagotchi, quality, archiveAssets));
  const html = strFromU8(files["index.html"]);

  assert.match(html, /src="\.\/assets\/market-wolf-catcher\.png"/);
  assert.doesNotMatch(html, /<svg\b|data:image/i);
  assert.ok(files["assets/market-wolf-catcher.png"]);
  assert.equal(files["assets/market-catcher-retro.png"], undefined);
  assert.deepEqual(files["assets/market-wolf-catcher.png"], archiveAssets.game.marketWolfSpritePng);
  assert.match(strFromU8(files["tests/smoke.mjs"]), /portfolio-tamagotchi/);
});

test("creates a Crypto Product Hunt ZIP with an owner-configured persistent community backend", () => {
  const hunt = {
    ...project,
    html: '<!doctype html><html data-project-kind="crypto-product-hunt"><body>DropsTab · Drops Bot</body></html>',
    spec: {
      ...project.spec,
      presetId: "crypto-product-hunt",
      slug: "community-launch-board",
      name: "Community Launch Board",
    },
  };
  const files = unzipSync(createProjectArchive(hunt, quality, archiveAssets));
  const packageJson = JSON.parse(strFromU8(files["package.json"]));
  const manifest = JSON.parse(strFromU8(files["drops.config.json"]));
  const readme = strFromU8(files["README.md"]);
  const envExample = strFromU8(files[".env.example"]);
  const store = strFromU8(files["server/product-hunt-store.mjs"]);
  const launches = strFromU8(files["api/product-hunt/launches.mjs"]);
  const votes = strFromU8(files["api/product-hunt/launches/[id]/vote.mjs"]);

  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.dependencies["@vercel/blob"], "2.6.1");
  assert.deepEqual(manifest.community, {
    enabled: true,
    provider: "Vercel Blob",
    storagePath: "drops-studio/exports/community-launch-board/product-hunt-state-v1.json",
    endpoints: {
      launches: "./api/product-hunt/launches",
      vote: "./api/product-hunt/launches/:id/vote",
    },
    credentialsIncluded: false,
    unconfiguredStatus: 503,
    fallback: "private browser drafts only",
  });
  assert.match(envExample, /^BLOB_READ_WRITE_TOKEN=$/m);
  assert.match(envExample, /^DROPSTAB_API_KEY=$/m);
  assert.match(readme, /create a Vercel Blob store/i);
  assert.match(readme, /returns HTTP 503/i);
  assert.match(readme, /private browser draft/i);
  assert.match(readme, /never included in the ZIP/i);
  assert.match(store, /@vercel\/blob/);
  assert.match(store, /product-hunt-state-v1\.json/);
  assert.match(store, /ifMatch/);
  assert.match(store, /process\.env\.BLOB_STORE_ID/);
  assert.match(store, /process\.env\.VERCEL_OIDC_TOKEN/);
  assert.match(store, /token \? \{ token: token \} : \{\}/);
  assert.match(store, /BlobPreconditionFailedError/);
  assert.match(store, /code === "CAPACITY" \? 507/);
  assert.match(store, /failure: "internal"/);
  assert.match(store, /Community backend is not configured/);
  assert.match(launches, /storageUnavailable/);
  assert.match(votes, /storageUnavailable/);
  assert.doesNotMatch(`${store}\n${launches}\n${votes}`, /BLOB_READ_WRITE_TOKEN\s*=\s*["'][^"']+/);
  assert.match(strFromU8(files["tests/community-smoke.mjs"]), /api\/product-hunt\/launches\.mjs/);
});
