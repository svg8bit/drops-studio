import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  expect,
  test,
  type Browser,
  type FrameLocator,
  type Page,
} from "@playwright/test"

import { createProjectSpec } from "../../lib/project-factory"
import { presets, type PresetId } from "../../lib/presets"
import type {
  GeneratedProjectSpec,
  ProjectMarketCoin,
  ProjectPrediction,
} from "../../lib/project-types"

const LOCAL_PROOF_ORIGIN = "http://127.0.0.1:4173"
function configuredProofOrigin() {
  const configured =
    process.env.DROPS_PROOF_BASE_URL?.trim() ||
    process.env.PLAYWRIGHT_BASE_URL?.trim()

  if (!configured) return null

  const parsed = new URL(configured)
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("The proof base URL must use HTTP or HTTPS.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("The proof base URL must not contain credentials.")
  }

  return parsed.origin
}

const EXTERNAL_PROOF_ORIGIN = configuredProofOrigin()
const PROOF_ORIGIN = EXTERNAL_PROOF_ORIGIN ?? LOCAL_PROOF_ORIGIN
const EVIDENCE_PATH = path.join(
  process.cwd(),
  "outputs/proofs/published-products.json"
)
const SCREENSHOT_NAMES: Record<ProofDefinition["presetId"], string> = {
  "crypto-game": "crypto-game.png",
  "crypto-radio": "crypto-radio.png",
  "alpha-channel": "alpha-channel.png",
}

const market: ProjectMarketCoin[] = [
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
]

const prediction: ProjectPrediction = {
  title: "Bitcoin above $120k this month",
  probability: 64,
  change: 3,
  url: "https://polymarket.com/event/proof-bitcoin-above-120k",
}

type ProofDefinition = {
  presetId: Extract<PresetId, "crypto-game" | "crypto-radio" | "alpha-channel">
  name: string
  prompt: string
  values: Record<string, string>
  nativeSelector: string
  proofLabel: string
}

const proofs: ProofDefinition[] = [
  {
    presetId: "crypto-game",
    name: "Market Wolf Proof Game",
    prompt:
      "Build a playable illustrated Market Wolf catcher game driven by the current DropsTab market snapshot.",
    values: { game: "Unlock Dodge", round: "5 minutes" },
    nativeSelector: ".catcher-runtime",
    proofLabel: "playable game loop started and moved",
  },
  {
    presetId: "crypto-radio",
    name: "Drops Market Radio Proof",
    prompt:
      "Build a browser-native crypto radio rundown from the current DropsTab market snapshot.",
    values: { show: "Market in 5", voice: "Browser speech" },
    nativeSelector: "[data-action='toggle-radio']",
    proofLabel: "browser audio rundown entered playing state",
  },
  {
    presetId: "alpha-channel",
    name: "Alpha Channel Setup Proof",
    prompt:
      "Build a Telegram alpha-channel setup app with a sourced post composer and an explicit real-channel connection flow.",
    values: {
      niche: "Solana smart money",
      sources: "Wallets + swaps",
      voice: "Sharp & sourced",
    },
    nativeSelector: ".telegram-workspace .tg-phone",
    proofLabel: "sourced draft generated and truthful Telegram setup opened",
  },
]

type ProofEvidence = {
  presetId: ProofDefinition["presetId"]
  name: string
  slug: string
  url: string
  publishStatus: number
  anonymousCookies: number
  documentKind: string | null
  nativeSelector: string
  interaction: string
  externalRequests: string[]
  consoleErrors: string[]
  telegramProviderEvidence: boolean | null
}

function createProofSpec(definition: ProofDefinition): GeneratedProjectSpec {
  const preset = presets.find((candidate) => candidate.id === definition.presetId)
  if (!preset) throw new Error(`Missing proof preset ${definition.presetId}`)

  const values = Object.fromEntries(
    preset.fields.map((field) => [field.id, field.value])
  )
  Object.assign(values, definition.values)

  const spec = createProjectSpec({
    presetId: definition.presetId,
    values,
    prompt: definition.prompt,
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market,
    prediction,
    origin: PROOF_ORIGIN,
  })

  return {
    ...spec,
    name: definition.name,
    slug: `proof-${definition.presetId}`,
    createdAt: "2026-07-29T12:00:00.000Z",
    ...(definition.presetId === "crypto-game" && spec.gameDirection
      ? { gameDirection: { ...spec.gameDirection, roundSeconds: 5 } }
      : {}),
  }
}

async function createAnonymousProofPage(
  browser: Browser,
  allowedOrigins: ReadonlySet<string>
) {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  })
  await context.addInitScript(() => {
    class ProofUtterance {
      text: string

      constructor(text: string) {
        this.text = text
      }
    }

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: ProofUtterance,
    })
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel() {}, speak() {} },
    })
  })

  const page = await context.newPage()
  const externalRequests: string[] = []
  const consoleErrors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))
  await page.route(/^https?:\/\//, async (route) => {
    const url = route.request().url()
    const parsed = new URL(url)

    if (
      allowedOrigins.has(parsed.origin) &&
      parsed.pathname === "/api/public-data"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          coins: market,
          events: [prediction],
          source: "Verified local proof snapshot",
          provider: "fallback",
          capabilities: {
            coins: false,
            unlocks: false,
            funding: false,
            activities: false,
          },
          fetchedAt: "2026-07-29T12:00:00.000Z",
        }),
      })
      return
    }

    if (allowedOrigins.has(parsed.origin)) {
      await route.continue()
      return
    }

    externalRequests.push(url)
    await route.abort("blockedbyclient")
  })

  return { context, page, externalRequests, consoleErrors }
}

async function proveGame(runtime: FrameLocator) {
  await runtime.locator("html").evaluate(() => {
    Math.random = () => 0.3
  })
  await runtime.locator("[data-action='play-catcher']").click()
  await expect(runtime.locator("#roundTimer")).toHaveText("5s")
  await expect(runtime.locator(".drop-object")).toBeVisible()
  await runtime.locator("[data-move='1']").click()
  await expect(runtime.locator(".catcher-player")).toHaveAttribute(
    "style",
    /62\.5%/
  )
}

async function proveRadio(runtime: FrameLocator) {
  await runtime.locator("[data-action='toggle-radio']").click()
  await expect(runtime.getByRole("button", { name: "Pause" })).toBeVisible()
  await expect(runtime.locator(".radio-wave i").first()).toHaveCSS(
    "animation-play-state",
    "running"
  )
}

async function proveTelegramSetup(runtime: FrameLocator, page: Page) {
  await expect(runtime.locator(".tg-avatar img[alt='Drops Bot']").first()).toBeVisible()
  await expect(
    runtime.locator(".tg-message-source img[alt='DropsTab source']").first()
  ).toBeVisible()
  await expect(
    runtime.getByText("PREVIEW · NOT PUBLISHED", { exact: true }).first()
  ).toBeVisible()
  await runtime.locator("[data-action='compose-post']").click()
  await expect(runtime.locator(".tg-story")).toContainText(
    "Wallet source setup required"
  )
  await expect(runtime.locator(".tg-story")).toContainText(
    "Connect a verified Drops Bot wallet or swap alert"
  )
  await expect(runtime.locator(".tg-story")).toContainText(
    "available price snapshot is shown separately"
  )
  const setupTrigger = runtime.locator("[data-action='dropsbot-setup']").first()
  await setupTrigger.click()
  const dialog = runtime.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute("aria-modal", "true")
  await expect(dialog.locator(".integration-card")).toBeFocused()
  await expect(dialog).toContainText(
    "OPTION A · NEW CHANNEL VIA STUDIO"
  )
  await expect(dialog).toContainText(
    "external action happens only after your explicit approval"
  )
  await expect(runtime.locator("[data-studio-telegram='true']")).toHaveAttribute(
    "href",
    /connections=1.*flow=telegram-channel/
  )
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(setupTrigger).toBeFocused()
}

test("publishes and anonymously proves game, radio and Telegram setup products", { tag: "@desktop-only" }, async ({
  browser,
  request,
}) => {

  const evidence: ProofEvidence[] = []
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true })

  for (const definition of proofs) {
    const spec = createProofSpec(definition)
    const publish = await request.post("/api/projects/publish", {
      headers: {
        "x-drops-session": "22222222-2222-4222-8222-222222222222",
      },
      data: { spec },
    })
    expect(publish.status()).toBe(201)

    const published = (await publish.json()) as {
      id: string
      slug: string
      url: string
    }
    expect(published.slug).toMatch(
      new RegExp(`^proof-${definition.presetId}-[a-f0-9]{24}$`)
    )
    const publishedUrl = new URL(published.url)
    if (EXTERNAL_PROOF_ORIGIN) {
      expect(publishedUrl.origin).toBe(EXTERNAL_PROOF_ORIGIN)
    } else {
      expect(publishedUrl.protocol).toBe("http:")
      expect(["127.0.0.1", "localhost"]).toContain(publishedUrl.hostname)
      expect(publishedUrl.port).toBe("4173")
    }
    expect(publishedUrl.pathname).toBe(`/p/${published.slug}`)

    const { context, page, externalRequests, consoleErrors } =
      await createAnonymousProofPage(
        browser,
        new Set([PROOF_ORIGIN, publishedUrl.origin])
      )
    expect(await context.cookies()).toEqual([])

    const response = await page.goto(published.url, {
      waitUntil: "domcontentloaded",
    })
    expect(response?.status()).toBe(200)
    expect(response?.headers()["content-type"]).toMatch(/^text\/html\b/)
    const runtime = page.frameLocator("#projectRuntime")
    await expect(runtime.locator("html")).toHaveAttribute(
      "data-project-kind",
      definition.presetId
    )
    await expect(runtime.locator(definition.nativeSelector).first()).toBeVisible()
    await expect(runtime.locator("#liveStatus")).toHaveText("SNAPSHOT")
    await expect(runtime.locator("#appRoot")).not.toContainText(
      /Unsupported product type|generic dashboard/i
    )

    if (definition.presetId === "crypto-game") await proveGame(runtime)
    if (definition.presetId === "crypto-radio") await proveRadio(runtime)
    if (definition.presetId === "alpha-channel") {
      await proveTelegramSetup(runtime, page)
    }

    const toast = runtime.locator("#toast")
    if (await toast.count()) {
      await expect(toast).not.toHaveClass(/show/, { timeout: 5_000 })
    }

    await page.screenshot({
      path: path.join(
        path.dirname(EVIDENCE_PATH),
        SCREENSHOT_NAMES[definition.presetId]
      ),
      fullPage: true,
    })

    await expect.poll(() => consoleErrors).toEqual([])
    expect(externalRequests).toEqual([])
    expect(await context.cookies()).toEqual([])

    evidence.push({
      presetId: definition.presetId,
      name: definition.name,
      slug: published.slug,
      url: published.url,
      publishStatus: publish.status(),
      anonymousCookies: (await context.cookies()).length,
      documentKind: await runtime.locator("html").getAttribute("data-project-kind"),
      nativeSelector: definition.nativeSelector,
      interaction: definition.proofLabel,
      externalRequests,
      consoleErrors,
      telegramProviderEvidence:
        definition.presetId === "alpha-channel" ? false : null,
    })

    await context.close()
  }

  await writeFile(
    EVIDENCE_PATH,
    `${JSON.stringify(
      {
        runtime: "Next.js production server",
        origin: PROOF_ORIGIN,
        compilerPath: "POST /api/projects/publish -> compileProject",
        externalProviderCallsAllowed: false,
        generatedAt: new Date().toISOString(),
        proofs: evidence,
      },
      null,
      2
    )}\n`,
    "utf8"
  )

  expect(evidence).toHaveLength(3)
})
