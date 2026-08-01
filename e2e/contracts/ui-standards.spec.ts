import {
  expect,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"
import type { Page } from "@playwright/test"

type Violation = {
  element: string
  value: number
}

function violationMessage(label: string, violations: Violation[]) {
  const sample = violations
    .slice(0, 50)
    .map((violation) => `${violation.value}px — ${violation.element}`)
    .join("\n")

  return `${label}: ${violations.length}\n${sample}`
}

async function expectUiPolicy(page: Page) {
  const audit = await page.evaluate(() => {
    const describe = (element: Element) => {
      const htmlElement = element as HTMLElement
      const id = htmlElement.id ? `#${htmlElement.id}` : ""
      const classes = [...htmlElement.classList]
        .slice(0, 3)
        .map((name) => `.${name}`)
        .join("")
      const text = (htmlElement.innerText || htmlElement.getAttribute("aria-label") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80)

      return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` \"${text}\"` : ""}`
    }
    const isVisible = (element: Element) => {
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const rect = htmlElement.getBoundingClientRect()

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const hasDirectText = (element: Element) =>
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      )
    const collectFontViolations = (selector: string, minimum: number, directTextOnly: boolean) =>
      [...document.querySelectorAll(selector)]
        .filter((element) => isVisible(element) && (!directTextOnly || hasDirectText(element)))
        .map((element) => ({
          element: describe(element),
          value: Number.parseFloat(getComputedStyle(element).fontSize),
        }))
        .filter((entry) => Number.isFinite(entry.value) && entry.value < minimum)
    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
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
    const controlSelector = [
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='checkbox']",
      "[role='combobox']",
      "[role='menuitem']",
      "[role='option']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
    ].join(",")

    return {
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
      text: collectFontViolations("body *", 12, true),
      bodyCopy: collectFontViolations("p, li, td", 16, false),
      controls: collectFontViolations(controlSelector, 14, false),
      studioLabels: collectFontViolations(".project-studio-shell label", 14, false),
      studioProse: collectFontViolations(".project-studio-shell p", 14, false),
      studioOrdinaryCopy: collectFontViolations(
        [
          ".project-studio-shell .inspector-copy",
          ".project-studio-shell .conversation article > p",
        ].join(","),
        16,
        false
      ),
      targets: [...document.querySelectorAll(interactiveSelector)]
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect()

          return {
            element: describe(element),
            value: Math.min(rect.width, rect.height),
          }
        })
        .filter((entry) => entry.value < 44),
    }
  })

  expect(audit.bodyFontSize, "Body text must be at least 16px").toBeGreaterThanOrEqual(16)
  expect(audit.bodyFontSize, "Body text must be at most 18px").toBeLessThanOrEqual(18)
  expect(audit.text, violationMessage("Text below 12px", audit.text)).toEqual([])
  expect(
    audit.bodyCopy,
    violationMessage("Semantic body copy below 16px", audit.bodyCopy)
  ).toEqual([])
  expect(
    audit.controls,
    violationMessage("Control text below 14px", audit.controls)
  ).toEqual([])
  expect(
    audit.studioLabels,
    violationMessage("Project Studio label below 14px", audit.studioLabels)
  ).toEqual([])
  expect(
    audit.studioProse,
    violationMessage("Project Studio dense prose below 14px", audit.studioProse)
  ).toEqual([])
  expect(
    audit.studioOrdinaryCopy,
    violationMessage(
      "Project Studio ordinary copy below 16px",
      audit.studioOrdinaryCopy
    )
  ).toEqual([])
  expect(
    audit.targets,
    violationMessage("Interactive target below 44x44px", audit.targets)
  ).toEqual([])
}

test("home typography and interactive targets meet the UI policy", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareHomePage(page)
  await expectUiPolicy(page)
  await assertCleanRuntime()
})

test("project studio typography and interactive targets meet the UI policy", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await expectUiPolicy(page)
  await assertCleanRuntime()
})

test("project studio preserves its current workspace architecture", async ({ page }) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)

  const topActions = ["Undo", "Redo", "Run app", "Connections", "Share", "Publish"]
  for (const name of topActions) {
    const action = page.getByRole("button", { name, exact: true }).first()
    await action.scrollIntoViewIfNeeded()
    await expect(action, `${name} must remain accessible`).toBeVisible()
  }

  await expect(page.locator(".studio-rail")).toBeVisible()
  await expect(page.locator(".project-statusbar")).toBeHidden()

  const viewportWidth = page.viewportSize()?.width ?? 0
  if (viewportWidth > 920) {
    await expect(page.locator(".runtime-stage")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeVisible()
    await expect(page.locator(".assistant-panel")).toBeHidden()

    await page.getByRole("button", { name: "Chat", exact: true }).click()
    await expect(page.locator(".assistant-panel")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeHidden()
    await expect(page.locator(".runtime-stage")).toBeVisible()
  } else {
    await expect(page.locator(".studio-inspector")).toBeVisible()
    await expect(page.locator(".assistant-panel")).toBeHidden()
    await expect(page.locator(".runtime-stage")).toBeHidden()

    await page.getByRole("button", { name: "Chat", exact: true }).click()
    await expect(page.locator(".assistant-panel")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeHidden()
    await expect(page.locator(".runtime-stage")).toBeHidden()

    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.locator(".runtime-stage")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeHidden()
    await expect(page.locator(".assistant-panel")).toBeHidden()
  }

  await assertCleanRuntime()
})

test("1920px Project Studio keeps Chat in the left context surface", { tag: "@desktop-only" }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)

  const layout = page.locator(".project-studio-layout")
  const inspector = page.locator(".studio-inspector")
  const canvas = page.locator(".runtime-stage")
  const director = page.locator(".assistant-panel")

  await expect(inspector).toBeVisible()
  await expect(canvas).toBeVisible()
  await expect(director).toBeHidden()

  const initialColumns = await layout.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
  )
  expect(initialColumns, "Wide Project Studio must have rail, context and canvas only").toHaveLength(3)

  const initialInspector = await inspector.boundingBox()
  const initialCanvas = await canvas.boundingBox()
  expect(initialInspector).not.toBeNull()
  expect(initialCanvas).not.toBeNull()
  expect(initialInspector!.x + initialInspector!.width).toBeLessThanOrEqual(initialCanvas!.x + 1)

  await page.getByRole("button", { name: "Chat", exact: true }).click()
  await expect(director).toBeVisible()
  await expect(inspector).toBeHidden()
  await expect(canvas).toBeVisible()

  const directorBox = await director.boundingBox()
  const directorCanvas = await canvas.boundingBox()
  expect(directorBox).not.toBeNull()
  expect(directorCanvas).not.toBeNull()
  expect(directorBox!.x).toBeCloseTo(initialInspector!.x, 0)
  expect(directorBox!.width).toBeCloseTo(initialInspector!.width, 0)
  expect(directorCanvas!.x).toBeCloseTo(initialCanvas!.x, 0)
  expect(directorCanvas!.width).toBeCloseTo(initialCanvas!.width, 0)
  expect(directorBox!.x + directorBox!.width).toBeLessThanOrEqual(directorCanvas!.x + 1)

  await assertCleanRuntime()
})
