import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

import { createProjectArchive } from "../lib/project-export.ts";

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
  score: 96,
  readyToPublish: true,
  launchStatus: "web-ready",
  deliveryMode: "web-native",
  externalSetupRequired: false,
  checkedAt: "2026-07-29T00:00:00.000Z",
  checks: [],
  criticalFailures: [],
};

function project(html, overrides = {}) {
  return {
    id: "portable-game",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    html,
    spec: {
      schemaVersion: 1,
      presetId: "crypto-game",
      slug: "portable-game",
      name: "Portable Game",
      prompt: "Build a game",
      values: {},
      dataEndpoint: "/api/public-data",
      brain: { provider: "free", model: "Free Auto", enhanced: false },
      ...overrides,
    },
  };
}

test("rewrites root-relative game assets for a ZIP hosted below any deployment subpath", () => {
  const source = '<!doctype html><html data-project-kind="crypto-game"><head><style>:root{--game-art:url(\'/assets/market-catcher-retro.png?quality=full\')}</style></head><body><img src="/assets/market-catcher-retro.png"><img srcset="/assets/market-wolf-catcher.png 1x, /assets/market-wolf-catcher.png?scale=2 2x"><img src="https://dropstab.com/images/dropstab-logo-drop-default.svg"><img src="/brand/drops-bot-avatar.jpg">DropsTab Drops Bot<script>window.endpoint="http://localhost:3000/api/public-data";var studioTelegramUrl="/?connections=1&provider=dropsbot&flow=telegram-channel&project=portable-game";</script></body></html>';
  const files = unzipSync(createProjectArchive(project(source, {
    dataEndpoint: "http://127.0.0.1:3000/api/public-data?scope=portable",
    elements: {
      "header.logo": { imageSrc: "/brand/dropstab-mark.svg" },
      "game.sprite": { imageSrc: "/assets/market-wolf-catcher.png" },
    },
  }), quality, archiveAssets));
  const html = strFromU8(files["index.html"]);
  assert.match(html, /src="\.\/assets\/market-catcher-retro\.png"/);
  assert.match(html, /url\('\.\/assets\/market-catcher-retro\.png\?quality=full'\)/);
  assert.match(html, /srcset="\.\/assets\/market-wolf-catcher\.png 1x, \.\/assets\/market-wolf-catcher\.png\?scale=2 2x"/);
  assert.doesNotMatch(html, /(?:^|[\s"'(=,:])\/(?:assets|brand)\//im);
  assert.match(html, /src="\.\/brand\/dropstab-mark\.svg"/);
  assert.match(html, /src="\.\/brand\/drops-bot-avatar\.jpg"/);
  assert.doesNotMatch(html, /https?:\/\/dropstab\.com\/images\/dropstab-logo-drop-default\.svg/i);
  assert.doesNotMatch(html, /https?:\/\/(?:localhost|127\.0\.0\.1)/i);
  assert.match(html, /var studioTelegramUrl="https:\/\/drops-studio\.vercel\.app\/\?connections=1&provider=dropsbot&flow=telegram-channel&project=portable-game"/);
  assert.ok(files["brand/dropstab-mark.svg"]);
  assert.ok(files["brand/drops-bot-avatar.jpg"]);
  assert.deepEqual(files["brand/dropstab-mark.svg"], archiveAssets.brand.dropstabMarkSvg);
  assert.deepEqual(files["brand/drops-bot-avatar.jpg"], archiveAssets.brand.dropsBotAvatarJpeg);
  assert.deepEqual(files["assets/market-catcher-retro.png"], archiveAssets.game.marketCatcherBackgroundPng);
  assert.deepEqual(files["assets/market-wolf-catcher.png"], archiveAssets.game.marketWolfSpritePng);
  const spec = JSON.parse(strFromU8(files["project.json"]));
  const manifest = JSON.parse(strFromU8(files["drops.config.json"]));
  assert.equal(spec.dataEndpoint, "./api/public-data?scope=portable");
  assert.equal(spec.elements["header.logo"].imageSrc, "./brand/dropstab-mark.svg");
  assert.equal(spec.elements["game.sprite"].imageSrc, "./assets/market-wolf-catcher.png");
  assert.equal(manifest.data.endpoint, "./api/public-data?scope=portable");
});

test("the extracted source archive passes its own offline smoke test", async () => {
  const source = '<!doctype html><html data-project-kind="crypto-game"><body><img src="/assets/market-catcher-retro.png"><img src="/assets/market-wolf-catcher.png"><img src="https://dropstab.com/images/dropstab-logo-drop-default.svg"><img src="/brand/drops-bot-avatar.jpg">DropsTab Drops Bot</body></html>';
  const files = unzipSync(createProjectArchive(project(source), quality, archiveAssets));
  const directory = await mkdtemp(join(tmpdir(), "drops-studio-export-"));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const destination = join(directory, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const result = spawnSync(process.execPath, [join(directory, "tests/smoke.mjs")], {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /smoke checks passed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Portfolio Tamagotchi keeps its local raster companion in the portable archive", () => {
  const source = '<!doctype html><html data-project-kind="portfolio-tamagotchi"><body><img class="tama-creature" src="/assets/market-wolf-catcher.png" alt="Market Wolf portfolio companion">DropsTab Drops Bot</body></html>';
  const files = unzipSync(createProjectArchive(project(source, {
    presetId: "portfolio-tamagotchi",
    slug: "portable-tamagotchi",
    name: "Portable Tamagotchi",
  }), quality, archiveAssets));
  const html = strFromU8(files["index.html"]);

  assert.match(html, /src="\.\/assets\/market-wolf-catcher\.png"/);
  assert.doesNotMatch(html, /<svg\b|data:image/i);
  assert.deepEqual(files["assets/market-wolf-catcher.png"], archiveAssets.game.marketWolfSpritePng);
  assert.equal(files["assets/market-catcher-retro.png"], undefined);
});

test("the extracted index renders every bundled visual asset with the browser offline", async () => {
  const source = '<!doctype html><html data-project-kind="crypto-game"><body><main><img data-asset="game" src="/assets/market-catcher-retro.png"><img data-asset="sprite" src="/assets/market-wolf-catcher.png"><img data-asset="dropstab" src="https://dropstab.com/images/dropstab-logo-drop-default.svg"><img data-asset="dropsbot" src="/brand/drops-bot-avatar.jpg"><p>DropsTab Drops Bot</p></main></body></html>';
  const files = unzipSync(createProjectArchive(project(source), quality, archiveAssets));
  const configuredChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/snap/bin/chromium";
  const browserUsesSnap = configuredChromium.startsWith("/snap/") && existsSync(configuredChromium);
  const extractionRoot = browserUsesSnap ? join(homedir(), "Downloads") : tmpdir();
  await mkdir(extractionRoot, { recursive: true });
  const directory = await mkdtemp(join(extractionRoot, "drops-studio-offline-"));
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(configuredChromium) ? { executablePath: configuredChromium } : {}),
  });
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const destination = join(directory, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const context = await browser.newContext();
    await context.setOffline(true);
    const page = await context.newPage();
    const networkDependencies = [];
    page.on("request", (request) => {
      if (/^https?:/i.test(request.url())) networkDependencies.push(request.url());
    });
    await page.goto(pathToFileURL(join(directory, "index.html")).href, { waitUntil: "load" });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    const images = await page.locator("img[data-asset]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute("data-asset"),
        source: node.getAttribute("src"),
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    );
    assert.equal(images.length, 4);
    assert.ok(images.every((image) => image.source?.startsWith("./")), JSON.stringify(images));
    assert.ok(images.every((image) => image.width > 0 && image.height > 0), JSON.stringify(images));
    assert.deepEqual(networkDependencies, []);
    await context.close();
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("export fails clearly instead of producing a broken archive when local assets are missing", () => {
  const source = '<!doctype html><html data-project-kind="crypto-game"><body><img src="/assets/market-catcher-retro.png">DropsTab Drops Bot</body></html>';
  assert.throws(
    () => createProjectArchive(project(source), quality, {
      brand: archiveAssets.brand,
    }),
    /missing required local asset "assets\/market-catcher-retro\.png"/,
  );
  assert.throws(
    () => createProjectArchive(project(source), quality, {
      brand: {
        dropstabMarkSvg: new Uint8Array(),
        dropsBotAvatarJpeg: archiveAssets.brand.dropsBotAvatarJpeg,
      },
      game: archiveAssets.game,
    }),
    /missing required local asset "brand\/dropstab-mark\.svg"/,
  );
});

test("export rejects session-only blob dependencies", () => {
  const source = '<!doctype html><html data-project-kind="crypto-game"><body><img src="blob:https://drops.studio/session-art">DropsTab Drops Bot</body></html>';
  assert.throws(
    () => createProjectArchive(project(source), quality, archiveAssets),
    /session-only blob URL/,
  );
});

test("export rejects handcrafted inline SVG artwork", () => {
  for (const source of [
    '<!doctype html><html data-project-kind="portfolio-tamagotchi"><body><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" /></svg>DropsTab Drops Bot</body></html>',
    '<!doctype html><html data-project-kind="portfolio-tamagotchi"><body style="background-image:url(data:image/svg+xml,%3Csvg%3E%3C/svg%3E)">DropsTab Drops Bot</body></html>',
  ]) {
    assert.throws(
      () => createProjectArchive(project(source, { presetId: "portfolio-tamagotchi" }), quality, archiveAssets),
      /handcrafted inline SVG artwork/i,
    );
  }
});

test("archive creation rejects a secret from project prompt or any generated file", () => {
  const unsafe = project('<html data-project-kind="crypto-game"><body>DropsTab Drops Bot</body></html>', {
    prompt: "Use 123456789:AAE9Qqkx4JmU3Rr6Tt8Vv0Xx2Zz4Bb6Cc8",
  });
  assert.throws(() => createProjectArchive(unsafe, quality, archiveAssets), /secret/i);
});

function responseRecorder() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 200,
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
}

test("an extracted Product Hunt API fails honestly when its owner has not connected Vercel Blob", async () => {
  const hunt = project(
    '<!doctype html><html data-project-kind="crypto-product-hunt"><body>DropsTab Drops Bot</body></html>',
    {
      presetId: "crypto-product-hunt",
      slug: "portable-community-board",
      name: "Portable Community Board",
    },
  );
  const files = unzipSync(createProjectArchive(hunt, quality, archiveAssets));
  const directory = await mkdtemp(join(tmpdir(), "drops-studio-hunt-export-"));
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const destination = join(directory, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const launchesModule = await import(`${pathToFileURL(join(directory, "api/product-hunt/launches.mjs")).href}?test=${Date.now()}`);
    const voteModule = await import(`${pathToFileURL(join(directory, "api/product-hunt/launches/[id]/vote.mjs")).href}?test=${Date.now()}`);

    const listResponse = responseRecorder();
    await launchesModule.default({ method: "GET", url: "/api/product-hunt/launches?sort=top", headers: {} }, listResponse);
    assert.equal(listResponse.statusCode, 503);
    assert.match(listResponse.body.error, /add BLOB_READ_WRITE_TOKEN in Vercel/i);
    assert.deepEqual(listResponse.body.providerEvidence, {
      storage: "unavailable",
      persistence: false,
      localFallback: "private browser drafts only",
    });
    assert.equal(listResponse.headers.get("cache-control"), "no-store");

    const voteResponse = responseRecorder();
    await voteModule.default({
      method: "POST",
      url: "/api/product-hunt/launches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/vote",
      query: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      headers: {},
    }, voteResponse);
    assert.equal(voteResponse.statusCode, 503);
    assert.match(voteResponse.body.error, /community backend is not configured/i);
  } finally {
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    await rm(directory, { recursive: true, force: true });
  }
});
