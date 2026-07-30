import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the release proof publishes and anonymously exercises three native products", async () => {
  const [workflow, playwrightConfig, packageJson] = await Promise.all([
    readFile(
      new URL("../e2e/proofs/published-products.spec.ts", import.meta.url),
      "utf8",
    ).catch(() => ""),
    readFile(new URL("../playwright.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /crypto-game/);
  assert.match(workflow, /crypto-radio/);
  assert.match(workflow, /alpha-channel/);
  assert.match(workflow, /api\/projects\/publish/);
  assert.match(workflow, /browser\.newContext/);
  assert.match(workflow, /PREVIEW · NOT PUBLISHED/);
  assert.match(workflow, /data-action=["']play-catcher["']/);
  assert.match(workflow, /data-action=["']toggle-radio["']/);
  assert.match(workflow, /data-action=["']compose-post["']/);
  assert.match(workflow, /externalRequests/);
  assert.match(workflow, /DROPS_PROOF_BASE_URL/);
  assert.match(workflow, /PLAYWRIGHT_BASE_URL/);
  assert.match(workflow, /page\.route\(\/\^https\?:/);
  assert.match(workflow, /route\.abort\("blockedbyclient"\)/);
  assert.match(workflow, /publishedUrl\.origin\)\.toBe\(EXTERNAL_PROOF_ORIGIN\)/);
  assert.match(workflow, /new Set\(\[PROOF_ORIGIN, publishedUrl\.origin\]\)/);
  assert.match(workflow, /published-products\.json/);

  assert.match(playwrightConfig, /DROPS_PROOF_BASE_URL/);
  assert.match(playwrightConfig, /PLAYWRIGHT_BASE_URL/);
  assert.match(playwrightConfig, /baseURL: testOrigin/);
  assert.match(playwrightConfig, /externalTestOrigin\s*\?\s*\{\}/);
  assert.match(playwrightConfig, /webServer:/);

  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(
    scripts["test:proofs"],
    "npm run build:vercel && playwright test e2e/proofs --project=chromium-1440",
  );
});
