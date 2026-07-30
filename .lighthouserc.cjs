/* eslint-disable @typescript-eslint/no-require-imports */

const { existsSync } = require("node:fs")

const { chromium } = require("playwright")

const localChromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/snap/bin/chromium"
const chromePath =
  !process.env.CI && existsSync(localChromiumPath)
    ? localChromiumPath
    : chromium.executablePath()

module.exports = {
  ci: {
    collect: {
      url: ["http://127.0.0.1:4274/"],
      startServerCommand: "npm run serve:lighthouse",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 120_000,
      numberOfRuns: 3,
      chromePath,
      settings: {
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage",
        // Measure the throttled browser directly. Lantern simulation varied by
        // hundreds of milliseconds for an already-painted text LCP, while the
        // observed trace consistently paints the hero below one second.
        throttlingMethod: "devtools",
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": [
          "error",
          { minScore: 1, aggregationMethod: "pessimistic" },
        ],
        "categories:performance": [
          "error",
          { minScore: 0.9, aggregationMethod: "pessimistic" },
        ],
        "categories:best-practices": [
          "error",
          { minScore: 0.95, aggregationMethod: "pessimistic" },
        ],
        "categories:seo": [
          "error",
          { minScore: 0.95, aggregationMethod: "pessimistic" },
        ],
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 2500, aggregationMethod: "median" },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: 0.1, aggregationMethod: "pessimistic" },
        ],
        "total-blocking-time": [
          "error",
          { maxNumericValue: 300, aggregationMethod: "pessimistic" },
        ],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "outputs/lighthouse",
    },
  },
}
