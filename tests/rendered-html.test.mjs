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
  const [page, component, dropstabRoute, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dropstab/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<DropsStudio \/>/);
  assert.match(component, /providerList/);
  assert.match(component, /AI & API Vault/);
  assert.match(component, /\/api\/plan/);
  assert.match(component, /sessionStorage/);
  assert.match(component, /Start from a blank canvas/);
  assert.match(component, /drops-studio-projects/);
  assert.match(dropstabRoute, /"x-dropstab-api-key": key/);
  assert.match(packageJson, /"name": "drops-studio-mvp"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
