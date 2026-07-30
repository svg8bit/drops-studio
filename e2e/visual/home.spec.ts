import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  requireApprovedSnapshot,
  test,
} from "../fixtures/ui-test"

test("home builder matches the approved reference", async ({ page }, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareHomePage(page)
  requireApprovedSnapshot(testInfo, "home-builder.png")
  await expect(page).toHaveScreenshot("home-builder.png", {
    fullPage: true,
  })
  await assertCleanRuntime()
})

test("project studio matches the approved current-state reference", async ({ page }, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  requireApprovedSnapshot(testInfo, "studio-crypto-game.png")
  await expect(page).toHaveScreenshot("studio-crypto-game.png", {
    fullPage: true,
    // Keep a zero differing-pixel budget while ignoring one-channel Chromium
    // antialias jitter on the rounded active rail border.
    threshold: 0.01,
  })
  await assertCleanRuntime()
})
