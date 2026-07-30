import { existsSync } from "node:fs"

import { defineConfig } from "@playwright/test"

const STORYBOOK_ORIGIN = "http://127.0.0.1:6006"

const baselineUpdateRequested = process.argv.some(
  (argument) =>
    argument === "-u" ||
    argument.startsWith("-u=") ||
    argument === "--update-snapshots" ||
    argument.startsWith("--update-snapshots=")
)

if (
  baselineUpdateRequested &&
  process.env.VISUAL_BASELINE_APPROVED !== "1"
) {
  throw new Error(
    "Storybook visual baseline updates require explicit approval: set VISUAL_BASELINE_APPROVED=1 only after the reference has been approved."
  )
}

const localChromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/snap/bin/chromium"
const executablePath =
  !process.env.CI && existsSync(localChromiumPath)
    ? localChromiumPath
    : undefined

const projects = [
  { name: "chromium-1440", viewport: { width: 1440, height: 900 } },
  { name: "chromium-1024", viewport: { width: 1024, height: 768 } },
  { name: "chromium-390", viewport: { width: 390, height: 844 } },
]

export default defineConfig({
  testDir: "./storybook-e2e",
  outputDir: "outputs/storybook-test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      scale: "css",
      threshold: 0,
    },
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "outputs/storybook-playwright-report",
      },
    ],
    [
      "junit",
      { outputFile: "outputs/storybook-test-results/results.xml" },
    ],
  ],
  use: {
    baseURL: STORYBOOK_ORIGIN,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    deviceScaleFactor: 1,
    contextOptions: {
      reducedMotion: "reduce",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: projects.map((project) => ({
    name: project.name,
    use: { viewport: project.viewport },
  })),
  webServer: {
    command: "npm run serve:storybook:test",
    url: STORYBOOK_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
