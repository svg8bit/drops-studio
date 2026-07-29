import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete Drops Studio builder", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Drops Studio/);
  assert.match(html, /Turn a crypto idea/);
  assert.match(html, /AI Morning Alpha/);
  assert.match(html, /Action Engine/);
  assert.match(html, /Crypto Aggregator/);
  assert.match(html, /Portfolio Tamagotchi/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("starter preview is removed and source contains the required product surfaces", async () => {
  const [page, component, dropstabRoute, dropstabClient, agentRoute, compiler, packageJson, studio] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dropstab/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dropstab-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<DropsStudio \/>/);
  assert.match(component, /providerList/);
  assert.match(component, /AI & API Vault/);
  assert.match(component, /\/api\/agent\/plan/);
  assert.match(component, /OpenRouter/);
  assert.match(agentRoute, /poolside\/laguna-s-2\.1-free/);
  assert.match(agentRoute, /GUEST_DAILY_LIMIT/);
  assert.match(compiler, /renderAlphaNative/);
  assert.match(compiler, /renderGameNative/);
  assert.match(compiler, /dropsbotSetup/);
  assert.match(compiler, /market-catcher-retro\.png/);
  assert.match(component, /sessionStorage/);
  assert.match(component, /Start from a blank canvas/);
  assert.match(component, /PROJECTS_STORAGE_KEY/);
  assert.match(component, /router\.push\(`\/studio\//);
  assert.match(studio, /Publish free now/);
  assert.match(studio, /Download runnable app \+ source/);
  assert.match(studio, /Export & continue/);
  assert.match(dropstabRoute, /fetchDropsTabCoins\(key/);
  assert.match(dropstabClient, /"x-dropstab-api-key": key/);
  assert.match(packageJson, /"name": "drops-studio"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
