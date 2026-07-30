import { strFromU8, unzipSync } from "fflate"
import {
  expect,
  test,
  type Browser,
  type FrameLocator,
  type Page,
} from "@playwright/test"

import { compileProject } from "../../lib/project-compiler"
import { createProjectSpec } from "../../lib/project-factory"
import { presets, type PresetId } from "../../lib/presets"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProject,
  type ProjectMarketCoin,
  type ProjectPrediction,
} from "../../lib/project-types"

const LOCAL_PROOF_ORIGIN = "http://127.0.0.1:4173"
const PROOF_ORIGIN = configuredProofOrigin()
const FIXED_TIME = "2026-07-30T03:00:00.000Z"

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
  url: "https://polymarket.com/event/completion-bitcoin-above-120k",
}

type CompletionDefinition = {
  presetId: PresetId
  nativeSelector: string
  edit: {
    fieldId: string
    fieldLabel: string
    value: string
    visibleSelector: string
    visibleText: string
  }
}

const completionDefinitions = [
  {
    presetId: "action-engine",
    nativeSelector: '[data-studio-block="ledger"]',
    edit: {
      fieldId: "action",
      fieldLabel: "ACTION",
      value: "Buy token",
      visibleSelector: '[data-action="run-engine"]',
      visibleText: "Build Buy token",
    },
  },
  {
    presetId: "alpha-channel",
    nativeSelector: ".telegram-workspace .tg-phone",
    edit: {
      fieldId: "voice",
      fieldLabel: "VOICE",
      value: "Institutional",
      visibleSelector: ".tg-story p",
      visibleText: "Institutional",
    },
  },
  {
    presetId: "morning-alpha",
    nativeSelector: ".telegram-workspace .tg-phone",
    edit: {
      fieldId: "sections",
      fieldLabel: "INCLUDE",
      value: "Full market map",
      visibleSelector: '[data-brief-section="market-map"]',
      visibleText: "Market map",
    },
  },
  {
    presetId: "prediction-impact",
    nativeSelector: '[data-studio-block="impact-map"]',
    edit: {
      fieldId: "event",
      fieldLabel: "EVENT",
      value: "Fed rate decision",
      visibleSelector: '[data-studio-block="prediction"] h2',
      visibleText: "Fed rate decision",
    },
  },
  {
    presetId: "smart-money-copy",
    nativeSelector: "#walletInput",
    edit: {
      fieldId: "execute",
      fieldLabel: "MODE",
      value: "Research only",
      visibleSelector: '[data-action="paper-copy"]',
      visibleText: "Open research handoff",
    },
  },
  {
    presetId: "crypto-aggregator",
    nativeSelector: "#coinSearch",
    edit: {
      fieldId: "ranking",
      fieldLabel: "RANK BY",
      value: "24h movers",
      visibleSelector:
        '[data-studio-block="market-explorer"][data-ranking="24h movers"] #marketSort',
      visibleText: "Top gainers",
    },
  },
  {
    presetId: "crypto-game",
    nativeSelector: ".catcher-runtime",
    edit: {
      fieldId: "assets",
      fieldLabel: "ASSETS",
      value: "Solana only",
      visibleSelector: ".game-title small",
      visibleText: "Solana only",
    },
  },
  {
    presetId: "personal-companion",
    nativeSelector: '[data-studio-block="taste-graph"]',
    edit: {
      fieldId: "profile",
      fieldLabel: "PROFILE",
      value: "Research analyst",
      visibleSelector: '[data-studio-block="taste-graph"] h2',
      visibleText: "Research analyst",
    },
  },
  {
    presetId: "portfolio-tamagotchi",
    nativeSelector: "#holdingsInput",
    edit: {
      fieldId: "personality",
      fieldLabel: "PERSONALITY",
      value: "Risk therapist",
      visibleSelector: '[data-studio-block="portfolio-care"] h2',
      visibleText: "Risk therapist",
    },
  },
  {
    presetId: "crypto-product-hunt",
    nativeSelector: "#huntName",
    edit: {
      fieldId: "submit",
      fieldLabel: "SUBMISSIONS",
      value: "Private drafts",
      visibleSelector: '[data-action="submit-product"]',
      visibleText: "Save private draft",
    },
  },
  {
    presetId: "crypto-radio",
    nativeSelector: '[data-action="toggle-radio"]',
    edit: {
      fieldId: "show",
      fieldLabel: "SHOW",
      value: "Degen drive time",
      visibleSelector: '[data-studio-block="radio-player"] .eyebrow',
      visibleText: "Degen drive time",
    },
  },
  {
    presetId: "crypto-siri",
    nativeSelector: "#siriInput",
    edit: {
      fieldId: "commands",
      fieldLabel: "COMMANDS",
      value: "Research only",
      visibleSelector:
        '[data-studio-block="answer"] .button-row [data-action="dropstab"]:only-child',
      visibleText: "Research on DropsTab",
    },
  },
] as const satisfies readonly CompletionDefinition[]

function configuredProofOrigin() {
  const configured =
    process.env.DROPS_PROOF_BASE_URL?.trim() ||
    process.env.PLAYWRIGHT_BASE_URL?.trim()
  if (!configured) return LOCAL_PROOF_ORIGIN

  const parsed = new URL(configured)
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("The completion proof base URL must use HTTP or HTTPS.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("The completion proof base URL must not contain credentials.")
  }
  return parsed.origin
}

function createCompletionProject(
  definition: CompletionDefinition,
): GeneratedProject {
  const preset = presets.find((candidate) => candidate.id === definition.presetId)
  if (!preset) throw new Error(`Missing preset ${definition.presetId}`)

  const spec = createProjectSpec({
    presetId: definition.presetId,
    values: Object.fromEntries(
      preset.fields.map((field) => [field.id, field.value]),
    ),
    prompt: `Build the ${preset.shortTitle} completion proof`,
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market,
    prediction,
    origin: PROOF_ORIGIN,
  })
  const deterministicSpec = {
    ...spec,
    name: `Completion ${preset.shortTitle}`,
    slug: `completion-${definition.presetId}`,
    createdAt: FIXED_TIME,
  }

  return {
    id: `completion-${definition.presetId}`,
    spec: deterministicSpec,
    html: compileProject(deterministicSpec),
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  }
}

function deterministicDataPayload() {
  return {
    coins: market,
    events: [prediction],
    unlocks: [],
    funding: [],
    activities: [],
    source: "Deterministic local completion snapshot",
    provider: "fallback",
    capabilities: {
      coins: false,
      unlocks: false,
      funding: false,
      activities: false,
    },
    fetchedAt: FIXED_TIME,
  }
}

async function installDeterministicNetwork(page: Page) {
  const externalRequests: string[] = []
  const allowedOrigins = new Set([PROOF_ORIGIN])

  await page.route(/^https?:\/\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (!allowedOrigins.has(url.origin)) {
      externalRequests.push(request.url())
      await route.abort("blockedbyclient")
      return
    }
    if (url.pathname === "/__completion-seed__") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body>Completion seed</body></html>",
      })
      return
    }
    if (url.pathname === "/api/public-data") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(deterministicDataPayload()),
      })
      return
    }
    if (url.pathname.startsWith("/api/product-hunt/launches")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          launches: [],
          total: 0,
          sort: url.searchParams.get("sort") ?? "top",
          actor: { authenticated: false, scope: "browser-session" },
          providerEvidence: {
            storage: "deterministic-test-fixture",
            moderation: "unreviewed",
          },
        }),
      })
      return
    }

    await route.continue()
  })

  return {
    externalRequests,
    allowOrigin(value: string) {
      allowedOrigins.add(new URL(value).origin)
    },
  }
}

async function installBrowserProofHooks(page: Page) {
  await page.addInitScript(() => {
    const sharedUrls: string[] = []
    const createObjectUrl = URL.createObjectURL.bind(URL)
    Object.defineProperty(window, "__completionSharedUrls", {
      configurable: true,
      value: sharedUrls,
    })
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          sharedUrls.push(String(value))
        },
      },
    })
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (object: Blob | MediaSource) => {
        if (object instanceof Blob && object.type === "application/zip") {
          Object.defineProperty(window, "__completionArchiveBlob", {
            configurable: true,
            value: object,
          })
        }
        return createObjectUrl(object)
      },
    })
  })
}

async function seedStudioProject(
  page: Page,
  project: GeneratedProject,
  index: number,
) {
  await page.goto("/__completion-seed__", { waitUntil: "domcontentloaded" })
  await page.evaluate(
    ({ key, value, session }) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(key, value)
      window.sessionStorage.setItem("drops-studio:guest-id", session)
    },
    {
      key: PROJECTS_STORAGE_KEY,
      value: JSON.stringify([project]),
      session: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    },
  )
  await page.goto(`/studio/${project.id}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
}

async function expectVisibleEdit(
  surface: Page | FrameLocator,
  definition: CompletionDefinition,
) {
  const effect = surface.locator(definition.edit.visibleSelector).first()
  await expect(effect, `${definition.presetId} edit must be visible`).toBeVisible()
  await expect(effect).toContainText(definition.edit.visibleText)
}

async function storedProject(page: Page, projectId: string) {
  return page.evaluate(
    ({ key, id }) => {
      const projects = JSON.parse(
        window.localStorage.getItem(key) || "[]",
      ) as GeneratedProject[]
      const project = projects.find((candidate) => candidate.id === id)
      if (!project) throw new Error(`Stored project ${id} was not found`)
      return project
    },
    { key: PROJECTS_STORAGE_KEY, id: projectId },
  )
}

async function waitForPublishReady(page: Page, projectId: string) {
  await expect
    .poll(async () => (await storedProject(page, projectId)).quality?.readyToPublish)
    .toBe(true)
}

async function publishFromStudio(page: Page, projectId: string) {
  await page.locator(".workspace-actions .publish-top").click()
  const dialog = page.locator(".publish-dialog")
  await expect(dialog).toBeVisible()
  await dialog.locator(".cloud-publish").click()
  await expect
    .poll(async () => (await storedProject(page, projectId)).publishedUrl ?? null)
    .not.toBeNull()
  const published = await storedProject(page, projectId)
  expect(published.publishedUrl).toBeTruthy()
  await expect(dialog.locator(".public-url button").first().locator("strong")).toHaveText(
    published.publishedUrl!,
  )
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  return published.publishedUrl!
}

async function expectClipboardShare(page: Page, publishedUrl: string) {
  await page.getByRole("button", { name: "Share", exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window as typeof window & {
          __completionSharedUrls?: string[]
        }
        return state.__completionSharedUrls?.at(-1) ?? null
      }),
    )
    .toBe(publishedUrl)
  await expect(page.locator(".project-toast")).toContainText(
    "Public link copied",
  )
}

async function downloadProjectArchive(
  page: Page,
  definition: CompletionDefinition,
  project: GeneratedProject,
) {
  await page
    .locator(".stage-toolbar")
    .getByRole("button", { name: "Code", exact: true })
    .click()
  const dialog = page.locator(".source-dialog")
  await expect(dialog).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download full ZIP" }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`${project.spec.slug}-source.zip`)
  const downloadFailure = await download.failure()
  if (process.env.CI) {
    expect(downloadFailure).toBeNull()
  } else {
    // The confined snap Chromium available on this VPS reports Blob downloads
    // as canceled after emitting the correct browser event. The byte-level ZIP
    // proof below still validates the exact Blob produced by the UI; CI keeps
    // the stronger native-download assertion with Playwright's bundled browser.
    expect([null, "canceled"]).toContain(downloadFailure)
  }

  const archiveBase64 = await page.evaluate(async () => {
    const blob = (
      window as typeof window & { __completionArchiveBlob?: Blob }
    ).__completionArchiveBlob
    if (!blob) return null

    const bytes = new Uint8Array(await blob.arrayBuffer())
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
      )
    }
    return window.btoa(chunks.join(""))
  })
  expect(archiveBase64).not.toBeNull()

  const archiveBytes = new Uint8Array(
    Buffer.from(archiveBase64!, "base64"),
  )
  expect([...archiveBytes.slice(0, 4)]).toEqual([80, 75, 3, 4])
  const files = unzipSync(archiveBytes)
  const html = strFromU8(files["index.html"])
  const archivedSpec = JSON.parse(strFromU8(files["project.json"])) as {
    presetId: PresetId
    values: Record<string, string>
  }
  expect(archivedSpec.presetId).toBe(definition.presetId)
  expect(archivedSpec.values[definition.edit.fieldId]).toBe(
    definition.edit.value,
  )
  expect(html).toContain(`data-project-kind="${definition.presetId}"`)

  const references = new Set(
    [...html.matchAll(/\.\/((?:assets|brand)\/[a-z0-9._/-]+)/gi)].map(
      (match) => match[1],
    ),
  )
  for (const reference of references) {
    expect(
      files[reference]?.byteLength,
      `${definition.presetId} downloaded ZIP is missing ${reference}`,
    ).toBeGreaterThan(0)
  }

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
}

async function createAnonymousPage(browser: Browser) {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  const network = await installDeterministicNetwork(page)
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  return { context, page, ...network, runtimeErrors }
}

test("all 12 presets complete edit, publish, replay, share and browser ZIP boundaries", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-1440",
    "The all-preset completion proof runs once in canonical desktop Chromium.",
  )
  test.setTimeout(300_000)

  expect(completionDefinitions).toHaveLength(12)
  expect(new Set(completionDefinitions.map((item) => item.presetId)).size).toBe(
    presets.length,
  )

  await installBrowserProofHooks(page)
  const studioNetwork = await installDeterministicNetwork(page)
  const studioRuntimeErrors: string[] = []
  let activePreset: PresetId | "setup" = "setup"
  page.on("console", (message) => {
    if (message.type() === "error") {
      studioRuntimeErrors.push(`${activePreset}: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => {
    studioRuntimeErrors.push(`${activePreset}: ${error.message}`)
  })

  const anonymous = await createAnonymousPage(browser)
  expect(await anonymous.context.cookies()).toEqual([])

  try {
    for (const [index, definition] of completionDefinitions.entries()) {
      activePreset = definition.presetId
      const project = createCompletionProject(definition)
      await seedStudioProject(page, project, index)

      const runtime = page.frameLocator("iframe[title$='live application']")
      await expect(runtime.locator(definition.nativeSelector).first()).toBeVisible()
      await expect(runtime.locator("#liveStatus")).toHaveText("SNAPSHOT")

      await page.getByRole("button", { name: "Logic", exact: true }).click()
      const field = page.getByRole("combobox", {
        name: definition.edit.fieldLabel,
        exact: true,
      })
      await field.selectOption(
        { label: definition.edit.value },
        { timeout: 10_000 },
      )
      await expect(field).toHaveValue(definition.edit.value)
      await expectVisibleEdit(runtime, definition)
      await expect
        .poll(
          async () =>
            (await storedProject(page, project.id)).spec.values[
              definition.edit.fieldId
            ],
        )
        .toBe(definition.edit.value)
      await waitForPublishReady(page, project.id)

      const publishedUrl = await publishFromStudio(page, project.id)
      anonymous.allowOrigin(publishedUrl)
      const response = await anonymous.page.goto(publishedUrl, {
        waitUntil: "domcontentloaded",
      })
      expect(response?.status(), `${definition.presetId} anonymous replay`).toBe(
        200,
      )
      await expect(anonymous.page.locator("html")).toHaveAttribute(
        "data-project-kind",
        definition.presetId,
      )
      await expect(
        anonymous.page.locator(definition.nativeSelector).first(),
      ).toBeVisible()
      await expectVisibleEdit(anonymous.page, definition)
      await expect(anonymous.page.locator("#liveStatus")).toHaveText("SNAPSHOT")

      await expectClipboardShare(page, publishedUrl)
      const editedProject = await storedProject(page, project.id)
      await downloadProjectArchive(page, definition, editedProject)
    }

    expect(await anonymous.context.cookies()).toEqual([])
    expect(
      studioNetwork.externalRequests,
      studioNetwork.externalRequests.join("\n"),
    ).toEqual([])
    expect(
      anonymous.externalRequests,
      anonymous.externalRequests.join("\n"),
    ).toEqual([])
    expect(studioRuntimeErrors, studioRuntimeErrors.join("\n")).toEqual([])
    expect(anonymous.runtimeErrors, anonymous.runtimeErrors.join("\n")).toEqual(
      [],
    )
  } finally {
    await anonymous.context.close()
  }
})
