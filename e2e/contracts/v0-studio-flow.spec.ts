import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

test("Build opens the unified Director workspace with an honest live-preview handoff and safe Connections return", { tag: "@desktop-only" }, async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await page.route("**/api/account", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        profile: {
          provider: "google",
          name: "Studio Maker",
          email: "maker@example.test",
        },
        connections: [],
        vault: { available: true },
      }),
    })
  })
  await page.route("**/api/builder/agent", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "E2E_SANDBOX_SEPARATE_GATE",
        error: "Live Sandbox verification runs in the explicit credentialed gate.",
      }),
    })
  })
  await page.route("**/api/builder/runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        action: "status",
        result: {
          provider: "vercel-sandbox",
          status: "unavailable",
          sandboxName: null,
          sessionId: null,
          vcpus: null,
          memoryMb: null,
          createdAt: null,
          updatedAt: null,
          expiresAt: null,
          activeDurationMs: null,
          previewUrl: null,
          previewCommandId: null,
        },
      }),
    })
  })

  await prepareHomePage(page)
  await page.locator('[data-preset="crypto-radio"]').click()
  await page.getByRole("button", { name: "Build now", exact: true }).click()

  await page.waitForURL(/\/studio\/[a-f0-9-]+\?panel=director&autobuild=1$/i)
  await expect(page.locator(".project-studio-layout")).toHaveClass(/tab-director/)
  await expect(page.getByText("Drops Agent", { exact: true })).toBeVisible()
  await expect(page.getByLabel("AI model")).toHaveValue("free")
  await expect(page.getByText("Studio Maker", { exact: true })).toBeVisible()
  await expect(page.locator(".conversation article.user")).toContainText(
    "Build Crypto Radio",
  )
  await expect(page.locator(".conversation article.assistant").first()).toContainText(
    "isolated build",
  )

  await expect(page.locator("iframe[title$='live application']")).toHaveCount(0)
  await expect(page.getByText("Preparing your live app", { exact: true })).toBeVisible()
  await expect(page.getByText(/same Project V2 files shown in Code/i)).toBeVisible()

  const chat = page.locator(".assistant-panel")
  const initialChatWidth = await chat.evaluate((element) =>
    element.getBoundingClientRect().width
  )
  const splitter = page.getByRole("separator", {
    name: "Resize chat and preview",
  })
  const splitterBox = await splitter.boundingBox()
  expect(splitterBox).not.toBeNull()
  await page.mouse.move(
    splitterBox!.x + splitterBox!.width / 2,
    splitterBox!.y + splitterBox!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    splitterBox!.x + splitterBox!.width / 2 + 120,
    splitterBox!.y + splitterBox!.height / 2
  )
  await page.mouse.up()
  await expect
    .poll(() => chat.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialChatWidth + 70)

  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath("v0-studio-flow.png"),
    fullPage: true,
  })

  const composer = page.locator(".chat-composer textarea")
  await composer.fill("Make the radio feel more premium and compact")
  await page.locator(".chat-composer button").click()
  await expect(page.locator(".conversation article.user").last()).toContainText(
    "more premium and compact"
  )
  await expect(page.locator(".conversation article.assistant").last()).toContainText(
    "Done — I updated"
  )
  await expect(page.locator(".director-proposal")).toHaveCount(0)

  await page.getByRole("button", { name: "Connections", exact: true }).click()
  await page.getByRole("button", { name: /AI models/ }).click()
  await expect(page).toHaveURL(/\/\?connections=1&returnTo=/)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Connections Hub", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close connections" }).click()
  await expect(page).toHaveURL(/\/studio\/[a-f0-9-]+\?panel=director&autobuild=1$/i)
  await expect(page.getByText("Drops Agent", { exact: true })).toBeVisible()

  await assertCleanRuntime()
})
