import path from "node:path"

import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"

const DESIGN_EVIDENCE_DIR = path.join(process.cwd(), "docs/design")

test("captures the current home implementation at its reference viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-1440",
    "Design evidence is captured once from the canonical Chromium project."
  )
  const assertCleanRuntime = installRuntimeGuards(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareHomePage(page)
  await expect(
    page.locator(".preview-device").getByText("Morning Alpha", { exact: true }).first()
  ).toBeVisible()
  await expect(page.getByText("Preparing category-native preview", { exact: true })).toHaveCount(0)
  await page.screenshot({
    path: path.join(DESIGN_EVIDENCE_DIR, "current-home-actual.png"),
  })
  await assertCleanRuntime()
})

test("captures the current selected-element studio implementation", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-1440",
    "Design evidence is captured once from the canonical Chromium project."
  )
  const assertCleanRuntime = installRuntimeGuards(page)

  await page.setViewportSize({ width: 1280, height: 790 })
  await prepareStudioPage(page)
  await page.locator(".design-mode-control").click()
  await expect(page.getByText("Selecting elements", { exact: true })).toBeVisible()
  await page
    .frameLocator("iframe[title$='live application']")
    .locator(".catcher-copy h2")
    .click()
  await expect(page.getByText(/selected h2/i)).toBeVisible()
  await page.screenshot({
    path: path.join(DESIGN_EVIDENCE_DIR, "current-studio-actual.png"),
  })
  await assertCleanRuntime()
})
