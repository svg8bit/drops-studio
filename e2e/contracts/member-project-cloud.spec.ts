import type { Page, Route } from "@playwright/test"

import { compileProject } from "../../lib/project-compiler"
import { createProjectSpec } from "../../lib/project-factory"
import { evaluateProjectQuality } from "../../lib/project-quality"
import { fallbackAgentPlan } from "../../lib/product-blueprint"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProjectSpec,
} from "../../lib/project-types"
import type { MemberProjectRecord } from "../../lib/member-project-cloud"
import {
  expect,
  prepareHomePage,
  test,
} from "../fixtures/ui-test"

const REMOTE_PROJECT_ID = "member-cloud-remote-only"
const REMOTE_PROJECT_NAME = "Cloud Morning Alpha"
const UPDATED_PROJECT_NAME = "Cloud Morning Alpha Pro"
const SESSION_ONLY_KEY = "sk-session-only-must-never-sync"
const BUILD_PROMPT = "Build a cloud-synced daily morning alpha brief"

function projectSpec(
  name = REMOTE_PROJECT_NAME,
  createdAt = "2026-07-30T08:00:00.000Z",
): GeneratedProjectSpec {
  return {
    ...createProjectSpec({
      presetId: "morning-alpha",
      values: {},
      prompt: name,
      tools: ["DropsTab market data", "Drops Bot Telegram delivery"],
      provider: "free",
      model: "Free Auto",
      market: [],
      prediction: {
        title: "Waiting for a verified prediction market",
        probability: null,
        change: null,
      },
      origin: "http://127.0.0.1:4173",
    }),
    name,
    createdAt,
  }
}

function remoteProject(): MemberProjectRecord {
  const spec = projectSpec()
  return {
    schemaVersion: 1,
    id: REMOTE_PROJECT_ID,
    revision: 5,
    spec,
    checkpoints: [],
    futureCheckpoints: [],
    conversation: [],
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z",
  }
}

function memberAccessPayload() {
  return {
    access: {
      tier: "member",
      authenticated: true,
      platformAi: {
        available: true,
        limit: 10,
        remaining: 9,
        reset: "daily-utc",
      },
      account: {
        available: true,
        connected: true,
        provider: "openrouter",
        projectSync: true,
      },
    },
  }
}

async function installMemberAccess(page: Page) {
  await page.route("**/api/access", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(memberAccessPayload()),
    })
  })
}

async function fulfillProjectList(
  route: Route,
  projects: MemberProjectRecord[],
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      projects,
      limit: 50,
      materialization: "compile-spec-client-side",
    }),
  })
}

function assertSafeProjectWrite(body: unknown) {
  const serialized = JSON.stringify(body)
  expect(serialized).not.toContain(SESSION_ONLY_KEY)
  expect(serialized).not.toMatch(/<!doctype|<html|compiledhtml/i)

  expect(body).toEqual(
    expect.objectContaining({
      expectedRevision: expect.any(Number),
      project: expect.objectContaining({
        id: expect.any(String),
        spec: expect.any(Object),
        checkpoints: expect.any(Array),
        futureCheckpoints: expect.any(Array),
        conversation: expect.any(Array),
      }),
    }),
  )

  const project = (body as { project: Record<string, unknown> }).project
  expect(project).not.toHaveProperty("html")
  expect(project).not.toHaveProperty("quality")
  expect(project).not.toHaveProperty("publishCapability")
  expect(project.spec).not.toHaveProperty("apiKey")
  expect(project.spec).not.toHaveProperty("key")
}

test("signed-in home restores and opens a remote-only runnable project", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  let remote = remoteProject()

  await installMemberAccess(page)
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillProjectList(route, [remote])
      return
    }
    const body = route.request().postDataJSON() as {
      project: MemberProjectRecord
      expectedRevision: number
    }
    assertSafeProjectWrite(body)
    expect(body.expectedRevision).toBe(remote.revision)
    remote = {
      ...body.project,
      schemaVersion: 1,
      revision: remote.revision + 1,
      createdAt: remote.createdAt,
      updatedAt: new Date().toISOString(),
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: remote }),
    })
  })

  await prepareHomePage(page)

  await expect
    .poll(async () => {
      return page.evaluate(({ key, projectId }) => {
        const stored = window.localStorage.getItem(key)
        const projects = stored ? JSON.parse(stored) : []
        return projects.some(
          (project: { id?: string }) => project.id === projectId,
        )
      }, { key: PROJECTS_STORAGE_KEY, projectId: REMOTE_PROJECT_ID })
    })
    .toBe(true)

  await page.getByRole("button", { name: /My Projects/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Private cloud + browser", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: new RegExp(REMOTE_PROJECT_NAME) }).click()

  await expect(page).toHaveURL(new RegExp(`/studio/${REMOTE_PROJECT_ID}$`))
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
  await expect(page.locator("[data-sync-status='synced']")).toContainText(
    "Saved to cloud",
  )
})

test("a new build keeps its runnable browser copy when cloud sync fails", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  test.setTimeout(90_000)
  let cloudPutCount = 0
  let cloudWrite: unknown = null
  const plan = fallbackAgentPlan(BUILD_PROMPT, "morning-alpha")

  await installMemberAccess(page)
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillProjectList(route, [])
      return
    }
    expect(route.request().method()).toBe("PUT")
    cloudPutCount += 1
    cloudWrite = route.request().postDataJSON()
    assertSafeProjectWrite(cloudWrite)
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PROJECT_SYNC_UNAVAILABLE",
        error: "Cloud project sync is temporarily unavailable.",
      }),
    })
  })
  await page.route("**/api/agent/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan,
        tier: "member",
        remaining: 8,
        access: memberAccessPayload().access,
      }),
    })
  })
  await page.route("**/api/generate", async (route) => {
    const request = route.request().postDataJSON() as {
      spec: GeneratedProjectSpec
    }
    const html = compileProject(request.spec)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: request.spec,
        quality: evaluateProjectQuality(request.spec, html),
        run: { status: "compiled", trace: [] },
      }),
    })
  })

  await prepareHomePage(page)
  await page.evaluate((key) => {
    window.sessionStorage.setItem("drops-studio:openai", key)
  }, SESSION_ONLY_KEY)
  await page.getByLabel("Describe your crypto project").fill(BUILD_PROMPT)
  await page.getByRole("button", { name: "Build now", exact: true }).click()

  await page.waitForURL(/\/studio\/[a-f0-9-]+$/i)
  expect(cloudPutCount).toBe(1)
  expect(cloudWrite).not.toBeNull()

  const projectId = page.url().split("/").at(-1)
  const storedProject = await page.evaluate(
    ({ key, id }) => {
      const stored = window.localStorage.getItem(key)
      const projects = stored ? JSON.parse(stored) : []
      return projects.find((project: { id?: string }) => project.id === id)
    },
    { key: PROJECTS_STORAGE_KEY, id: projectId },
  )
  expect(storedProject).toMatchObject({
    id: projectId,
    spec: { presetId: "morning-alpha" },
  })
  expect(storedProject.html).toMatch(/^<!doctype html>/i)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)
  await expect(page.locator("[data-sync-status='local']")).toContainText(
    "Saved in browser",
  )
})

test("Studio restores a remote-only project and syncs an edit without executable artifacts or keys", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440")
  const remote = remoteProject()
  let currentRevision = remote.revision
  const cloudWrites: Array<{
    project: MemberProjectRecord
    expectedRevision: number
  }> = []

  await page.addInitScript(({ key }) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.sessionStorage.setItem("drops-studio:anthropic", key)
  }, { key: SESSION_ONLY_KEY })
  await installMemberAccess(page)
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillProjectList(route, [remote])
      return
    }
    expect(route.request().method()).toBe("PUT")
    const body = route.request().postDataJSON() as {
      project: MemberProjectRecord
      expectedRevision: number
    }
    assertSafeProjectWrite(body)
    expect(body.expectedRevision).toBe(currentRevision)
    cloudWrites.push(body)
    currentRevision += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project: {
          ...body.project,
          schemaVersion: 1,
          revision: currentRevision,
          createdAt: remote.createdAt,
          updatedAt: new Date().toISOString(),
        },
      }),
    })
  })

  await page.goto(`/studio/${REMOTE_PROJECT_ID}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.getByLabel("Product name")).toHaveValue(REMOTE_PROJECT_NAME)
  await expect(page.locator("[data-sync-status='synced']")).toContainText(
    "Saved to cloud",
  )

  await page.getByLabel("Product name").fill(UPDATED_PROJECT_NAME)
  await page.getByLabel("Product promise").focus()

  await expect.poll(() =>
    cloudWrites.some((write) => write.project.spec.name === UPDATED_PROJECT_NAME)
  ).toBe(true)
  const editWrite = cloudWrites.find(
    (write) => write.project.spec.name === UPDATED_PROJECT_NAME,
  )
  expect(editWrite).toMatchObject({
    project: {
      id: REMOTE_PROJECT_ID,
      spec: { name: UPDATED_PROJECT_NAME },
    },
  })
  await expect(page.locator("[data-sync-status='synced']")).toContainText(
    "Saved to cloud",
  )

  const localName = await page.evaluate(({ key, projectId }) => {
    const stored = window.localStorage.getItem(key)
    const projects = stored ? JSON.parse(stored) : []
    return projects.find(
      (project: { id?: string }) => project.id === projectId,
    )?.spec?.name
  }, { key: PROJECTS_STORAGE_KEY, projectId: REMOTE_PROJECT_ID })
  expect(localName).toBe(UPDATED_PROJECT_NAME)
})
