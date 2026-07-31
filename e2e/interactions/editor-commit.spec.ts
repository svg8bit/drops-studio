import {
  expect,
  installRuntimeGuards,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"
import { PROJECTS_STORAGE_KEY } from "../../lib/project-types"
import { validateEditableRuntimeHtml } from "../../lib/source-workspace"

const PROJECT_ID = "ui-quality-current-crypto-game"

async function storedProjectValue<T>(
  page: Parameters<typeof prepareStudioPage>[0],
  read: "name" | "roundSeconds",
): Promise<T> {
  return page.evaluate(
    ({ key, projectId, field }) => {
      const projects = JSON.parse(window.localStorage.getItem(key) || "[]") as Array<{
        id: string
        spec: {
          name: string
          gameDirection?: { roundSeconds: number }
        }
      }>
      const project = projects.find((item) => item.id === projectId)
      if (!project) throw new Error("Seeded project was not persisted")
      return (field === "name"
        ? project.spec.name
        : project.spec.gameDirection?.roundSeconds) as T
    },
    { key: PROJECTS_STORAGE_KEY, projectId: PROJECT_ID, field: read },
  )
}

test("controlled text and number edits commit once and survive reload", async ({
  page,
}) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  await prepareStudioPage(page)

  const iframe = page.locator("iframe[title$='live application']")
  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes("data:image/png;base64"))
    .toBe(true)

  await page.evaluate(() => {
    const state = window as typeof window & {
      __studioIframeRemounts?: number
      __studioIframeObserver?: MutationObserver
    }
    state.__studioIframeRemounts = 0
    state.__studioIframeObserver?.disconnect()
    state.__studioIframeObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof HTMLIFrameElement ||
            (node instanceof Element && node.querySelector("iframe"))
          )
            state.__studioIframeRemounts =
              (state.__studioIframeRemounts ?? 0) + 1
        }
      }
    })
    state.__studioIframeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })
  })

  const remounts = () =>
    page.evaluate(
      () =>
        (window as typeof window & { __studioIframeRemounts?: number })
          .__studioIframeRemounts ?? 0,
    )

  await page.getByRole("button", { name: "Design", exact: true }).click()
  const nameInput = page.getByLabel("Product name")
  const originalName = await storedProjectValue<string>(page, "name")
  const originalSrcdoc = await iframe.getAttribute("srcdoc")
  const finalName = "Debounced Alpha Lab"

  await nameInput.fill("")
  await nameInput.pressSequentially(finalName, { delay: 10 })
  await expect(nameInput).toHaveValue(finalName)
  expect(await remounts(), "typing must not remount the runtime").toBe(0)
  expect(await storedProjectValue<string>(page, "name")).toBe(originalName)
  expect(await iframe.getAttribute("srcdoc")).toBe(originalSrcdoc)

  await nameInput.blur()
  await expect.poll(remounts).toBe(1)
  await expect.poll(() => storedProjectValue<string>(page, "name")).toBe(finalName)
  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes(finalName))
    .toBe(true)
  await page.waitForTimeout(500)
  expect(await remounts(), "blur must cancel the pending debounce").toBe(1)

  await page.getByRole("button", { name: "Design", exact: true }).click()
  const roundTimer = page.getByRole("spinbutton", {
    name: "Round timer",
    exact: true,
  })
  const originalRoundSeconds = await storedProjectValue<number>(
    page,
    "roundSeconds",
  )

  await roundTimer.selectText()
  await roundTimer.pressSequentially("47", { delay: 20 })
  await expect(roundTimer).toHaveValue("47")
  expect(await remounts(), "number typing must not remount the runtime").toBe(1)
  expect(await storedProjectValue<number>(page, "roundSeconds")).toBe(
    originalRoundSeconds,
  )

  await roundTimer.blur()
  await expect.poll(remounts).toBe(2)
  await expect
    .poll(() => storedProjectValue<number>(page, "roundSeconds"))
    .toBe(47)
  await page.waitForTimeout(500)
  expect(await remounts(), "number blur must cancel the pending debounce").toBe(2)

  const savedProjects = await page.evaluate((key) => {
    const value = window.localStorage.getItem(key)
    if (!value) throw new Error("Committed project is missing from storage")
    return value
  }, PROJECTS_STORAGE_KEY)
  const restoredPage = await page.context().newPage()
  const assertRestoredCleanRuntime = installRuntimeGuards(restoredPage)
  await restoredPage.goto("/", { waitUntil: "domcontentloaded" })
  await restoredPage.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: PROJECTS_STORAGE_KEY, value: savedProjects },
  )
  await restoredPage.goto(`/studio/${PROJECT_ID}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(restoredPage.getByLabel("Product name")).toHaveValue(finalName)
  await restoredPage
    .getByRole("button", { name: "Design", exact: true })
    .click()
  await expect(
    restoredPage.getByRole("spinbutton", {
      name: "Round timer",
      exact: true,
    }),
  ).toHaveValue("47")
  const restoredIframe = restoredPage.locator(
    "iframe[title$='live application']",
  )
  await expect
    .poll(async () => {
      const srcdoc = await restoredIframe.getAttribute("srcdoc")
      return Boolean(
        srcdoc?.includes(finalName) && srcdoc.includes('"roundSeconds":47'),
      )
    })
    .toBe(true)

  await assertCleanRuntime()
  await assertRestoredCleanRuntime()
  await restoredPage.close()
})

test("validated index.html edits update the runtime and survive undo, redo and reload", async ({
  page,
}) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  await prepareStudioPage(page)

  await page
    .locator(".studio-rail")
    .getByRole("button", { name: "Code", exact: true })
    .click()
  await page.getByRole("button", { name: /index\.html editable/i }).click()

  const dialog = page.getByRole("dialog", { name: "Owned source workspace" })
  const editor = dialog.getByLabel("Editable runnable HTML")
  const originalSource = await editor.inputValue()
  const marker = '<aside data-source-e2e="true">Manual source is live</aside>'
  const editedSource = originalSource.replace("</body>", `${marker}</body>`)
  await editor.fill(editedSource)
  await dialog.getByRole("button", { name: "Validate & apply" }).click()

  const iframe = page.locator("iframe[title$='live application']")
  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes(marker))
    .toBe(true)
  await expect(page.getByText(/preview updated and checkpoint created/i)).toBeVisible()
  await dialog.getByRole("button", { name: "Close source workspace" }).click()

  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes(marker))
    .toBe(false)

  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled()
  await page.getByRole("button", { name: "Redo" }).click()
  await expect
    .poll(async () => (await iframe.getAttribute("srcdoc"))?.includes(marker))
    .toBe(true)

  await expect
    .poll(() =>
      page.evaluate(
        ({ key, projectId }) => {
          const projects = JSON.parse(
            window.localStorage.getItem(key) || "[]",
          ) as Array<{ id?: string; html?: string; sourceEditedAt?: string }>
          const saved = projects.find((item) => item.id === projectId)
          return Boolean(
            saved?.sourceEditedAt &&
              String(saved.html || "").includes('data-source-e2e="true"'),
          )
        },
        { key: PROJECTS_STORAGE_KEY, projectId: PROJECT_ID },
      ),
    )
    .toBe(true)

  const storedSourceBeforeReload = await page.evaluate(
    ({ key, projectId }) =>
      JSON.parse(window.localStorage.getItem(key) || "[]").find(
        (item: { id?: string }) => item.id === projectId,
      ),
    { key: PROJECTS_STORAGE_KEY, projectId: PROJECT_ID },
  )
  expect(
    validateEditableRuntimeHtml(
      storedSourceBeforeReload.spec,
      storedSourceBeforeReload.html,
    ),
  ).toEqual({ valid: true, issues: [] })

  await page.reload({ waitUntil: "domcontentloaded" })
  const restoredIframe = page.locator("iframe[title$='live application']")
  await expect
    .poll(async () =>
      (await restoredIframe.getAttribute("srcdoc"))?.includes(marker),
    )
    .toBe(true)

  const savedSourceState = await page.evaluate(
    ({ key, projectId }) => {
      const projects = JSON.parse(window.localStorage.getItem(key) || "[]")
      const project = projects.find(
        (item: { id?: string }) => item.id === projectId,
      )
      return {
        sourceEditedAt: project?.sourceEditedAt,
        hasMarker: String(project?.html || "").includes(
          'data-source-e2e="true"',
        ),
      }
    },
    { key: PROJECTS_STORAGE_KEY, projectId: PROJECT_ID },
  )
  expect(savedSourceState.sourceEditedAt).toBeTruthy()
  expect(savedSourceState.hasMarker).toBe(true)
  await assertCleanRuntime()
})
