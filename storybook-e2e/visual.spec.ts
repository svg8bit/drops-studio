import { existsSync } from "node:fs"

import { expect, test, type Page, type TestInfo } from "@playwright/test"

const stories = [
  "loading-product-plan",
  "action-engine-desktop",
  "alpha-channel-disconnected",
  "morning-alpha-populated",
  "morning-alpha-data-error",
  "prediction-impact-desktop",
  "smart-money-copy-empty",
  "crypto-aggregator-connected",
  "crypto-game-desktop",
  "personal-companion-mobile",
  "portfolio-tamagotchi-empty",
  "crypto-product-hunt-empty",
  "crypto-radio-playing",
  "crypto-siri-mobile",
] as const

function requireApprovedSnapshot(testInfo: TestInfo, name: string) {
  const snapshotPath = testInfo.snapshotPath(name, { kind: "screenshot" })

  if (
    !existsSync(snapshotPath) &&
    process.env.VISUAL_BASELINE_APPROVED !== "1"
  ) {
    throw new Error(
      `Approved Storybook visual baseline is missing: ${snapshotPath}. Do not generate it automatically; obtain explicit approval, then create it with VISUAL_BASELINE_APPROVED=1.`
    )
  }
}

async function settleStory(page: Page) {
  await expect(page.locator("#storybook-root")).toBeVisible()
  await expect(page.locator(".sb-errordisplay")).toBeHidden()
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

test.describe("approved Storybook visual states", () => {
  for (const story of stories) {
    test(story, async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") {
          const location = message.location()
          errors.push(
            `${message.text()}${location.url ? ` @ ${location.url}:${location.lineNumber}:${location.columnNumber}` : ""}`
          )
        }
      })
      page.on("pageerror", (error) => errors.push(error.message))

      await page.goto(
        `/iframe.html?id=product-states-native-previews--${story}&viewMode=story`,
        { waitUntil: "domcontentloaded" }
      )
      await settleStory(page)

      expect(errors, errors.join("\n")).toEqual([])
      requireApprovedSnapshot(testInfo, `${story}.png`)
      await expect(page).toHaveScreenshot(`${story}.png`, {
        fullPage: false,
      })
    })
  }
})
