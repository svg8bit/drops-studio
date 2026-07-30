import { existsSync } from "node:fs"

import { defineConfig } from "@playwright/test"

const LOCAL_TEST_ORIGIN = "http://127.0.0.1:4173"

function configuredTestOrigin() {
  const configured =
    process.env.DROPS_PROOF_BASE_URL?.trim() ||
    process.env.PLAYWRIGHT_BASE_URL?.trim()

  if (!configured) return null

  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    throw new Error(
      "DROPS_PROOF_BASE_URL or PLAYWRIGHT_BASE_URL must be a valid absolute URL."
    )
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      "DROPS_PROOF_BASE_URL or PLAYWRIGHT_BASE_URL must use HTTP or HTTPS."
    )
  }
  if (parsed.username || parsed.password) {
    throw new Error("Playwright base URLs must not contain credentials.")
  }

  return parsed.origin
}

const externalTestOrigin = configuredTestOrigin()
const testOrigin = externalTestOrigin ?? LOCAL_TEST_ORIGIN

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
    "Visual baseline updates require explicit approval: set VISUAL_BASELINE_APPROVED=1 only after the reference has been approved."
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
  testDir: "./e2e",
  outputDir: "outputs/test-results",
  snapshotPathTemplate: executablePath
    ? "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}-system{ext}"
    : "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      scale: "css",
      // The GitHub release gate uses the canonical bundled browser and exact
      // color matching. The optional local system browser gets only a
      // one-channel antialias tolerance while keeping a zero-pixel budget.
      threshold: executablePath ? 0.01 : 0,
    },
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "outputs/playwright-report" }],
    ["junit", { outputFile: "outputs/test-results/results.xml" }],
  ],
  use: {
    baseURL: testOrigin,
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
  ...(externalTestOrigin
    ? {}
    : {
        webServer: {
          command: "npm run serve:test",
          url: LOCAL_TEST_ORIGIN,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }),
})
