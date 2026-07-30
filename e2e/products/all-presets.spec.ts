import { Script } from "node:vm"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

import { compileProject } from "../../lib/project-compiler"
import { createProjectSpec } from "../../lib/project-factory"
import { customProductPreset, presets, type PresetId } from "../../lib/presets"
import type {
  GeneratedProjectSpec,
  ProjectMarketCoin,
  ProjectPrediction,
} from "../../lib/project-types"

const presetIds = [
  "action-engine",
  "alpha-channel",
  "morning-alpha",
  "prediction-impact",
  "smart-money-copy",
  "crypto-aggregator",
  "crypto-game",
  "personal-companion",
  "portfolio-tamagotchi",
  "crypto-product-hunt",
  "crypto-radio",
  "crypto-siri",
  "custom-product",
] as const satisfies readonly PresetId[]

type ContractPresetId = (typeof presetIds)[number]

const contractPresets = [...presets, customProductPreset]

const expectedArchetype: Record<ContractPresetId, GeneratedProjectSpec["experience"]["archetype"]> = {
  "action-engine": "decision-cockpit",
  "alpha-channel": "creator-feed",
  "morning-alpha": "editorial-brief",
  "prediction-impact": "impact-map",
  "smart-money-copy": "strategy-monitor",
  "crypto-aggregator": "market-explorer",
  "crypto-game": "game-world",
  "personal-companion": "discovery-companion",
  "portfolio-tamagotchi": "character-habitat",
  "crypto-product-hunt": "launch-board",
  "crypto-radio": "audio-studio",
  "crypto-siri": "voice-assistant",
  "custom-product": "modular-crypto-app",
}

const nativeMarker: Record<ContractPresetId, string> = {
  "action-engine": '[data-studio-block="ledger"]',
  "alpha-channel": ".telegram-workspace .tg-phone",
  "morning-alpha": ".telegram-workspace .tg-phone",
  "prediction-impact": '[data-studio-block="impact-map"]',
  "smart-money-copy": "#walletInput",
  "crypto-aggregator": "#coinSearch",
  "crypto-game": ".catcher-runtime",
  "personal-companion": '[data-studio-block="taste-graph"]',
  "portfolio-tamagotchi": "#holdingsInput",
  "crypto-product-hunt": "#huntName",
  "crypto-radio": '[data-action="toggle-radio"]',
  "crypto-siri": "#siriInput",
  "custom-product": ".custom-product-shell",
}

const market: ProjectMarketCoin[] = [
  { symbol: "BTC", name: "Bitcoin", price: "$118,420", change: 2.4, marketCap: "$2.36T" },
  { symbol: "ETH", name: "Ethereum", price: "$3,780", change: -1.2, marketCap: "$456B" },
  { symbol: "SOL", name: "Solana", price: "$198", change: 8.6, marketCap: "$99B" },
  { symbol: "DOGE", name: "Dogecoin", price: "$0.24", change: 4.1, marketCap: "$35B" },
]

const prediction: ProjectPrediction = {
  title: "Bitcoin above $120k this month",
  probability: 64,
  change: 3,
  url: "https://polymarket.com/event/e2e-bitcoin-above-120k",
}

const valueOverrides: Partial<Record<PresetId, Record<string, string>>> = {
  "morning-alpha": { time: "08:00 UTC" },
  "crypto-game": { game: "Unlock Dodge" },
  "portfolio-tamagotchi": { personality: "Calm quant" },
  "crypto-product-hunt": {
    scope: "New crypto products",
    rank: "Top votes",
    submit: "Public community",
  },
  "crypto-radio": { show: "Market in 5" },
  "crypto-siri": { language: "English" },
}

function deterministicSpec(
  presetId: ContractPresetId,
  overrides: Record<string, string> = {},
): GeneratedProjectSpec {
  const preset = contractPresets.find((candidate) => candidate.id === presetId)
  if (!preset) throw new Error(`Missing preset ${presetId}`)

  const values = Object.fromEntries(
    preset.fields.map((field) => [field.id, field.options[1] ?? field.value])
  )
  Object.assign(values, valueOverrides[presetId], overrides)

  const base = createProjectSpec({
    presetId,
    values,
    prompt: `${preset.shortTitle} deterministic browser contract`,
    tools: preset.tools,
    provider: "free",
    model: "Free Auto",
    market,
    prediction,
    origin: "http://127.0.0.1:4173",
  })

  return {
    ...base,
    name: `Contract ${preset.shortTitle}`,
    slug: `contract-${presetId}`,
    createdAt: "2026-07-29T12:00:00.000Z",
    ...(presetId === "crypto-game" && base.gameDirection
      ? { gameDirection: { ...base.gameDirection, roundSeconds: 5 } }
      : {}),
  }
}

function assertRuntimeScriptParses(presetId: PresetId, html: string) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  const runtime = scripts.at(-1)?.[1]

  expect(runtime, `${presetId} must include an executable runtime script`).toBeTruthy()
  if (!runtime) {
    throw new Error(`${presetId} generated runtime is missing`)
  }
  expect(
    () => new Script(runtime, { filename: `${presetId}.generated.js` }),
    `${presetId} generated runtime must parse before browser execution`
  ).not.toThrow()
}

type RuntimeFailureLog = {
  failures: string[]
  assertClean: () => Promise<void>
}

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number]

function formatAxeViolations(violations: AxeViolation[]) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
          .join("\n")}`
    )
    .join("\n\n")
}

async function expectNoSeriousAxeViolations(page: Page, presetId: PresetId) {
  const results = await new AxeBuilder({ page })
    .include("#appRoot")
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22a",
      "wcag22aa",
    ])
    .analyze()
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical"
  )

  expect.soft(
    blocking.length,
    `${presetId} standalone Axe violations:\n${formatAxeViolations(blocking)}`
  ).toBe(0)
}

type PrimaryControl = {
  label: string
  locator: Locator
}

function primaryControlsFor(
  page: Page,
  presetId: ContractPresetId
): PrimaryControl[] {
  const first = (selector: string) => page.locator(selector).first()

  switch (presetId) {
    case "action-engine":
      return [
        { label: "build decision", locator: first('[data-action="run-engine"]') },
      ]
    case "alpha-channel":
      return [
        { label: "generate sourced post", locator: first('[data-action="compose-post"]') },
        { label: "connect Drops Bot", locator: first('[data-action="dropsbot-setup"]') },
      ]
    case "morning-alpha":
      return [
        { label: "refresh live brief", locator: first('[data-action="refresh"]') },
        { label: "connect Drops Bot", locator: first('[data-action="dropsbot-setup"]') },
      ]
    case "prediction-impact":
      return [
        { label: "prediction action", locator: first("[data-prediction-action]") },
      ]
    case "smart-money-copy":
      return [
        { label: "wallet address", locator: first("#walletInput") },
        { label: "copy strategy action", locator: first('[data-action="paper-copy"]') },
      ]
    case "crypto-aggregator":
      return [
        { label: "coin search", locator: first("#coinSearch") },
        { label: "market ranking", locator: first("#marketSort") },
        { label: "favorite asset", locator: first("[data-favorite]") },
      ]
    case "crypto-game":
      return [
        { label: "start game", locator: first('[data-action="play-catcher"]') },
        { label: "move left", locator: first('[data-move="-1"]') },
        { label: "move right", locator: first('[data-move="1"]') },
      ]
    case "personal-companion":
      return [
        { label: "choose interest", locator: first("[data-interest]") },
        { label: "reset preferences", locator: first('[data-action="reset-preferences"]') },
      ]
    case "portfolio-tamagotchi":
      return [
        { label: "portfolio holdings", locator: first("#holdingsInput") },
        { label: "calculate health", locator: first('[data-action="save-holdings"]') },
      ]
    case "crypto-product-hunt":
      return [
        { label: "product name", locator: first("#huntName") },
        { label: "save product", locator: first('[data-action="submit-product"]') },
      ]
    case "crypto-radio":
      return [
        { label: "radio playback", locator: first('[data-action="toggle-radio"]') },
        { label: "rundown story", locator: first("[data-story]") },
      ]
    case "crypto-siri":
      return [
        { label: "assistant question", locator: first("#siriInput") },
        { label: "ask assistant", locator: first('[data-action="ask-siri"]') },
        { label: "voice input", locator: first('[data-action="listen-siri"]') },
      ]
    case "custom-product":
      return [
        { label: "custom product action", locator: first("[data-custom-action]") },
      ]
  }
}

async function expectPrimaryControlsReachable(
  page: Page,
  presetId: ContractPresetId
) {
  for (const control of primaryControlsFor(page, presetId)) {
    await expect(
      control.locator,
      `${presetId}: missing primary control ${control.label}`
    ).toHaveCount(1)
    await control.locator.evaluate((element) => {
      element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" })
    })
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    await expect(
      control.locator,
      `${presetId}: primary control ${control.label} is not visible`
    ).toBeVisible()

    const audit = await control.locator.evaluate((element) => {
      const node = element as HTMLElement
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
      const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
      const topmost = document.elementFromPoint(centerX, centerY)
      const topmostDescription = topmost
        ? `${topmost.tagName.toLowerCase()}${(topmost as HTMLElement).id ? `#${(topmost as HTMLElement).id}` : ""}`
        : "none"
      const textRects: DOMRect[] = []
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      while (textNode) {
        if (textNode.textContent?.trim()) {
          const range = document.createRange()
          range.selectNodeContents(textNode)
          textRects.push(...Array.from(range.getClientRects()))
        }
        textNode = walker.nextNode()
      }
      const tolerance = 2
      const textOutsideControl = textRects.some(
        (textRect) =>
          textRect.left < rect.left - tolerance ||
          textRect.right > rect.right + tolerance ||
          textRect.top < rect.top - tolerance ||
          textRect.bottom > rect.bottom + tolerance
      )

      return {
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        fullyInsideViewport:
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight,
        centerIsUnoccluded:
          Boolean(topmost) &&
          (topmost === node || node.contains(topmost) || topmost?.contains(node)),
        topmostDescription,
        textOutsideControl,
        contentOverflow:
          node.scrollWidth > node.clientWidth + 1 ||
          node.scrollHeight > node.clientHeight + 1,
        overflow: `${style.overflowX}/${style.overflowY}`,
      }
    })

    expect(
      audit.fullyInsideViewport,
      `${presetId}: ${control.label} is clipped by the viewport: ${JSON.stringify(audit)}`
    ).toBe(true)
    expect(
      audit.centerIsUnoccluded,
      `${presetId}: ${control.label} is occluded at its center by ${audit.topmostDescription}: ${JSON.stringify(audit)}`
    ).toBe(true)
    expect(
      audit.textOutsideControl,
      `${presetId}: text escapes ${control.label}: ${JSON.stringify(audit)}`
    ).toBe(false)
    expect(
      audit.contentOverflow,
      `${presetId}: content is clipped inside ${control.label}: ${JSON.stringify(audit)}`
    ).toBe(false)
  }
}

function captureRuntimeFailures(page: Page): RuntimeFailureLog {
  const failures: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console.error: ${message.text()}`)
  })
  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error.message}`)
  })

  return {
    failures,
    assertClean: async () => {
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      expect(failures, failures.join("\n")).toEqual([])
    },
  }
}

async function renderStandalone(
  page: Page,
  presetId: ContractPresetId,
  overrides: Record<string, string> = {},
) {
  const runtime = captureRuntimeFailures(page)
  const spec = deterministicSpec(presetId, overrides)
  const html = compileProject(spec)

  assertRuntimeScriptParses(presetId, html)

  await page.route("**/__compiled-product-contract__", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    })
  })
  await page.route("**/api/public-data", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        coins: market,
        unlocks: [
          {
            symbol: "ARB",
            slug: "arbitrum",
            nextUnlockAt: "2026-08-16T00:00:00.000Z",
            unlockedPercent: 57.4,
            lockedPercent: 42.6,
            marketCap: "$1.8B",
            fdv: "$4.2B",
          },
        ],
        funding: [
          {
            symbol: "JUP",
            slug: "jupiter",
            stage: "Strategic",
            raised: "$18M",
            raisedUsd: 18_000_000,
            announcedAt: "2026-07-28T00:00:00.000Z",
            investors: ["Example Capital"],
          },
        ],
        activities: [
          {
            symbol: "SOL",
            slug: "solana",
            name: "Solana",
            type: "Ecosystem event",
            status: "UPCOMING",
            startsAt: "2026-08-01T00:00:00.000Z",
            summary: "A sourced ecosystem activity fixture.",
          },
        ],
        events: [prediction],
        source: "Deterministic DropsTab contract fixture",
        provider: "dropstab",
        capabilities: {
          coins: true,
          unlocks: true,
          funding: true,
          activities: true,
        },
        fetchedAt: "2026-07-29T12:00:00.000Z",
      }),
    })
  })
  const communityLaunches: Array<Record<string, unknown>> = []
  await page.route("**/api/product-hunt/launches**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const voteMatch = url.pathname.match(/\/api\/product-hunt\/launches\/([^/]+)\/vote$/)
    if (request.method() === "POST" && voteMatch) {
      const launch = communityLaunches.find((item) => item.id === voteMatch[1])
      if (!launch) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Launch not found" }) })
        return
      }
      launch.votes = Number(launch.votes ?? 0) + 1
      launch.viewerHasVoted = true
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true, duplicate: false, votes: launch.votes, viewerHasVoted: true }),
      })
      return
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      const launch = {
        id: "11111111-1111-4111-8111-111111111111",
        ...body,
        votes: 0,
        viewerHasVoted: false,
        evidence: {
          listing: "community-submitted",
          destination: "community-url-unverified",
          votes: "browser-session-deduplicated",
          moderation: "unreviewed",
        },
      }
      communityLaunches.unshift(launch)
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          launch,
          providerEvidence: { storage: "local-memory", moderation: "unreviewed" },
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        launches: communityLaunches,
        total: communityLaunches.length,
        sort: url.searchParams.get("sort") ?? "top",
        actor: { authenticated: false, scope: "browser-session" },
        providerEvidence: { storage: "local-memory", moderation: "unreviewed" },
      }),
    })
  })
  await page.goto("/__compiled-product-contract__", {
    waitUntil: "domcontentloaded",
  })
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.setContent(html, { waitUntil: "domcontentloaded" })

  await expect(page.locator("html")).toHaveAttribute("data-project-kind", presetId)
  await expect(page.locator("html")).toHaveAttribute(
    "data-experience",
    expectedArchetype[presetId]
  )
  const marker =
    presetId === "crypto-game"
      ? `[data-game-genre="${spec.gameDirection?.genre ?? "market-race"}"]`
      : nativeMarker[presetId]
  await expect(page.locator(marker).first()).toBeVisible()
  await expect(page.locator("#liveStatus")).toHaveText("LIVE DROPSTAB")
  await expect(page.locator("#appRoot")).not.toContainText("Launching your product")

  const visibleCopy = await page.locator("body").innerText()
  expect(visibleCopy).not.toMatch(/Unsupported product type|generic dashboard/i)

  const preset = contractPresets.find((candidate) => candidate.id === presetId)
  if (!preset) throw new Error(`Missing preset ${presetId}`)
  for (const field of preset.fields) {
    await expect(
      page.locator(`[data-config-field="${field.id}"] strong`),
      `${presetId}.${field.id} must affect the compiled runtime`,
    ).toHaveText(spec.values[field.id])
    await expect(
      page.locator(`[data-native-field="${field.id}"]`),
      `${presetId}.${field.id} must alter category-native content, not only the configuration strip`,
    ).toContainText(spec.values[field.id])
  }
  await expectPresetBehavior(page, presetId, spec)

  return { runtime, spec }
}

async function expectPresetBehavior(
  page: Page,
  presetId: ContractPresetId,
  spec: GeneratedProjectSpec,
) {
  const values = spec.values
  if (presetId === "action-engine") {
    await expect(page.locator('[data-studio-block="thesis"] h2')).toHaveText(values.signal)
    await expect(page.locator('[data-studio-block="trigger"] h2')).toHaveText(values.trigger)
    await expect(page.locator('[data-native-brain]')).toContainText(values.brain)
    await expect(page.locator('[data-action="run-engine"]')).toHaveAttribute(
      "data-action-mode",
      values.action,
    )
  } else if (presetId === "alpha-channel") {
    await expect(page.locator('[data-studio-block="channel-control"] h2').first()).toHaveText(values.niche)
    await expect(page.locator('[data-alpha-sources]')).toContainText(values.sources)
    await expect(page.locator(".tg-story p").first()).toContainText(values.voice)
    await expect(page.locator('[data-alpha-goal]')).toContainText(values.earn)
  } else if (presetId === "morning-alpha") {
    await expect(page.locator('[data-studio-block="brief-setup"]')).toContainText(values.assets)
    await expect(page.locator('[data-studio-block="brief-setup"]')).toContainText(values.time)
    await expect(page.locator('[data-studio-block="brief-setup"]')).toContainText(values.sections)
    await expect(page.locator('[data-studio-block="brief-setup"]')).toContainText(values.brain)
    await expect(page.locator('[data-studio-block="telegram-brief"]')).toHaveAttribute(
      "data-section-mode",
      values.sections,
    )
  } else if (presetId === "prediction-impact") {
    await expect(page.locator('[data-studio-block="prediction"] h2')).toHaveText(values.event)
    await expect(page.locator('[data-studio-block="prediction"]')).toContainText(values.trigger)
    await expect(page.locator('[data-impact-mode]')).toContainText(values.impact)
    await expect(page.locator('[data-prediction-action]')).toHaveAttribute(
      "data-prediction-action",
      values.action,
    )
    await expect(page.locator('[data-studio-block="impact-map"] .map-node:visible')).toHaveCount(2)
  } else if (presetId === "smart-money-copy") {
    if (await page.locator("#walletInput").count()) {
      await expect(page.locator("#walletInput")).toHaveAttribute(
        "placeholder",
        new RegExp(values.wallets)
      )
    } else {
      await expect(page.locator('[data-studio-block="wallets"]')).toContainText(
        "0x111111"
      )
    }
    await expect(page.locator('[data-studio-block="copy-rule"] h2')).toHaveText(values.confirm)
    await expect(page.locator("#risk")).toHaveAttribute("data-size-policy", values.size)
    await expect(page.locator('[data-action="paper-copy"]')).toHaveAttribute(
      "data-execution-mode",
      values.execute,
    )
  } else if (presetId === "crypto-aggregator") {
    await expect(page.locator('[data-studio-block="market-explorer"] h2')).toHaveText(values.universe)
    await expect(page.locator("#marketSort")).toHaveValue("gainers")
    await expect(page.locator('[data-studio-block="market-explorer"]')).toHaveAttribute(
      "data-ranking",
      values.ranking,
    )
    await expect(page.locator('[data-ranking-label]')).toContainText(values.ranking)
    await expect(page.locator('[data-module-mode]')).toContainText(values.modules)
    await expect(page.locator('[data-publish-target]')).toContainText(values.publish)
    await expect(page.locator("html")).toHaveAttribute("data-publish-mode", values.publish)
  } else if (presetId === "crypto-game") {
    const game = page.locator(`[data-game-genre="${spec.gameDirection?.genre ?? "unlock-dodge"}"]`)
    await expect(game).toBeVisible()
    await expect(game).toHaveAttribute("data-asset-scope", values.assets)
    await expect(game).toHaveAttribute("data-social-mode", values.social)
    await expect(game).toHaveAttribute("data-round-seconds", String(spec.gameDirection?.roundSeconds))
  } else if (presetId === "personal-companion") {
    await expect(page.locator('[data-studio-block="taste-graph"] h2')).toContainText(values.profile)
    await expect(page.locator('[data-studio-block="taste-graph"] h2')).toContainText(values.discover)
    await expect(page.locator('[data-learning-mode]')).toContainText(values.learn)
    await expect(page.locator('[data-brain-mode]')).toContainText(values.brain)
  } else if (presetId === "portfolio-tamagotchi") {
    await expect(page.locator("#holdingsInput")).toHaveAttribute("placeholder", new RegExp(values.portfolio))
    await expect(page.locator('[data-studio-block="portfolio-care"] h2')).toHaveText(values.personality)
    await expect(page.locator('[data-studio-block="pet"]')).toHaveAttribute(
      "data-health-formula",
      values.health,
    )
    await expect(page.locator('[data-care-mode]')).toHaveAttribute("data-care-mode", values.care)
  } else if (presetId === "crypto-product-hunt") {
    await expect(page.locator('[data-studio-block="hunt-header"] h2').first()).toHaveText(values.scope)
    await expect(page.locator('[data-studio-block="hunt-header"]')).toHaveAttribute(
      "data-rank-mode",
      values.rank,
    )
    await expect(page.locator('[data-studio-block="hunt-header"]')).toHaveAttribute(
      "data-context-mode",
      values.context,
    )
    await expect(page.locator('[data-studio-block="hunt-header"]')).toHaveAttribute(
      "data-submission-mode",
      values.submit,
    )
    await expect(page.locator('[data-action="submit-product"]')).toHaveAttribute(
      "data-submit-mode",
      values.submit,
    )
    await expect(page.locator('[data-rank-label]')).toContainText(values.rank)
    await expect(page.locator('[data-context-label]')).toContainText(values.context)
  } else if (presetId === "crypto-radio") {
    await expect(page.locator('[data-studio-block="radio-player"]')).toContainText(values.show)
    await expect(page.locator("[data-radio-source]").first()).toHaveAttribute(
      "data-radio-source",
      values.source,
    )
    await expect(page.locator('[data-studio-block="radio-player"] .local-label')).toContainText(values.voice)
    await expect(page.locator("[data-radio-air]")).toHaveAttribute("data-air-mode", values.air)
  } else if (presetId === "crypto-siri") {
    await expect(page.locator('[data-studio-block="voice-orb"]')).toContainText(values.language)
    await expect(page.locator('[data-studio-block="voice-orb"]')).toContainText(values.brain)
    await expect(page.locator("#siriAnswer")).toHaveAttribute("data-answer-mode", values.answer)
    await expect(page.locator('[data-command-scope]')).toContainText(values.commands)
    await expect(page.getByRole("button", { name: /Prepare alert in Drops Bot/i })).toHaveCount(0)
  } else if (presetId === "custom-product") {
    const shell = page.locator(".custom-product-shell")
    await expect(shell).toHaveAttribute("data-custom-purpose", values.purpose)
    await expect(shell).toHaveAttribute("data-custom-audience", values.audience)
    await expect(shell).toHaveAttribute("data-custom-primary-view", values["primary-view"])
    await expect(shell).toHaveAttribute("data-custom-automation", values.automation)
    await expect(shell.locator(".row.between").first()).toContainText(values.purpose)
    await expect(shell.locator(".row.between").first()).toContainText(values.audience)
    await expect(shell.locator(".custom-product-screen")).toHaveAttribute(
      "data-layout",
      values["primary-view"] === "Research feed"
        ? "feed"
        : values["primary-view"] === "Personal dashboard"
          ? "split"
          : "grid",
    )
  }
}

type UiViolation = {
  element: string
  value?: number
  width?: number
  height?: number
}

function formatViolations(label: string, violations: UiViolation[]) {
  return `${label}: ${violations.length}\n${violations
    .slice(0, 60)
    .map((violation) => `${JSON.stringify(violation)} — ${violation.element}`)
    .join("\n")}`
}

async function expectStandaloneUiPolicy(page: Page) {
  const audit = await page.evaluate(() => {
    const describe = (element: Element) => {
      const node = element as HTMLElement
      const id = node.id ? `#${node.id}` : ""
      const classes = [...node.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join("")
      const text = (node.innerText || node.getAttribute("aria-label") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 90)
      return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` "${text}"` : ""}`
    }
    const visible = (element: Element) => {
      const node = element as HTMLElement
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const directText = (element: Element) =>
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      )
    const controls = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='checkbox']",
      "[role='combobox']",
      "[role='link']",
      "[role='menuitem']",
      "[role='option']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
    ].join(",")
    const text = [...document.querySelectorAll("body *")]
      .filter((element) => visible(element) && directText(element))
      .map((element) => ({
        element: describe(element),
        value: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value < 12)
    const bodyCopy = [...document.querySelectorAll("p, li, td")]
      .filter(visible)
      .map((element) => ({
        element: describe(element),
        value: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value < 16)
    const controlText = [...document.querySelectorAll(controls)]
      .filter(visible)
      .map((element) => ({
        element: describe(element),
        value: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value < 14)
    const targets = [...document.querySelectorAll(controls)]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          element: describe(element),
          width: rect.width,
          height: rect.height,
        }
      })
      .filter((entry) => entry.width < 44 || entry.height < 44)
    const root = document.documentElement
    const body = document.body

    return {
      bodyFontSize: Number.parseFloat(getComputedStyle(body).fontSize),
      text,
      bodyCopy,
      controlText,
      targets,
      overflow: {
        rootClientWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
      },
    }
  })

  expect(audit.bodyFontSize, "Standalone body text must be 16–18px").toBeGreaterThanOrEqual(16)
  expect(audit.bodyFontSize, "Standalone body text must be 16–18px").toBeLessThanOrEqual(18)
  expect(audit.text, formatViolations("Visible text below 12px", audit.text)).toEqual([])
  expect(
    audit.bodyCopy,
    formatViolations("Semantic body copy below 16px", audit.bodyCopy)
  ).toEqual([])
  expect(
    audit.controlText,
    formatViolations("Control text below 14px", audit.controlText)
  ).toEqual([])
  expect(
    audit.targets,
    formatViolations("Interactive target below 44x44px", audit.targets)
  ).toEqual([])
  expect(
    audit.overflow.rootScrollWidth,
    `documentElement horizontal overflow: ${JSON.stringify(audit.overflow)}`
  ).toBeLessThanOrEqual(audit.overflow.rootClientWidth)
  expect(
    audit.overflow.bodyScrollWidth,
    `body horizontal overflow: ${JSON.stringify(audit.overflow)}`
  ).toBeLessThanOrEqual(audit.overflow.bodyClientWidth)
}

async function expectTelegramConnectionFlow(page: Page) {
  const brandMark = page.locator(".tg-avatar img[alt='Drops Bot']").first()
  await expect(brandMark).toBeVisible()
  await expect(brandMark).toHaveAttribute("src", "/brand/drops-bot-avatar.jpg")
  await expect
    .poll(() =>
      brandMark.evaluate(
        (image: HTMLImageElement) =>
          image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      )
    )
    .toBe(true)
  await expect(page.getByText("PREVIEW · NOT PUBLISHED", { exact: true }).first()).toBeVisible()
  await expect(page.locator(".tg-reality")).toContainText(
    /faithful Telegram layout preview|No unlock, funding or Telegram delivery is invented|Telegram delivery still requires provider proof|Connect Drops Bot to deliver/i
  )
  const setupTrigger = page
    .locator("#appRoot [data-action='dropsbot-setup']")
    .first()
  await setupTrigger.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute("aria-modal", "true")
  await expect(dialog.locator(".integration-card")).toBeFocused()
  await expect(dialog).toContainText("MTProto")
  await expect(dialog).toContainText("EXISTING CHANNEL FALLBACK")
  await expect(page.locator("[data-studio-telegram='true']")).toHaveAttribute(
    "href",
    /connections=1.*flow=telegram-channel/
  )
  await expect(page.locator("#tgChannel")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(setupTrigger).toBeFocused()
}

async function stubExternalOpen(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as Window & { __openedUrls: string[] }
    target.__openedUrls = []
    target.open = ((url?: string | URL) => {
      target.__openedUrls.push(String(url))
      return null
    }) as typeof window.open
  })
}

async function openedUrls(page: Page) {
  return page.evaluate(
    () => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? []
  )
}

const categoryInteraction: Record<ContractPresetId, (page: Page) => Promise<void>> = {
  "action-engine": async (page) => {
    await expect(page.getByText("Human approval required", { exact: true })).toBeVisible()
    await page.locator('[data-action="run-engine"]').click()
    await expect(page.locator('[data-studio-block="ledger"] .log-row')).toContainText(
      /REVIEW BUY|WAIT FOR CONFIRMATION|HEDGE \/ WAIT/
    )
    await expect(page.locator("body")).not.toContainText(/trade executed|position opened/i)
  },
  "alpha-channel": async (page) => {
    await page.getByRole("button", { name: "Generate sourced post" }).click()
    await expect(page.locator(".tg-story").first()).toContainText("DropsTab")
    await expectTelegramConnectionFlow(page)
  },
  "morning-alpha": async (page) => {
    await page.getByRole("button", { name: "Refresh live brief" }).click()
    await expect(page.locator("#liveStatus")).toHaveText("LIVE DROPSTAB")
    await expect(page.locator(".tg-message")).toContainText("ARB · Aug 16, 2026")
    await expect(page.locator(".tg-message")).toContainText("JUP · $18M")
    await expectTelegramConnectionFlow(page)
  },
  "prediction-impact": async (page) => {
    await expect(page.getByText("Research mode", { exact: true })).toBeVisible()
    await expect(page.getByText("Nothing executes here", { exact: true })).toBeVisible()
    await stubExternalOpen(page)
    await page.locator("[data-prediction-action]").click()
    expect(await openedUrls(page)).toContain(prediction.url)
    await expect(page.locator("body")).not.toContainText(/executed on polymarket|automatic hedge/i)
  },
  "smart-money-copy": async (page) => {
    await page.locator("#walletInput").fill(`0x${"1".repeat(40)}`)
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.locator("#risk")).toHaveValue("2")
    await page.getByRole("button", { name: "Open Telegram alert setup" }).click()
    await expect(page.getByRole("dialog")).toContainText("VERIFIED TELEGRAM SETUP")
    await page.keyboard.press("Escape")
    await expect(page.locator("body")).not.toContainText(/position opened|copied live/i)
  },
  "crypto-aggregator": async (page) => {
    await page.locator("#marketSort").selectOption("gainers")
    await expect(page.locator("tbody tr").first()).toContainText("Solana")
    await page.locator("#coinSearch").fill("SOL")
    await expect(page.locator("tbody tr")).toHaveCount(1)
    await expect(page.locator("tbody tr").first()).toContainText("Solana")
    await expect(page.locator("tbody tr").first()).toContainText("$198")
    const favorite = page.getByRole("button", { name: "Save SOL to favorites" })
    await favorite.click()
    await expect(page.getByRole("button", { name: "Remove SOL from favorites" })).toHaveClass(
      /active/
    )
  },
  "crypto-game": async (page) => {
    await page.evaluate(() => {
      Math.random = () => 0.3
    })
    await page.locator('[data-action="play-catcher"]').click()
    await expect(page.locator("#roundTimer")).toHaveText("5s")
    await page.locator('[data-move="1"]').click()
    await expect(page.locator(".catcher-player")).toHaveAttribute("style", /62\.5%/)
    await page.locator('[data-move="-1"]').click()
    await expect(page.locator(".catcher-player")).toHaveAttribute("style", /37\.5%/)
    await expect
      .poll(async () => {
        const value = await page.locator(".hud-stat strong").first().textContent()
        return Number.parseInt(value ?? "0", 10)
      })
      .toBeGreaterThan(0)
    await expect(page.locator(".game-result")).toContainText("LOCAL SCORE", {
      timeout: 8_000,
    })
    await expect(page.locator(".game-result")).toContainText("points")
  },
  "personal-companion": async (page) => {
    await page.locator('[data-interest="SOL"]').click()
    await expect(page.locator('[data-interest="SOL"]')).toHaveClass(/active/)
    await expect(page.locator('[data-studio-block="recommendations"]')).toContainText(
      "You explicitly chose SOL"
    )
  },
  "portfolio-tamagotchi": async (page) => {
    await page.locator("#holdingsInput").fill("BTC:60, ETH:40")
    await page.getByRole("button", { name: "Calculate health" }).click()
    await expect(page.getByText("CALCULATED LOCAL HEALTH", { exact: true })).toBeVisible()
    await expect(page.locator('[data-studio-block="portfolio-care"]')).toContainText(
      "BTC · 60%"
    )
    await expect(page.locator('[data-studio-block="portfolio-care"]')).toContainText(
      "LOCAL CALCULATION HISTORY"
    )
  },
  "crypto-product-hunt": async (page) => {
    await page.locator("#huntName").fill("Proof-of-Reserves Radar")
    await page.locator("#huntTagline").fill("Monitor reserve evidence without hidden claims")
    await page.locator("#huntUrl").fill("https://example.com/proof-of-reserves-radar")
    await page.locator("#huntDescription").fill(
      "A public research product that organizes reserve evidence and links every market claim to its source.",
    )
    await page.locator("#huntCategory").selectOption("research")
    await page.locator('[data-action="submit-product"]').click()
    await expect(page.getByText("Proof-of-Reserves Radar", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: /Upvote 0/ }).click()
    await expect(page.getByRole("button", { name: /Voted 1/ })).toBeVisible()
    await expect(page.getByText("Unreviewed listing", { exact: true })).toBeVisible()
  },
  "crypto-radio": async (page) => {
    await expect(page.locator("[data-story]")).toHaveCount(3)
    await page.getByRole("button", { name: "Play browser brief" }).click()
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible()
    const queuedStory = page.locator("[data-story]").nth(1)
    await expect(queuedStory).toBeVisible()
    await queuedStory.click()
  },
  "crypto-siri": async (page) => {
    await page.locator("#siriInput").fill("How is SOL moving today?")
    await page.getByRole("button", { name: "Ask + speak" }).click()
    await expect(page.locator("#siriAnswer")).toContainText("Solana")
    await expect(page.locator("#siriAnswer")).toContainText("current adapter snapshot")
  },
  "custom-product": async (page) => {
    await expect(page.locator("[data-custom-component]")).not.toHaveCount(0)
    const notes = page.locator("#customNotes")
    const save = page.locator('[data-custom-action="save-local"]')
    if ((await notes.count()) && (await save.count())) {
      await notes.fill("Observable custom workspace state")
      await save.first().click()
      await expect(page.locator(".custom-product-shell")).toContainText("last saved")
    } else {
      await expect(page.locator("[data-custom-action]").first()).toBeVisible()
    }
  },
}

test.describe("compiled product browser contracts", () => {
  for (const presetId of presetIds) {
    test(`${presetId} renders its native standalone product`, async ({ page }) => {
      const { runtime, spec } = await renderStandalone(page, presetId)

      await expectNoSeriousAxeViolations(page, presetId)
      await expectStandaloneUiPolicy(page)
      await expectPrimaryControlsReachable(page, presetId)
      await categoryInteraction[presetId](page)
      await expectPresetBehavior(page, presetId, spec)
      for (const field of contractPresets.find((candidate) => candidate.id === presetId)?.fields ?? []) {
        await expect(page.locator(`[data-config-field="${field.id}"] strong`)).toHaveText(
          spec.values[field.id]
        )
      }
      await expectStandaloneUiPolicy(page)
      await runtime.assertClean()
    })
  }
})

test.describe("crypto game genre contracts", () => {
  const games = [
    { option: "Beat the Market", genre: "market-race", action: "Run market race" },
    { option: "Guess the Coin", genre: "coin-quiz", action: "Choose asset" },
    { option: "Portfolio Battle", genre: "portfolio-battle", action: "Draft asset" },
    { option: "Unlock Dodge", genre: "unlock-dodge", action: "Move left" },
  ] as const

  for (const game of games) {
    test(`${game.option} compiles to a distinct playable runtime`, async ({ page }) => {
      const { runtime, spec } = await renderStandalone(page, "crypto-game", {
        game: game.option,
        assets: "Top 20",
      })

      expect(spec.gameDirection?.genre).toBe(game.genre)
      await expect(page.locator(`[data-game-genre="${game.genre}"]`)).toBeVisible()
      await expect(page.getByRole("button", { name: new RegExp(game.action, "i") }).first()).toBeVisible()

      if (game.genre === "market-race") {
        await page.getByRole("button", { name: "Run market race" }).click()
        await expect(page.locator(".game-native-result")).toContainText("SOL leads")
      } else if (game.genre === "coin-quiz") {
        await page.locator("[data-quiz-choice]").first().click()
        await expect(page.locator(".game-native-result")).toContainText("Correct")
      } else if (game.genre === "portfolio-battle") {
        await page.locator("[data-battle-pick]").nth(0).click()
        await page.locator("[data-battle-pick]").nth(1).click()
        await page.getByRole("button", { name: "Resolve battle" }).click()
        await expect(page.locator(".game-native-result")).toContainText("wins this snapshot")
      }

      await runtime.assertClean()
    })
  }
})

test.describe("crypto aggregator universe contracts", () => {
  test("All coins keeps BTC searchable", async ({ page }) => {
    const { runtime } = await renderStandalone(page, "crypto-aggregator", {
      universe: "All coins",
    })

    await expectNoSeriousAxeViolations(page, "crypto-aggregator")
    await expect(page.locator("#marketSort")).toHaveAccessibleName(/sort|rank|market/i)
    await page.locator("#coinSearch").fill("BTC")
    await expect(page.locator("tbody tr")).toHaveCount(1)
    await expect(page.locator("tbody tr").first()).toContainText("Bitcoin")
    await expect(page.locator("tbody tr").first()).toContainText("$118,420")
    await expectPrimaryControlsReachable(page, "crypto-aggregator")
    await runtime.assertClean()
  })
})
