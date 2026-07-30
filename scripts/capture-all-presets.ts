import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { chromium } from "@playwright/test"

import { compileProject } from "../lib/project-compiler"
import { createProjectSpec } from "../lib/project-factory"
import { presets } from "../lib/presets"

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173"
const outputDirectory = resolve(
  "outputs/release-audit/all-presets/screenshots"
)
const localChromium = "/snap/bin/chromium"

const market = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: "$118,420",
    change: 2.4,
    marketCap: "$2.36T",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: "$3,780",
    change: -1.2,
    marketCap: "$456B",
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: "$198",
    change: 8.6,
    marketCap: "$99B",
  },
  {
    symbol: "DOGE",
    name: "Dogecoin",
    price: "$0.24",
    change: 4.1,
    marketCap: "$35B",
  },
]

const prediction = {
  title: "Bitcoin above $120k this month",
  probability: 64,
  change: 3,
  url: "https://polymarket.com/event/visual-audit",
}

const publicData = {
  coins: market,
  unlocks: [
    {
      symbol: "ARB",
      nextUnlockAt: "2026-08-16T00:00:00.000Z",
      lockedPercent: 42.6,
      marketCap: "$1.8B",
      fdv: "$4.2B",
    },
  ],
  funding: [
    {
      symbol: "JUP",
      stage: "Strategic",
      raised: "$18M",
      announcedAt: "2026-07-28T00:00:00.000Z",
    },
  ],
  activities: [
    {
      symbol: "SOL",
      name: "Solana",
      type: "Ecosystem event",
      status: "UPCOMING",
      startsAt: "2026-08-01T00:00:00.000Z",
      summary: "Sourced ecosystem activity.",
    },
  ],
  events: [prediction],
  source: "Sample market snapshot",
  provider: "fallback",
  capabilities: {
    coins: false,
    unlocks: false,
    funding: false,
    activities: false,
  },
}

mkdirSync(outputDirectory, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  ...(existsSync(localChromium) ? { executablePath: localChromium } : {}),
})

try {
  for (const preset of presets) {
    const values = Object.fromEntries(
      preset.fields.map((field) => [field.id, field.value])
    )
    const baseSpec = createProjectSpec({
      presetId: preset.id,
      values,
      prompt: `${preset.shortTitle} visual audit`,
      tools: preset.tools,
      provider: "free",
      model: "Free Auto",
      market,
      prediction,
      origin: baseUrl,
    })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    })

    try {
      await page.route("**/__compiled-product-audit__", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><body></body></html>",
        })
      )
      await page.route("**/api/public-data", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(publicData),
        })
      )
      await page.goto(`${baseUrl}/__compiled-product-audit__`, {
        waitUntil: "domcontentloaded",
      })
      await page.setContent(
        compileProject({
          ...baseSpec,
          name: preset.shortTitle,
          slug: `audit-${preset.id}`,
        }),
        { waitUntil: "domcontentloaded" }
      )
      await page.locator("#appRoot").waitFor({ state: "visible" })
      await page.waitForTimeout(120)
      await page.screenshot({
        path: resolve(outputDirectory, `${preset.id}.png`),
        fullPage: false,
      })
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

console.log(`Captured ${presets.length} product screenshots in ${outputDirectory}`)
