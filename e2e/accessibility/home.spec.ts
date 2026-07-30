import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number]

function seriousViolations(violations: AxeViolation[]) {
  return violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical"
  )
}

function formatViolations(violations: AxeViolation[]) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
          .join("\n")}`
    )
    .join("\n\n")
}

async function analyzePage(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze()
  const blocking = seriousViolations(results.violations)

  expect(blocking.length, formatViolations(blocking)).toBe(0)
}

test("home builder has no serious accessibility violations", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareHomePage(page)
  await analyzePage(page)
  await assertCleanRuntime()
})

test("connections dialog has no serious accessibility violations", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareHomePage(page)
  const desktopTrigger = page.locator(".api-vault-button")
  if (await desktopTrigger.isVisible()) {
    await desktopTrigger.click()
  } else {
    await page.getByRole("button", { name: "Toggle menu" }).click()
    await page.getByRole("button", { name: "Connections", exact: true }).click()
  }
  await expect(page.getByRole("dialog")).toBeVisible()
  await analyzePage(page)
  await assertCleanRuntime()
})

test("project studio has no serious accessibility violations", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await analyzePage(page)
  await assertCleanRuntime()
})

test("project studio publish dialog has no serious accessibility violations", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await page.getByRole("button", { name: /Publish/ }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await analyzePage(page)
  await assertCleanRuntime()
})

test("project studio source dialog has no serious accessibility violations", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await page
    .locator(".studio-rail")
    .getByRole("button", { name: "Code", exact: true })
    .click()
  await page.getByRole("button", { name: /index\.html editable/i }).click()
  await expect(
    page.getByRole("dialog", { name: /Owned source workspace/i })
  ).toBeVisible()
  await analyzePage(page)
  await assertCleanRuntime()
})
