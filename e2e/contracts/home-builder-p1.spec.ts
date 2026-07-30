import type { Page } from "@playwright/test"

import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

async function revealPreview(page: Page) {
  await expect
    .poll(async () => {
      try {
        const preview = page.locator(".preview-column").last()
        await preview.scrollIntoViewIfNeeded()
        return await preview.isVisible()
      } catch {
        return false
      }
    }, { message: "preview settles after the selected preset rerenders" })
    .toBe(true)
  await expect(page.locator(".telegram-card")).toBeVisible()
}

test("home builder keeps sample previews honest, coherent and responsive", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareHomePage(page)

  const buildNow = page.getByRole("button", { name: "Build now", exact: true })
  await expect(buildNow).toBeVisible()
  await expect(buildNow).toHaveCSS("white-space", "nowrap")

  const primaryBrandAssets = page.locator(
    ".studio-header .drops-brand-marks img:visible"
  )
  await expect(primaryBrandAssets).toHaveCount(2)
  await expect(
    page.locator(".studio-header .drops-brand-partners img")
  ).toHaveCount(2)

  await revealPreview(page)
  const morningPreview = page.locator(".preview-column").last()
  const morningCard = morningPreview.locator(".telegram-card")
  await expect(morningPreview.locator(".data-mode")).toHaveText("Sample data")
  await expect(morningCard).toContainText("BTC +4.21%")
  await expect(morningCard).toContainText("ARB unlocks in 2 days")
  await expect(morningCard).toContainText("$32.4M")
  await expect(morningCard).toContainText("$18.7M")
  await expect(morningCard).not.toContainText("Not connected")

  const morningScreenshot = testInfo.outputPath("morning-alpha-sample.png")
  await page.screenshot({ path: morningScreenshot, fullPage: false })
  await testInfo.attach("Morning Alpha sample", {
    path: morningScreenshot,
    contentType: "image/png",
  })
  const morningDeviceScreenshot = testInfo.outputPath(
    "morning-alpha-device.png"
  )
  await morningPreview.locator(".preview-device").screenshot({
    path: morningDeviceScreenshot,
  })
  await testInfo.attach("Morning Alpha Telegram device", {
    path: morningDeviceScreenshot,
    contentType: "image/png",
  })

  await page.locator('[data-preset="alpha-channel"]').click()
  await revealPreview(page)
  const alphaPreview = page.locator(".preview-column").last()
  const alphaCard = alphaPreview.locator(".telegram-card")
  await expect(alphaCard).toContainText("SOL signal caught early")
  await expect(alphaCard).toContainText("Solana smart money")
  await expect(alphaCard).toContainText("Solana is +2.31%")
  await expect(alphaCard).not.toContainText("BTC signal caught early")
  await expect(alphaPreview.locator(".data-mode")).toHaveText("Sample data")

  const alphaScreenshot = testInfo.outputPath("alpha-channel-sample.png")
  await page.screenshot({ path: alphaScreenshot, fullPage: false })
  await testInfo.attach("Alpha Channel sample", {
    path: alphaScreenshot,
    contentType: "image/png",
  })
  const alphaDeviceScreenshot = testInfo.outputPath("alpha-channel-device.png")
  await alphaPreview.locator(".preview-device").screenshot({
    path: alphaDeviceScreenshot,
  })
  await testInfo.attach("Alpha Channel Telegram device", {
    path: alphaDeviceScreenshot,
    contentType: "image/png",
  })

  await assertCleanRuntime()
})

test("390px keeps the selected recipe centered and fully visible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-390")

  await prepareHomePage(page)

  const selectedPreset = page.locator(".preset-card.selected")
  await expect(selectedPreset).toHaveCount(1)
  await expect(selectedPreset).toHaveAttribute("aria-pressed", "true")

  async function selectedRecipeGeometry() {
    return page.locator(".preset-carousel").evaluate((carousel) => {
      const selected = carousel.querySelector<HTMLElement>(
        ".preset-card.selected"
      )
      if (!selected) throw new Error("Selected preset card is missing")

      const carouselRect = carousel.getBoundingClientRect()
      const selectedRect = selected.getBoundingClientRect()
      const visibleLeft = Math.max(0, carouselRect.left)
      const visibleRight = Math.min(window.innerWidth, carouselRect.right)

      return {
        leftOverflow: Math.max(0, visibleLeft - selectedRect.left),
        rightOverflow: Math.max(0, selectedRect.right - visibleRight),
        centerDelta: Math.abs(
          (selectedRect.left + selectedRect.right) / 2 -
            (visibleLeft + visibleRight) / 2
        ),
      }
    })
  }

  await expect
    .poll(async () => {
      const geometry = await selectedRecipeGeometry()
      return geometry.leftOverflow + geometry.rightOverflow
    }, { message: "Selected recipe must be fully visible inside the 390px carousel" })
    .toBeLessThanOrEqual(1)
  await expect
    .poll(async () => (await selectedRecipeGeometry()).centerDelta, {
      message: "Selected recipe must be centered in the 390px carousel",
    })
    .toBeLessThanOrEqual(2)
})

test("home exposes Build now as the visible primary action and Plan as secondary", async ({
  page,
}) => {
  await prepareHomePage(page)

  const prompt = page.locator(".prompt-frame")
  const primaryAction = prompt.locator(".prompt-box > button")
  const planAction = prompt.getByRole("button", { name: "Plan", exact: true })

  await expect(primaryAction).toHaveCount(1)
  await expect(primaryAction).toBeVisible()
  await expect(primaryAction).toHaveAccessibleName("Build now")
  await expect(primaryAction).toContainText("Build now")
  await expect(planAction).toHaveCount(1)
  await expect(planAction).toBeVisible()

  const semantics = await primaryAction.evaluate((button) => ({
    visibleText: (button as HTMLElement).innerText.trim(),
    width: button.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  }))

  expect(
    semantics.visibleText,
    "The primary build control must not rely on an unexplained icon or aria-label"
  ).toBe("Build now")
  expect(semantics.width).toBeGreaterThan(44)
  expect(semantics.height).toBeGreaterThanOrEqual(44)
})
