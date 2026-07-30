import { NextRequest } from "next/server.js"

import { POST as planProduct } from "../../app/api/agent/plan/route"
import { compileProject } from "../../lib/project-compiler"
import { evaluateProjectQuality } from "../../lib/project-quality"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProjectSpec,
} from "../../lib/project-types"
import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

const RETRO_WOLF_PROMPT =
  "Хочу создать игру Волк как в СССР на данных DropsTab"

async function deterministicFallbackPlan() {
  const mutableEnv = process.env as Record<string, string | undefined>
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    guestSecret: process.env.DROPS_GUEST_COOKIE_SECRET,
    gatewayKey: process.env.AI_GATEWAY_API_KEY,
    oidcToken: process.env.VERCEL_OIDC_TOKEN,
  }

  mutableEnv.NODE_ENV = "production"
  delete mutableEnv.DROPS_GUEST_COOKIE_SECRET
  delete mutableEnv.AI_GATEWAY_API_KEY
  delete mutableEnv.VERCEL_OIDC_TOKEN

  try {
    const response = await planProduct(
      new NextRequest("http://drops-studio.test/api/agent/plan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://drops-studio.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ prompt: RETRO_WOLF_PROMPT }),
      })
    )
    const payload = (await response.json()) as {
      plan?: {
        presetId?: string
        name?: string
        blueprint?: {
          content?: { headline?: string; primaryAction?: string }
          game?: { mechanic?: string; artDirection?: string }
        }
        gameDirection?: {
          genre?: string
          artStyle?: string
          world?: string
          mascot?: string
        }
      }
      tier?: string
      warning?: string
    }

    expect(response.status).toBe(200)
    expect(payload.tier).toBe("fallback")
    expect(payload.plan?.presetId).toBe("crypto-game")
    expect(payload.plan?.name).toBe("Волк ловит рынок")
    expect(payload.plan?.blueprint?.content?.headline).toBe(
      "Волк ловит рынок"
    )
    expect(payload.plan?.blueprint?.content?.primaryAction).toBe("Играть")
    expect(payload.plan?.blueprint?.game?.mechanic).toMatch(/catch|лов|lane/i)
    expect(payload.plan?.blueprint?.game?.artDirection).toMatch(
      /1970|animation|анима/i
    )
    expect(payload.plan?.gameDirection).toMatchObject({
      genre: "catcher",
      artStyle: "retro-cartoon",
      world: "retro-factory",
      mascot: "retro-wolf",
    })

    return payload
  } finally {
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV
    else mutableEnv.NODE_ENV = previous.nodeEnv
    if (previous.guestSecret === undefined)
      delete mutableEnv.DROPS_GUEST_COOKIE_SECRET
    else mutableEnv.DROPS_GUEST_COOKIE_SECRET = previous.guestSecret
    if (previous.gatewayKey === undefined) delete mutableEnv.AI_GATEWAY_API_KEY
    else mutableEnv.AI_GATEWAY_API_KEY = previous.gatewayKey
    if (previous.oidcToken === undefined) delete mutableEnv.VERCEL_OIDC_TOKEN
    else mutableEnv.VERCEL_OIDC_TOKEN = previous.oidcToken
  }
}

async function installDeterministicBuildBoundary(page: import("@playwright/test").Page) {
  let requests = 0

  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON() as {
      provider?: string
      spec?: GeneratedProjectSpec
    }
    expect(body.provider).toBe("free")
    expect(body.spec?.presetId).toBe("crypto-game")
    if (!body.spec) throw new Error("Build request is missing its project spec")

    requests += 1
    const html = compileProject(body.spec)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: body.spec,
        quality: evaluateProjectQuality(body.spec, html),
        run: { status: "compiled", trace: [] },
      }),
    })
  })

  return () => requests
}

test("a Russian free prompt builds and runs the illustrated retro wolf game", async ({
  page,
}) => {
  test.setTimeout(90_000)
  const assertCleanRuntime = installRuntimeGuards(page)
  const planPayload = await deterministicFallbackPlan()
  let planRequests = 0
  const buildRequests = await installDeterministicBuildBoundary(page)

  await page.addInitScript(() => {
    Math.random = () => 0.3
  })

  await page.route("**/api/agent/plan", async (route) => {
    const body = route.request().postDataJSON() as { prompt?: string }
    expect(body.prompt).toBe(RETRO_WOLF_PROMPT)
    planRequests += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planPayload),
    })
  })

  await prepareHomePage(page)
  await page
    .getByLabel("Describe your crypto project")
    .fill(RETRO_WOLF_PROMPT)
  await page.getByRole("button", { name: "Build now", exact: true }).click()

  await page.waitForURL(/\/studio\/[a-f0-9-]+$/i)
  expect(planRequests).toBe(1)
  expect(buildRequests()).toBe(1)

  const storedProjects = await page.evaluate((storageKey) => {
    const stored = window.localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored) : []
  }, PROJECTS_STORAGE_KEY)
  expect(storedProjects).toHaveLength(1)
  expect(storedProjects[0].spec).toMatchObject({
    presetId: "crypto-game",
    prompt: RETRO_WOLF_PROMPT,
    name: "Волк ловит рынок",
    gameDirection: {
      genre: "catcher",
      artStyle: "retro-cartoon",
      world: "retro-factory",
      mascot: "retro-wolf",
    },
  })
  expect(storedProjects[0].html).toContain(
    'src="/assets/market-catcher-retro.png"'
  )
  expect(storedProjects[0].html).toContain(
    'src="/assets/market-wolf-catcher.png"'
  )

  if ((page.viewportSize()?.width ?? 1440) <= 680) {
    await page.locator(".mobile-preview-tab").click()
  } else {
    // New projects open in the Project V2 Files workspace. Select the approved
    // project surface before exercising the deterministic legacy preview.
    await page.getByRole("button", { name: "Project", exact: true }).click()
  }
  const runtime = page.frameLocator("iframe[title$='live application']")
  await expect(runtime.locator(".catcher-runtime")).toBeVisible()
  await expect(runtime.locator(".catcher-copy h2")).toHaveText(
    "Волк ловит рынок"
  )
  await expect(runtime.locator(".catcher-runtime")).toHaveAttribute(
    "data-game-genre",
    "unlock-dodge"
  )
  await expect(runtime.locator(".game-native-runtime")).toHaveCount(0)

  const background = runtime.locator("img.catcher-background")
  const wolfArtwork = runtime.locator(
    ".game-mark img, .catcher-player img"
  )
  await expect(background).toHaveCount(1)
  await expect(wolfArtwork).toHaveCount(2)
  await expect(background).toHaveAttribute("src", /^data:image\/png;base64,/)
  await expect(wolfArtwork.first()).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/
  )
  await expect
    .poll(() =>
      background.evaluate((image) => (image as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(1_000)
  for (let index = 0; index < (await wolfArtwork.count()); index += 1) {
    const image = wolfArtwork.nth(index)
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(1_000)
  }

  await runtime.getByRole("button", { name: "Играть", exact: true }).click()
  await expect(runtime.locator(".drop-object")).toBeVisible()
  await expect(runtime.locator(".catcher-player")).toHaveAttribute(
    "style",
    /37\.5%/
  )

  await runtime.getByRole("button", { name: "Move right" }).click()
  await expect(runtime.locator(".catcher-player")).toHaveAttribute(
    "style",
    /62\.5%/
  )
  await runtime.getByRole("button", { name: "Move left" }).click()
  await expect(runtime.locator(".catcher-player")).toHaveAttribute(
    "style",
    /37\.5%/
  )

  await expect
    .poll(async () => {
      const text = await runtime.locator(".hud-stat strong").first().textContent()
      return Number.parseInt(text ?? "0", 10)
    })
    .toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const text = await runtime.locator("#roundTimer").textContent()
      return Number.parseInt(text ?? "45", 10)
    })
    .toBeLessThan(45)

  await expectNoHorizontalOverflow(page)
  await assertCleanRuntime()
})

test("a failed browser save never opens a missing Project Studio", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  test.setTimeout(60_000)
  const planPayload = await deterministicFallbackPlan()
  const buildRequests = await installDeterministicBuildBoundary(page)

  await page.addInitScript((storageKey) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === storageKey) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError")
      }
      return original.call(this, key, value)
    }
  }, PROJECTS_STORAGE_KEY)
  await page.route("**/api/agent/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planPayload),
    })
  })

  await prepareHomePage(page)
  await page
    .getByLabel("Describe your crypto project")
    .fill(RETRO_WOLF_PROMPT)
  await page.getByRole("button", { name: "Build now", exact: true }).click()

  await expect(page.locator(".toast")).toContainText(
    /could not be saved|storage is unavailable or full/i,
  )
  expect(buildRequests()).toBe(1)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Project not found", { exact: true })).toHaveCount(0)
})
