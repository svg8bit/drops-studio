import { createServer } from "node:http"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, test } from "@playwright/test"
import { strFromU8, unzipSync } from "fflate"

import { compileProject } from "../../lib/project-compiler"
import { createProjectArchive } from "../../lib/project-export"
import { createProjectSpec } from "../../lib/project-factory"
import { presets } from "../../lib/presets"
import { PROJECTS_STORAGE_KEY } from "../../lib/project-types"
import { prepareStudioPage } from "../fixtures/ui-test"

const market = [
  { symbol: "BTC", name: "Bitcoin", price: "$118,420", change: 2.4, marketCap: "$2.36T" },
  { symbol: "ETH", name: "Ethereum", price: "$3,780", change: -1.2, marketCap: "$456B" },
]
const prediction = { title: "Bitcoin above $120k", probability: 64, change: 3 }

function gameSpec() {
  const preset = presets.find((item) => item.id === "crypto-game")
  if (!preset) throw new Error("Crypto Game preset is required")
  const values = Object.fromEntries(preset.fields.map((field) => [field.id, field.value]))
  values.game = "Unlock Dodge"
  const spec = createProjectSpec({
    presetId: "crypto-game",
    values,
    prompt: "Build a playable illustrated market catcher game",
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market,
    prediction,
    origin: "http://127.0.0.1:4173",
  })
  return spec.gameDirection
    ? { ...spec, gameDirection: { ...spec.gameDirection, genre: "unlock-dodge" as const, roundSeconds: 5 } }
    : spec
}

test("publish boundary rejects secrets without echoing them", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  const secret = "123456789:AAE9Qqkx4JmU3Rr6Tt8Vv0Xx2Zz4Bb6Cc8"
  const spec = { ...gameSpec(), prompt: `Use ${secret}` }
  const response = await request.post("/api/projects/publish", { data: { spec } })
  expect(response.status()).toBe(400)
  const text = await response.text()
  expect(text).toMatch(/credential-like material/i)
  expect(text).not.toContain(secret)
})

test("server publish fails closed when category contract is tampered", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  const source = gameSpec()
  const spec = { ...source, experience: { ...source.experience, archetype: "voice-assistant" as const } }
  const response = await request.post("/api/projects/publish", {
    headers: { "x-drops-session": "12345678-1234-1234-1234-123456789abc" },
    data: { spec },
  })
  expect(response.status()).toBe(422)
  const payload = await response.json()
  expect(payload.criticalFailures).toContain("category")
  expect(payload.quality.runtimeSmoke.mode).toBe("server-artifact")
  expect(payload.quality.runtimeSmoke.dataProvider).toBe("unverified")
})

for (const evidence of ["dropstab", "fallback"] as const) {
  test(`browser runtime preserves ${evidence} provider evidence without overstating fallback`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-1440")
    await page.route("**/api/public-data", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: evidence,
          source: evidence === "dropstab" ? "DropsTab API" : "Saved DropsTab-compatible fallback",
          coins: market,
          events: [prediction],
          fetchedAt: "2026-07-29T12:00:00.000Z",
        }),
      })
    })
    await prepareStudioPage(page)
    await expect.poll(async () =>
      page.evaluate((storageKey) => {
        const projects = JSON.parse(localStorage.getItem(storageKey) || "[]")
        const quality = projects[0]?.quality
        return {
          provider: quality?.runtimeSmoke?.dataProvider ?? null,
          providerPassed: quality?.checks?.find((item: { id?: string }) => item.id === "provider-evidence")?.passed ?? null,
          adapterPassed: quality?.checks?.find((item: { id?: string }) => item.id === "data-adapter")?.passed ?? null,
          ready: quality?.readyToPublish ?? null,
        }
      }, PROJECTS_STORAGE_KEY),
    ).toEqual({
      provider: evidence,
      providerPassed: evidence === "dropstab",
      adapterPassed: true,
      ready: true,
    })
  })
}

test("downloaded game ZIP runs with working assets below a deployment subpath", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  const spec = gameSpec()
  const project = {
    id: "archive-subpath-game",
    spec,
    html: compileProject(spec),
    createdAt: spec.createdAt,
    updatedAt: spec.createdAt,
  }
  const quality = {
    score: 96,
    readyToPublish: true,
    launchStatus: "web-ready" as const,
    deliveryMode: "web-native" as const,
    externalSetupRequired: false,
    checkedAt: spec.createdAt,
    checks: [],
    criticalFailures: [],
  }
  const archive = createProjectArchive(
    project,
    quality,
    {
      brand: {
        dropstabMarkSvg: new Uint8Array(
          await readFile(path.join(process.cwd(), "public/brand/dropstab-mark.svg")),
        ),
        dropsBotAvatarJpeg: new Uint8Array(
          await readFile(path.join(process.cwd(), "public/brand/drops-bot-avatar.jpg")),
        ),
      },
      game: {
        marketCatcherBackgroundPng: new Uint8Array(
          await readFile(path.join(process.cwd(), "public/assets/market-catcher-retro.png")),
        ),
        marketWolfSpritePng: new Uint8Array(
          await readFile(path.join(process.cwd(), "public/assets/market-wolf-catcher.png")),
        ),
      },
    },
  )
  const archiveFiles = unzipSync(archive)
  const siteRoot = testInfo.outputPath("portable-site")
  for (const [name, bytes] of Object.entries(archiveFiles)) {
    const normalized = path.posix.normalize(name)
    expect(normalized.startsWith("../") || path.posix.isAbsolute(normalized)).toBe(false)
    const destination = path.join(siteRoot, normalized)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }
  expect(strFromU8(archiveFiles["index.html"])).not.toMatch(/(?:src=|url\()["']?\/assets\//)

  const localRequests: string[] = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1")
    localRequests.push(url.pathname)
    if (!url.pathname.startsWith("/nested/product/")) {
      response.writeHead(404).end("Not found")
      return
    }
    const relative = url.pathname.slice("/nested/product/".length) || "index.html"
    const normalized = path.posix.normalize(relative)
    if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      response.writeHead(403).end("Forbidden")
      return
    }
    try {
      const file = await readFile(path.join(siteRoot, normalized))
      response.setHeader("content-type", normalized.endsWith(".png") ? "image/png" : normalized.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream")
      response.writeHead(200).end(file)
    } catch {
      response.writeHead(404).end("Not found")
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Portable test server did not bind")
    await page.goto(`http://127.0.0.1:${address.port}/nested/product/`, { waitUntil: "domcontentloaded" })
    await expect(page.locator("[data-project-kind='crypto-game']")).toHaveCount(1)
    await expect(page.locator(".catcher-runtime")).toBeVisible()
    for (const selector of [".catcher-background", ".catcher-player img"] as const) {
      await expect.poll(() => page.locator(selector).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    }
    await page.locator("[data-action='play-catcher']").click()
    await expect(page.locator(".drop-object")).toBeVisible()
    expect(localRequests).toContain("/nested/product/assets/market-catcher-retro.png")
    expect(localRequests).toContain("/nested/product/assets/market-wolf-catcher.png")
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
