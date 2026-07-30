import { existsSync } from "node:fs"
import { Script } from "node:vm"

import {
  expect,
  test,
  type Page,
  type TestInfo,
} from "@playwright/test"

import { compileProject } from "../../lib/project-compiler"
import { createProjectSpec } from "../../lib/project-factory"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProject,
} from "../../lib/project-types"

export { expect, test }

async function settlePage(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

async function expectInlineScriptsToParse(page: Page) {
  const srcdoc = await page.locator("iframe[title$='live application']").getAttribute("srcdoc")
  expect(srcdoc, "Project Studio must render a compiled application").toBeTruthy()

  const scripts = [
    ...(srcdoc ?? "").matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi),
  ].filter(
    (match) =>
      !/type=["'](?:application\/(?:ld\+)?json|module)["']/i.test(match[1])
  )

  expect(scripts.length, "Compiled application must contain runtime JavaScript").toBeGreaterThan(0)
  for (const [index, match] of scripts.entries()) {
    try {
      new Script(match[2], {
        filename: `compiled-project-inline-${index + 1}.js`,
      })
    } catch (error) {
      throw new Error(
        `Compiled project inline script ${index + 1} is invalid:\n${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }`
      )
    }
  }
}

export async function prepareHomePage(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) return
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("h1").first()).toBeVisible()
  await settlePage(page)
}

export async function prepareStudioPage(page: Page) {
  const timestamp = "2026-07-29T12:00:00.000Z"
  const id = "ui-quality-current-crypto-game"
  const generatedSpec = createProjectSpec({
    presetId: "crypto-game",
    values: {
      game: "Unlock Dodge",
    },
    prompt: "Crypto Game",
    tools: ["DropsTab market data", "Drops Bot action handoff"],
    provider: "free",
    model: "Free Auto",
    market: [
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
        change: 1.6,
        marketCap: "$456B",
      },
    ],
    prediction: {
      title: "Bitcoin above $120k this month",
      probability: 64,
      change: 3,
    },
    origin: "http://127.0.0.1:4173",
  })
  const spec = { ...generatedSpec, createdAt: timestamp }
  const project: GeneratedProject = {
    id,
    spec,
    html: compileProject(spec),
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await page.addInitScript(
    ({ key, value }) => {
      if (window.top !== window) return
      const seedKey = "drops-studio:e2e-project-seeded"
      if (window.sessionStorage.getItem(seedKey) === "1") return
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(key, value)
      window.sessionStorage.setItem(seedKey, "1")
    },
    {
      key: PROJECTS_STORAGE_KEY,
      value: JSON.stringify([project]),
    }
  )
  await page.goto(`/studio/${id}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
  await expectInlineScriptsToParse(page)
  await page.getByRole("button", { name: "Design", exact: true }).click()
  await expect(page.getByText("Design Canvas", { exact: true })).toBeVisible()
  await settlePage(page)
}

export function installRuntimeGuards(page: Page) {
  const failures: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location()
      const source = location.url
        ? ` @ ${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
        : ""
      failures.push(`console.error: ${message.text()}${source}`)
    }
  })
  page.on("pageerror", (error) => {
    const stack = error.stack
      ?.split("\n")
      .slice(1, 3)
      .map((line) => line.trim())
      .join(" | ")
    failures.push(`pageerror: ${error.message}${stack ? ` @ ${stack}` : ""}`)
  })

  return async function assertCleanRuntime() {
    await expectNoHorizontalOverflow(page)
    expect(failures, failures.join("\n")).toEqual([])
  }
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body

    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
    }
  })

  expect(
    overflow.rootScrollWidth,
    `documentElement overflows horizontally: ${JSON.stringify(overflow)}`
  ).toBeLessThanOrEqual(overflow.rootClientWidth)
  expect(
    overflow.bodyScrollWidth,
    `body overflows horizontally: ${JSON.stringify(overflow)}`
  ).toBeLessThanOrEqual(overflow.bodyClientWidth)

  const iframe = page.locator("iframe[title$='live application']").first()
  if ((await iframe.count()) === 0) return
  const iframeHandle = await iframe.elementHandle()
  const productFrame = await iframeHandle?.contentFrame()
  if (!productFrame) return

  const productOverflow = await productFrame.evaluate(() => {
    const root = document.documentElement
    const body = document.body

    return {
      viewportWidth: window.innerWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
    }
  })

  expect(
    productOverflow.rootScrollWidth,
    `live-product documentElement overflows horizontally: ${JSON.stringify(productOverflow)}`
  ).toBeLessThanOrEqual(productOverflow.rootClientWidth)
  expect(
    productOverflow.bodyScrollWidth,
    `live-product body overflows horizontally: ${JSON.stringify(productOverflow)}`
  ).toBeLessThanOrEqual(productOverflow.bodyClientWidth)
  if (page.viewportSize()?.width === 390) {
    expect(
      productOverflow.viewportWidth,
      "The live product must be evaluated inside the 390px Project Studio viewport"
    ).toBeLessThanOrEqual(390)
  }
}

export function requireApprovedSnapshot(testInfo: TestInfo, name: string) {
  const snapshotPath = testInfo.snapshotPath(name)

  if (
    !existsSync(snapshotPath) &&
    process.env.VISUAL_BASELINE_APPROVED !== "1"
  ) {
    throw new Error(
      `Approved visual baseline is missing: ${snapshotPath}. Do not generate it automatically; obtain explicit approval, then create it with VISUAL_BASELINE_APPROVED=1.`
    )
  }
}
