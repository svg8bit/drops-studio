import {
  expect,
  installRuntimeGuards,
  prepareStudioPage,
  storedProjectForCurrentActor,
  test,
} from "../fixtures/ui-test"
import { prepareProjectV2UiPage } from "../fixtures/project-v2-ui-test"

const PROJECT_ID = "ui-quality-current-crypto-game"

async function storedProjectValue<T>(
  page: Parameters<typeof prepareStudioPage>[0],
  read: "name" | "roundSeconds",
): Promise<T> {
  const project = await storedProjectForCurrentActor(page, PROJECT_ID)
  return (read === "name"
    ? project.spec.name
    : project.spec.gameDirection?.roundSeconds) as T
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

  const restoredPage = await page.context().newPage()
  const assertRestoredCleanRuntime = installRuntimeGuards(restoredPage)
  await restoredPage.goto(`/studio/${PROJECT_ID}`, {
    waitUntil: "domcontentloaded",
  })
  await restoredPage
    .getByRole("button", { name: "Design", exact: true })
    .click()
  await expect(restoredPage.getByLabel("Product name")).toHaveValue(finalName)
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

test("Project V2 source edits persist through the real Code workspace and reload", async ({
  page,
}) => {
  const assertCleanRuntime = installRuntimeGuards(page)
  const { project } = await prepareProjectV2UiPage(page)
  const workspace = page.getByTestId("project-v2-workspace")
  await expect(workspace).toBeVisible()
  await page.locator('button[title="app/page.tsx"]').click()
  const editor = page.locator(".cm-content")
  const marker = "// SOURCE-E2E-PERSISTED"
  const originalSource = await editor.textContent()
  await editor.click()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type(`${marker}\n${originalSource ?? ""}`, { delay: 1 })
  await expect(workspace.getByText("Unsaved changes", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Save", exact: true }).click()
  await expect(workspace.getByText("Saved", { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const stored = await storedProjectForCurrentActor(page, project.id)
    return stored.projectV2?.files?.["app/page.tsx"]?.content ?? ""
  }).toContain(marker)

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator(".studio-rail").getByRole("button", { name: "Code", exact: true }).click()
  await page.locator('button[title="app/page.tsx"]').click()
  await expect(page.locator(".cm-content")).toContainText(marker)
  await assertCleanRuntime()
})
