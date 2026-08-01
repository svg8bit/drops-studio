import AxeBuilder from "@axe-core/playwright";

import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  test,
} from "../fixtures/ui-test";

for (const surface of [
  {
    path: "/backend",
    title: "A complete backend surface, with honest runtime evidence.",
    tab: "Webhooks",
    detail: "Signed ingestion, replay protection and event normalization.",
  },
  {
    path: "/enterprise",
    title: "Identity, collaboration and governance without theatre.",
    tab: "Policies",
    detail: "Deterministic precedence for provider, model, retention and action controls.",
  },
] as const) {
  test(`${surface.path} renders real capability evidence and responsive controls`, async ({ page }) => {
    const assertCleanRuntime = installRuntimeGuards(page);
    const response = await page.goto(surface.path, { waitUntil: "domcontentloaded" });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: surface.title })).toBeVisible();
    await expect(page.getByText("Live server capability receipt").or(page.getByText("Tenant-safe reference runtime"))).toBeVisible();
    await expect(page.getByText("Environment:", { exact: false })).toBeVisible();

    await page.getByRole("tab", { name: surface.tab, exact: true }).click();
    await expect(page.getByText(surface.detail, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const shortTargets = await page.locator("a[href], button, [role='tab']").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: (element.textContent ?? "").trim(), width: rect.width, height: rect.height };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
    expect(shortTargets).toEqual([]);
    await assertCleanRuntime();
  });
}

test("managed platform capability API returns status metadata without secret values", async ({ request }) => {
  const response = await request.get("/api/platform/capabilities");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.capabilities).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "managed-backend" }),
    expect.objectContaining({ id: "collaboration" }),
    expect.objectContaining({ id: "enterprise-identity" }),
  ]));
  expect(JSON.stringify(payload)).not.toMatch(/(?:sk-|ghp_|github_pat_|xox[baprs]-|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i);
});

test("managed platform surfaces pass WCAG A/AA checks", { tag: "@desktop-only" }, async ({ page }) => {
  await page.goto("/backend", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Environment:", { exact: false })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  expect(results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target),
  }))).toEqual([]);
});
