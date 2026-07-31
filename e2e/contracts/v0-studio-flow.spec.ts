import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

test("Build opens the unified Director workspace with a working radio preview and safe Connections return", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  const assertCleanRuntime = installRuntimeGuards(page)

  await page.route("**/api/account", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          provider: "google",
          name: "Studio Maker",
          email: "maker@example.test",
        },
        connections: [],
      }),
    })
  })

  await prepareHomePage(page)
  await page.locator('[data-preset="crypto-radio"]').click()
  await page.getByRole("button", { name: "Build now", exact: true }).click()

  await page.waitForURL(/\/studio\/[a-f0-9-]+\?panel=director&autobuild=1$/i)
  await expect(page.locator(".project-studio-layout")).toHaveClass(/tab-director/)
  await expect(page.getByText("Drops Director", { exact: true })).toBeVisible()
  await expect(page.getByText("Studio Maker", { exact: true })).toBeVisible()
  await expect(page.locator(".conversation article.user")).toContainText(
    "Build Crypto Radio",
  )
  await expect(page.locator(".conversation article.assistant").first()).toContainText(
    "isolated build",
  )

  const runtime = page.frameLocator("iframe[title$='live application']")
  await expect(runtime.locator('[data-project-kind="crypto-radio"]')).toBeVisible()
  await expect(runtime.getByText("Your browser rundown is ready", { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath("v0-studio-flow.png"),
    fullPage: true,
  })

  await page.getByRole("button", { name: "Connections", exact: true }).click()
  await page.getByRole("button", { name: /AI models/ }).click()
  await expect(page).toHaveURL(/\/\?connections=1&returnTo=/)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Connections Hub", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close connections" }).click()
  await expect(page).toHaveURL(/\/studio\/[a-f0-9-]+\?panel=director&autobuild=1$/i)
  await expect(page.getByText("Drops Director", { exact: true })).toBeVisible()

  await assertCleanRuntime()
})
