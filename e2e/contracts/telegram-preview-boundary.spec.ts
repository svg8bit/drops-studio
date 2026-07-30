import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

test("Alpha Channel keeps Studio workflow outside the Telegram preview", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  const viewportWidth = page.viewportSize()?.width ?? 0

  await prepareHomePage(page)
  await page.locator('[data-preset="alpha-channel"]').click()

  const previewColumn = page.locator(".preview-column").last()
  const telegramDevice = previewColumn.locator(".preview-device")
  const telegramPost = telegramDevice.locator(".telegram-card")
  const studioWorkflow = previewColumn.locator(".studio-preview-workflow")

  await expect(telegramPost).toBeVisible()
  await expect(telegramPost).toContainText("SOL signal caught early")
  await previewColumn.scrollIntoViewIfNeeded()
  await expect(telegramPost.getByRole("button")).toHaveCount(1)
  await expect(
    telegramPost.getByRole("button", { name: "View research on DropsTab" })
  ).toBeVisible()

  await expect(studioWorkflow).toBeVisible()
  await expect(studioWorkflow).toContainText(
    "These controls are outside the Telegram preview."
  )
  await expect(
    studioWorkflow.getByRole("button", { name: "Connect Telegram" })
  ).toBeVisible()
  await expect(
    studioWorkflow.getByRole("button", { name: "Generate draft" })
  ).toBeVisible()
  await expect(
    studioWorkflow.getByRole("button", { name: "Plan growth loop" })
  ).toBeVisible()

  await expect(
    telegramDevice.getByRole("button", {
      name: /connect channel|connect telegram|generate draft|plan growth loop/i,
    })
  ).toHaveCount(0)
  await expect(
    telegramPost.getByText(
      /connect channel|connect telegram|generate draft|plan growth loop/i
    )
  ).toHaveCount(0)

  const containment = await previewColumn.evaluate((column) => {
    const device = column.querySelector(".preview-device")
    const post = device?.querySelector(".telegram-card")
    const workflow = column.querySelector(".studio-preview-workflow")

    return {
      deviceContainsWorkflow: Boolean(device?.contains(workflow)),
      postContainsWorkflow: Boolean(post?.contains(workflow)),
    }
  })
  expect(containment).toEqual({
    deviceContainsWorkflow: false,
    postContainsWorkflow: false,
  })

  await studioWorkflow.getByRole("button", { name: "Generate draft" }).click()
  await expect(page.getByRole("status")).toContainText(
    "GENERATE DRAFT added to the blueprint. Nothing was executed."
  )

  const deviceScreenshot = testInfo.outputPath(
    `alpha-channel-telegram-device-${viewportWidth}.png`
  )
  await telegramDevice.screenshot({ path: deviceScreenshot })
  await testInfo.attach(`Alpha Channel Telegram device ${viewportWidth}`, {
    path: deviceScreenshot,
    contentType: "image/png",
  })

  const columnScreenshot = testInfo.outputPath(
    `alpha-channel-preview-and-studio-actions-${viewportWidth}.png`
  )
  await previewColumn.screenshot({ path: columnScreenshot })
  await testInfo.attach(
    `Alpha Channel preview and external Studio actions ${viewportWidth}`,
    {
      path: columnScreenshot,
      contentType: "image/png",
    }
  )

  await assertCleanRuntime()
})
