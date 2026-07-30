import type { Locator, Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"

import { compileProject } from "../../lib/project-compiler"
import { createProjectSpec } from "../../lib/project-factory"
import { presets } from "../../lib/presets"
import {
  PROJECTS_STORAGE_KEY,
  type GeneratedProject,
} from "../../lib/project-types"
import {
  expect,
  expectNoHorizontalOverflow,
  installRuntimeGuards,
  prepareHomePage,
  prepareStudioPage,
  test,
} from "../fixtures/ui-test"

async function expectImagesLoaded(locator: Locator) {
  await expect(locator.first()).toBeVisible()
  await expect
    .poll(async () =>
      locator.evaluateAll((images) =>
        images.every((image) => {
          const candidate = image as HTMLImageElement

          return (
            candidate.complete &&
            candidate.naturalWidth > 0 &&
            candidate.naturalHeight > 0
          )
        })
      )
    )
    .toBe(true)
}

async function prepareMorningAlphaStudioPage(page: Page) {
  const timestamp = "2026-07-30T12:00:00.000Z"
  const id = "responsive-contract-morning-alpha"
  const preset = presets.find((candidate) => candidate.id === "morning-alpha")
  if (!preset) throw new Error("Morning Alpha preset is missing")

  const generatedSpec = createProjectSpec({
    presetId: preset.id,
    values: Object.fromEntries(
      preset.fields.map((field) => [field.id, field.value])
    ),
    prompt: "Morning Alpha responsive runtime contract",
    tools: preset.tools,
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
        change: -1.2,
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
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(key, value)
    },
    {
      key: PROJECTS_STORAGE_KEY,
      value: JSON.stringify([project]),
    }
  )
  await page.goto(`/studio/${id}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("main")).toHaveClass(/project-studio-shell/)
  await expect(page.locator("iframe[title$='live application']")).toHaveCount(1)

  if ((page.viewportSize()?.width ?? 0) <= 920) {
    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.locator(".runtime-stage")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeHidden()
    await expect(page.locator(".assistant-panel")).toBeHidden()
  }

  const runtime = page.frameLocator("iframe[title$='live application']")
  await expect(runtime.locator(".module-strip")).toBeVisible()
  await expect(runtime.getByText("Catalysts", { exact: true })).toHaveCount(1)
  await expect(runtime.getByText("Action list", { exact: true })).toHaveCount(1)
}

async function selectEditableCanvasElement(page: Page) {
  if ((page.viewportSize()?.width ?? 0) <= 920) {
    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.locator(".runtime-stage")).toBeVisible()
    await expect(page.locator(".studio-inspector")).toBeHidden()
    await expect(page.locator(".assistant-panel")).toBeHidden()
  }

  const frame = page.frameLocator("iframe[title$='live application']")
  const body = frame.locator("body")
  await expect(
    frame.locator("[data-game-genre], [data-studio-element]").first(),
    "The working product must finish rendering before Design Mode is enabled"
  ).toBeVisible({ timeout: 20_000 })
  if (!(await body.evaluate((element) => element.classList.contains("studio-designing")))) {
    await page
      .getByRole("button", { name: "Design mode", exact: true })
      .click()
  }
  await expect(body).toHaveClass(/studio-designing/)

  const headingId = await frame
    .locator(
      "h1[data-studio-element][data-text-editable='true'], h2[data-studio-element][data-text-editable='true'], h3[data-studio-element][data-text-editable='true']"
    )
    .evaluateAll((headings) => {
      const visible = headings.filter((heading) => {
        const rect = heading.getBoundingClientRect()
        const style = getComputedStyle(heading)

        return style.display !== "none" && rect.width > 0 && rect.height > 0
      })
      visible.sort(
        (left, right) =>
          (right.textContent?.trim().length ?? 0) -
          (left.textContent?.trim().length ?? 0)
      )

      return (visible[0] as HTMLElement | undefined)?.dataset.studioElement || ""
    })
  expect(headingId, "Expected a visible editable product heading").not.toBe("")
  const editableHeading = frame.locator(`[data-studio-element="${headingId}"]`)
  await expect(editableHeading).toBeVisible()
  const headingText = await editableHeading.evaluate((heading) =>
    String(heading.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
  )
  expect(headingText, "Expected the editable heading to contain text").not.toBe("")
  await editableHeading.click()
  await expect(page.locator(".element-inspector")).toBeVisible()

  return headingText
}

async function expectSelectedInspectorToUseEditingGrid(page: Page) {
  const grid = page.locator(".element-control-grid")
  await expect(grid).toBeVisible()
  const columns = await grid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns
      .split(" ")
      .filter(Boolean)
  )

  expect(
    columns.length,
    "Release viewports must keep a useful two-column editing grid"
  ).toBeGreaterThanOrEqual(2)
}

async function expectStudioChromeToStaySeparated(page: Page) {
  const viewportWidth = page.viewportSize()?.width ?? 0
  const surfaces = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(".studio-rail")
    const status = document.querySelector<HTMLElement>(".project-statusbar")
    const layout = document.querySelector<HTMLElement>(".project-studio-layout")
    if (!rail || !status || !layout) return null

    const railRect = rail.getBoundingClientRect()
    const statusRect = status.getBoundingClientRect()
    const layoutRect = layout.getBoundingClientRect()

    return {
      railBottom: railRect.bottom,
      railTop: railRect.top,
      railPosition: getComputedStyle(rail).position,
      statusDisplay: getComputedStyle(status).display,
      statusTop: statusRect.top,
      statusBottom: statusRect.bottom,
      layoutBottom: layoutRect.bottom,
      viewportHeight: window.innerHeight,
    }
  })
  expect(surfaces).not.toBeNull()

  if (viewportWidth <= 920) {
    expect(surfaces!.statusDisplay).not.toBe("none")
    expect(surfaces!.railPosition).toBe("fixed")
    expect(Math.abs(surfaces!.railBottom - surfaces!.viewportHeight)).toBeLessThanOrEqual(1)
    expect(surfaces!.statusBottom).toBeLessThanOrEqual(surfaces!.railTop + 1)
    return
  }

  expect(surfaces!.statusDisplay).not.toBe("none")
  expect(surfaces!.layoutBottom).toBeLessThanOrEqual(surfaces!.statusTop + 1)
}

async function expectStatusbarItemsToFit(page: Page) {
  const geometry = await page.locator(".project-statusbar").evaluate((statusbar) => {
    const barRect = statusbar.getBoundingClientRect()
    const items = [...statusbar.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .filter((child) => {
        const style = getComputedStyle(child)
        const rect = child.getBoundingClientRect()

        return style.display !== "none" && rect.width > 0 && rect.height > 0
      })
      .map((item, index) => {
        const rect = item.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(item)
        const contentRect = range.getBoundingClientRect()

        return {
          index,
          text: item.innerText.trim().replace(/\s+/g, " "),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          clientWidth: item.clientWidth,
          scrollWidth: item.scrollWidth,
          clientHeight: item.clientHeight,
          scrollHeight: item.scrollHeight,
          contentLeft: contentRect.left,
          contentRight: contentRect.right,
          contentTop: contentRect.top,
          contentBottom: contentRect.bottom,
        }
      })

    const overlaps: Array<{ first: string; second: string }> = []
    for (let first = 0; first < items.length; first += 1) {
      for (let second = first + 1; second < items.length; second += 1) {
        const horizontal = Math.min(items[first].contentRight, items[second].contentRight) -
          Math.max(items[first].contentLeft, items[second].contentLeft)
        const vertical = Math.min(items[first].contentBottom, items[second].contentBottom) -
          Math.max(items[first].contentTop, items[second].contentTop)
        if (horizontal > 1 && vertical > 1) {
          overlaps.push({
            first: items[first].text,
            second: items[second].text,
          })
        }
      }
    }

    return {
      bar: {
        left: barRect.left,
        right: barRect.right,
        top: barRect.top,
        bottom: barRect.bottom,
        clientWidth: statusbar.clientWidth,
        scrollWidth: statusbar.scrollWidth,
        clientHeight: statusbar.clientHeight,
        scrollHeight: statusbar.scrollHeight,
      },
      items,
      overlaps,
    }
  })

  expect(geometry.items, "1024px statusbar must render all five statuses").toHaveLength(5)
  expect(
    geometry.bar.scrollWidth,
    `Statusbar overflows horizontally: ${JSON.stringify(geometry, null, 2)}`
  ).toBeLessThanOrEqual(geometry.bar.clientWidth + 1)
  expect(
    geometry.bar.scrollHeight,
    `Statusbar is vertically clamped: ${JSON.stringify(geometry, null, 2)}`
  ).toBeLessThanOrEqual(geometry.bar.clientHeight + 1)
  expect(geometry.overlaps, JSON.stringify(geometry, null, 2)).toEqual([])

  for (const item of geometry.items) {
    const context = `${item.index}: ${item.text}`
    expect(item.left, `${context} starts outside the statusbar`).toBeGreaterThanOrEqual(
      geometry.bar.left - 1
    )
    expect(item.right, `${context} ends outside the statusbar`).toBeLessThanOrEqual(
      geometry.bar.right + 1
    )
    expect(item.top, `${context} starts above the statusbar`).toBeGreaterThanOrEqual(
      geometry.bar.top - 1
    )
    expect(item.bottom, `${context} ends below the statusbar`).toBeLessThanOrEqual(
      geometry.bar.bottom + 1
    )
    expect(item.scrollWidth, `${context} is horizontally clamped`).toBeLessThanOrEqual(
      item.clientWidth + 1
    )
    expect(item.scrollHeight, `${context} is vertically clamped`).toBeLessThanOrEqual(
      item.clientHeight + 1
    )
    expect(item.contentLeft, `${context} content escapes its cell`).toBeGreaterThanOrEqual(
      item.left - 1
    )
    expect(item.contentRight, `${context} content escapes its cell`).toBeLessThanOrEqual(
      item.right + 1
    )
    expect(item.contentTop, `${context} content escapes its cell`).toBeGreaterThanOrEqual(
      item.top - 1
    )
    expect(item.contentBottom, `${context} content escapes its cell`).toBeLessThanOrEqual(
      item.bottom + 1
    )
  }
}

async function expectDirectorToStartReadable(page: Page) {
  await page.getByRole("button", { name: "Director", exact: true }).click()
  const panel = page.locator(".assistant-panel")
  const conversation = panel.locator(".conversation")
  const guide = panel.locator(".assistant-guide")
  await expect(panel).toBeVisible()
  await expect(guide).toBeVisible()
  await expect.poll(() => conversation.evaluate((element) => element.scrollTop)).toBe(0)

  const geometry = await panel.evaluate((element) => {
    const conversation = element.querySelector<HTMLElement>(".conversation")!
    const guide = element.querySelector<HTMLElement>(".assistant-guide")!
    const promptBox = element.querySelector<HTMLElement>(".quick-prompts")!
    const composer = element.querySelector<HTMLElement>(".chat-composer")!
    const panelRect = element.getBoundingClientRect()
    const conversationRect = conversation.getBoundingClientRect()
    const guideRect = guide.getBoundingClientRect()
    const composerRect = composer.getBoundingClientRect()

    return {
      guideTop: guideRect.top,
      conversationTop: conversationRect.top,
      composerBottom: composerRect.bottom,
      panelBottom: panelRect.bottom,
      promptOverflowY: getComputedStyle(promptBox).overflowY,
      clippedPrompts: [...promptBox.querySelectorAll<HTMLElement>("button")]
        .filter(
          (button) =>
            button.scrollWidth > button.clientWidth + 1 ||
            button.scrollHeight > button.clientHeight + 1
        )
        .map((button) => button.innerText),
    }
  })

  expect(geometry.guideTop).toBeGreaterThanOrEqual(geometry.conversationTop - 1)
  expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.panelBottom + 1)
  expect(geometry.promptOverflowY).toBe("auto")
  expect(geometry.clippedPrompts).toEqual([])
}

async function expectSelectedInspectorToPreserveText(
  page: Page,
  headingText: string
) {
  await expect(page.locator(".element-inspector-head > strong")).toHaveText(
    headingText
  )
  await expect(page.locator(".element-inspector textarea")).toHaveValue(
    headingText
  )
}

async function expectInspectorTextToFit(page: Page) {
  const violations = await page.locator(".studio-inspector").evaluate((inspector) => {
    const candidates = inspector.querySelectorAll<HTMLElement>(
      [
        "button",
        "label",
        ".element-inspector-head > strong",
        ".element-color > b",
        ".design-mode-control strong",
        ".design-mode-control small",
      ].join(",")
    )

    return [...candidates]
      .filter((element) => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()

        return style.display !== "none" && box.width > 0 && box.height > 0
      })
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
      )
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        className: element.className,
        text: element.innerText.trim().replace(/\s+/g, " ").slice(0, 120),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
  })

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}

async function expectInspectorTargetsToMeetPolicy(page: Page) {
  const violations = await page.locator(".studio-inspector").evaluate((inspector) =>
    [...inspector.querySelectorAll<HTMLElement>(
      "button, input:not([type='hidden']), select, textarea, [role='button'], [role='switch']"
    )]
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()

        return {
          element: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          label: element.getAttribute("aria-label") || element.innerText.trim().slice(0, 80),
          width: rect.width,
          height: rect.height,
        }
      })
      .filter((element) => element.width < 44 || element.height < 44)
  )

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}

test("uses exact DropsTab and Drops Bot assets instead of generic surrogate marks", async ({
  page,
}) => {
  await prepareHomePage(page)
  await expectImagesLoaded(
    page.locator(
      ".drops-brand-marks img[src*='/brand/dropstab-mark.svg'], .drops-brand-marks img[src*='/brand/drops-bot-avatar.jpg']"
    )
  )

  await prepareStudioPage(page)
  await expectImagesLoaded(
    page.locator(
      ".project-studio-topbar .drops-brand-marks img[src*='/brand/dropstab-mark.svg'], .project-studio-topbar .drops-brand-marks img[src*='/brand/drops-bot-avatar.jpg']"
    )
  )
})

test("1024px statusbar fits every status without overlap or clamping", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1024")
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await expectStatusbarItemsToFit(page)
  await assertCleanRuntime()
})

test("390px Morning Alpha runtime fits catalyst and action modules without overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-390")
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareMorningAlphaStudioPage(page)

  const runtime = page.frameLocator("iframe[title$='live application']")
  const geometry = await runtime.locator(".module-strip").evaluate((moduleStrip) => {
    const root = document.documentElement
    const body = document.body
    const stripRect = moduleStrip.getBoundingClientRect()
    const labels = [...moduleStrip.querySelectorAll<HTMLElement>("span")].map(
      (label) => {
        const rect = label.getBoundingClientRect()

        return {
          text: label.innerText.trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
          clientHeight: label.clientHeight,
          scrollHeight: label.scrollHeight,
        }
      }
    )

    return {
      viewportWidth: window.innerWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      strip: {
        left: stripRect.left,
        right: stripRect.right,
        top: stripRect.top,
        bottom: stripRect.bottom,
        clientWidth: moduleStrip.clientWidth,
        scrollWidth: moduleStrip.scrollWidth,
        clientHeight: moduleStrip.clientHeight,
        scrollHeight: moduleStrip.scrollHeight,
      },
      labels,
    }
  })

  expect(geometry.viewportWidth).toBeLessThanOrEqual(390)
  expect(geometry.rootScrollWidth).toBeLessThanOrEqual(geometry.rootClientWidth)
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth)
  expect(
    geometry.labels.some((label) => /catalyst/i.test(label.text)),
    "Morning Alpha must expose its catalyst module"
  ).toBe(true)
  expect(
    geometry.labels.some((label) => /action/i.test(label.text)),
    "Morning Alpha must expose its action module"
  ).toBe(true)
  expect(
    geometry.strip.scrollWidth,
    `Module tabs overflow horizontally: ${JSON.stringify(geometry, null, 2)}`
  ).toBeLessThanOrEqual(geometry.strip.clientWidth + 1)
  expect(
    geometry.strip.scrollHeight,
    `Module tabs overflow vertically: ${JSON.stringify(geometry, null, 2)}`
  ).toBeLessThanOrEqual(geometry.strip.clientHeight + 1)

  for (const label of geometry.labels) {
    expect(label.left, `${label.text} starts outside the module strip`).toBeGreaterThanOrEqual(
      geometry.strip.left - 1
    )
    expect(label.right, `${label.text} ends outside the module strip`).toBeLessThanOrEqual(
      geometry.strip.right + 1
    )
    expect(label.top, `${label.text} starts outside the module strip`).toBeGreaterThanOrEqual(
      geometry.strip.top - 1
    )
    expect(label.bottom, `${label.text} ends outside the module strip`).toBeLessThanOrEqual(
      geometry.strip.bottom + 1
    )
    expect(label.scrollWidth, `${label.text} is horizontally clamped`).toBeLessThanOrEqual(
      label.clientWidth + 1
    )
    expect(label.scrollHeight, `${label.text} is vertically clamped`).toBeLessThanOrEqual(
      label.clientHeight + 1
    )
  }

  await expectNoHorizontalOverflow(page)
  await assertCleanRuntime()
})

test("selected element inspector remains readable at every release viewport", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  const headingText = await selectEditableCanvasElement(page)
  await expectSelectedInspectorToPreserveText(page, headingText)
  await expectSelectedInspectorToUseEditingGrid(page)
  await expectInspectorTextToFit(page)
  await expectInspectorTargetsToMeetPolicy(page)
  await expectStudioChromeToStaySeparated(page)
  await expectNoHorizontalOverflow(page)
  await assertCleanRuntime()

  if (process.env.CAPTURE_DESIGN_REVIEW === "1") {
    await mkdir("outputs/design-review", { recursive: true })
    await page.screenshot({
      path: `outputs/design-review/studio-selected-${testInfo.project.name}.png`,
      fullPage: true,
    })
  }

  const auditPhase = process.env.STUDIO_AUDIT_PHASE?.trim()
  if (auditPhase) {
    await mkdir("outputs/audit/studio-polish", { recursive: true })
    await page.screenshot({
      path: `outputs/audit/studio-polish/${auditPhase}-${testInfo.project.name}.png`,
      fullPage: true,
    })
    if (testInfo.project.name === "chromium-390") {
      await page.locator(".element-inspector").evaluate((element) => {
        element.scrollIntoView({ block: "start" })
        window.scrollBy(0, -126)
      })
    }
    await page.screenshot({
      path: `outputs/audit/studio-polish/${auditPhase}-viewport-${testInfo.project.name}.png`,
      fullPage: false,
    })
    const geometry = await page.evaluate(() => {
      const inspector = document.querySelector<HTMLElement>(".element-inspector")!
      const grid = document.querySelector<HTMLElement>(".element-control-grid")!
      const rail = document.querySelector<HTMLElement>(".studio-rail")!
      const status = document.querySelector<HTMLElement>(".project-statusbar")!
      const controls = [...inspector.querySelectorAll<HTMLElement>(
        "button, input:not([type='hidden']), select, textarea"
      )].map((control) => {
        const rect = control.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        inspector: inspector.getBoundingClientRect().toJSON(),
        gridColumns: getComputedStyle(grid).gridTemplateColumns,
        minimumControl: {
          width: Math.min(...controls.map((control) => control.width)),
          height: Math.min(...controls.map((control) => control.height)),
        },
        navigation: {
          railBottom: rail.getBoundingClientRect().bottom,
          railPosition: getComputedStyle(rail).position,
          statusDisplay: getComputedStyle(status).display,
        },
      }
    })
    await writeFile(
      `outputs/audit/studio-polish/${auditPhase}-${testInfo.project.name}.json`,
      `${JSON.stringify(geometry, null, 2)}\n`
    )
  }
})

test("Director, status and navigation surfaces stay readable without collisions", async ({
  page,
}, testInfo) => {
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)
  await expectStudioChromeToStaySeparated(page)
  await expectDirectorToStartReadable(page)
  await expectNoHorizontalOverflow(page)
  await assertCleanRuntime()

  const auditPhase = process.env.STUDIO_AUDIT_PHASE?.trim()
  if (auditPhase) {
    await mkdir("outputs/audit/studio-polish", { recursive: true })
    if ((page.viewportSize()?.width ?? 0) <= 920) {
      await page.locator(".assistant-panel").evaluate((element) => {
        element.scrollIntoView({ block: "start" })
        window.scrollBy(0, -126)
      })
    }
    await page.screenshot({
      path: `outputs/audit/studio-polish/${auditPhase}-director-${testInfo.project.name}.png`,
      fullPage: false,
    })
  }
})

test("900px workspace shows one selected primary tool surface", async (
  { page },
  testInfo
) => {
  test.skip(testInfo.project.name !== "chromium-1024")
  await page.setViewportSize({ width: 900, height: 800 })
  const assertCleanRuntime = installRuntimeGuards(page)

  await prepareStudioPage(page)

  const layoutDirection = await page
    .locator(".project-studio-layout")
    .evaluate((element) => getComputedStyle(element).flexDirection)
  expect(layoutDirection).toBe("column")

  const inspector = await page.locator(".studio-inspector").boundingBox()
  expect(inspector).not.toBeNull()
  expect(inspector!.width).toBeGreaterThanOrEqual(880)
  await expect(page.locator(".runtime-stage")).toBeHidden()
  await expect(page.locator(".assistant-panel")).toBeHidden()

  await expectInspectorTextToFit(page)
  await expectInspectorTargetsToMeetPolicy(page)

  await page.getByRole("button", { name: "Director", exact: true }).click()
  await expect(page.locator(".assistant-panel")).toBeVisible()
  await expect(page.locator(".studio-inspector")).toBeHidden()
  await expect(page.locator(".runtime-stage")).toBeHidden()

  const visiblePrimarySurfaces = await page
    .locator(".studio-inspector, .assistant-panel, .runtime-stage")
    .evaluateAll((elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element)
        return style.display !== "none" && style.visibility !== "hidden"
      }).length
    )
  expect(visiblePrimarySurfaces).toBe(1)

  await page.getByRole("button", { name: "Preview", exact: true }).click()
  await expect(page.locator(".runtime-stage")).toBeVisible()
  await expect(page.locator(".studio-inspector")).toBeHidden()
  await expect(page.locator(".assistant-panel")).toBeHidden()

  const previewPrimarySurfaces = await page
    .locator(".studio-inspector, .assistant-panel, .runtime-stage")
    .evaluateAll((elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element)
        return style.display !== "none" && style.visibility !== "hidden"
      }).length
    )
  expect(previewPrimarySurfaces).toBe(1)
  await assertCleanRuntime()
})
