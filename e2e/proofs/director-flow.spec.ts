import { mkdir } from "node:fs/promises"

import type { Page } from "@playwright/test"

import { compileProject } from "../../lib/project-compiler"
import { createFreeDirectorProposal } from "../../lib/project-director"
import { createProjectSpec } from "../../lib/project-factory"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProject,
  type GeneratedProjectSpec,
} from "../../lib/project-types"
import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  test,
} from "../fixtures/ui-test"

const PROJECT_ID = "director-proof-crypto-game"
const DIRECTOR_REQUEST =
  "Give it a green accent and pixel art. Set round timer 47 seconds and expert difficulty. Rename to PIXEL"
const EXPECTED_NAME = "PIXEL"

function directorProofProject(): GeneratedProject {
  const timestamp = "2026-07-30T09:00:00.000Z"
  const generatedSpec = createProjectSpec({
    presetId: "crypto-game",
    values: { game: "Unlock Dodge" },
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

  return {
    id: PROJECT_ID,
    spec,
    html: compileProject(spec),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function openSeededDirectorProject(page: Page) {
  const project = directorProofProject()

  await page.addInitScript(
    ({ key, projectId, value }) => {
      if (window.top !== window) return
      const seedMarker = `drops-studio:test-seeded:${projectId}`
      if (window.sessionStorage.getItem(seedMarker) === "1") return

      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(key, value)
      window.sessionStorage.setItem(seedMarker, "1")
    },
    {
      key: PROJECTS_STORAGE_KEY,
      projectId: PROJECT_ID,
      value: JSON.stringify([project]),
    },
  )

  await page.goto(`/studio/${PROJECT_ID}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
}

async function storedDirectorProject(page: Page) {
  return page.evaluate(
    ({ key, projectId }) => {
      const projects = JSON.parse(
        window.localStorage.getItem(key) || "[]",
      ) as GeneratedProject[]
      const project = projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new Error("Director proof project is missing")
      return project
    },
    { key: PROJECTS_STORAGE_KEY, projectId: PROJECT_ID },
  )
}

function expectAppliedDirectorSpec(spec: GeneratedProjectSpec) {
  expect(spec.name).toBe(EXPECTED_NAME)
  expect(spec.theme.accent).toBe("#23d59b")
  expect(spec.design.kit).toBe("neon-arena")
  expect(spec.gameDirection).toMatchObject({
    artStyle: "pixel",
    world: "cyber-arcade",
    difficulty: "expert",
    roundSeconds: 47,
  })
}

test("Free Director proposes, applies and restores a compiled checkpoint", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  const captureDirectory = "outputs/proofs/director"
  const plannedSpec = createFreeDirectorProposal(
    directorProofProject().spec,
    DIRECTOR_REQUEST,
  ).spec
  const plan = {
    presetId: plannedSpec.presetId,
    name: plannedSpec.name,
    tagline: plannedSpec.tagline,
    description: plannedSpec.description,
    tools: plannedSpec.tools,
    blueprint: plannedSpec.blueprint,
    theme: plannedSpec.theme,
    design: plannedSpec.design,
    experience: plannedSpec.experience,
    gameDirection: plannedSpec.gameDirection,
    model: "Free Director proof",
    provider: "free",
  }

  await page.route("**/api/agent/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan, model: "Free Director proof" }),
    })
  })
  await openSeededDirectorProject(page)

  const iframe = page.locator("iframe[title$='live application']")
  const runtime = page.frameLocator("iframe[title$='live application']")
  const showPreviewOnMobile = async () => {
    if (testInfo.project.name !== "chromium-390") return
    await page.locator(".mobile-preview-tab").click()
    await expect(iframe).toBeVisible()
  }
  const initialSrcdoc = await iframe.getAttribute("srcdoc")
  expect(initialSrcdoc).toContain("Crypto Game")
  await showPreviewOnMobile()
  await expect(runtime.getByText("Crypto Game", { exact: true }).first()).toBeVisible()

  await page.getByRole("button", { name: "Director", exact: true }).click()
  const composer = page.locator(".chat-composer textarea")
  await expect(composer).toBeVisible()
  await composer.fill(DIRECTOR_REQUEST)
  await page.getByRole("button", { name: "Send change request" }).click()

  const proposal = page.locator(".proposal-card")
  await expect(proposal).toBeVisible()
  await expect(proposal).toContainText("Free Director proof change set")
  await expect(proposal).toContainText("native screens")
  await expect(proposal).toContainText("working interactions")
  await expect(proposal).toContainText("DropsTab evidence")

  await mkdir(captureDirectory, { recursive: true })
  await proposal.screenshot({
    path: `${captureDirectory}/proposal-${testInfo.project.name}.png`,
  })

  await proposal.getByRole("button", { name: "Apply changes" }).click()
  await expect(proposal).toHaveCount(0)
  await expect(page.getByText("Applied as a new checkpoint.")).toBeVisible()

  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes(EXPECTED_NAME))
    .toBe(true)
  expect(await iframe.getAttribute("srcdoc")).not.toBe(initialSrcdoc)
  await showPreviewOnMobile()
  await expect(runtime.getByText(EXPECTED_NAME, { exact: true }).first()).toBeVisible()

  const applied = await storedDirectorProject(page)
  expectAppliedDirectorSpec(applied.spec)
  expect(applied.checkpoints).toHaveLength(2)
  expect(applied.checkpoints?.at(-1)).toMatchObject({
    source: "director",
    label: "Free Director proof change set",
  })

  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  const restoredIframe = page.locator("iframe[title$='live application']")
  const restoredRuntime = page.frameLocator("iframe[title$='live application']")
  await expect
    .poll(async () =>
      (await restoredIframe.getAttribute("srcdoc"))?.includes(EXPECTED_NAME),
    )
    .toBe(true)
  await showPreviewOnMobile()
  await expect(
    restoredRuntime.getByText(EXPECTED_NAME, { exact: true }).first(),
  ).toBeVisible()

  const restored = await storedDirectorProject(page)
  expectAppliedDirectorSpec(restored.spec)
  expect(restored.checkpoints).toHaveLength(2)
  expect(restored.conversation?.at(-1)?.content).toContain(
    "Applied as a new checkpoint.",
  )

  await page.getByRole("button", { name: "Versions", exact: true }).click()
  const checkpoints = page.locator(".checkpoint-list > button")
  await expect(checkpoints).toHaveCount(2)
  await expect(checkpoints.first()).toContainText(
    "Free Director proof change set",
  )

  await page.getByRole("button", { name: "Director", exact: true }).click()
  await expect(page.getByText("Applied as a new checkpoint.")).toBeVisible()
  if (testInfo.project.name === "chromium-390") {
    await page.locator(".mobile-preview-tab").click()
    const runtimeReady = page.locator('[data-runtime-ready="true"]')
    await expect(runtimeReady).toContainText("Browser telemetry")
    await expect(runtimeReady).toBeVisible()
    await expect(runtimeReady).toBeInViewport()
  }
  await expectNoHorizontalOverflow(page)
  await assertCleanRuntime()

  if (testInfo.project.name === "chromium-390") {
    await page.screenshot({
      path: `${captureDirectory}/applied-reloaded-${testInfo.project.name}-viewport.png`,
    })
  }
  await page.screenshot({
    path: `${captureDirectory}/applied-reloaded-${testInfo.project.name}.png`,
    fullPage: true,
  })
})
