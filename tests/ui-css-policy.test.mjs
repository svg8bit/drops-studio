import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { collectUiGuardrailViolations } from "../scripts/check-ui-guardrails.mjs"

test("UI source does not declare font sizes below 12px", async () => {
  const violations = await collectUiGuardrailViolations()
  const message = violations
    .slice(0, 100)
    .map(
      (violation) =>
        `${violation.file}:${violation.line} ${violation.source} (${violation.value}px)`
    )
    .join("\n")

  assert.deepEqual(violations, [], message)
})

test("Tailwind utilities stay in lazy Base UI islands instead of the LCP stylesheet", async () => {
  const [globals, tailwind, base, setup, dialogs] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/tailwind.css", import.meta.url), "utf8"),
    readFile(
      new URL("../app/styles/drops-studio.base.css", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/drops-studio-setup.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/drops-studio-dialogs.tsx", import.meta.url),
      "utf8"
    ),
  ])

  assert.doesNotMatch(globals, /tailwind\.css/)
  assert.match(tailwind, /tailwindcss\/theme\.css/)
  assert.match(tailwind, /tailwindcss\/utilities\.css/)
  assert.doesNotMatch(tailwind, /tailwindcss\/preflight\.css/)
  assert.match(base, /h1, h2, h3, h4, h5, h6 \{ font-size: inherit; font-weight: inherit; \}/)
  assert.match(setup, /@\/app\/styles\/tailwind\.css/)
  assert.match(dialogs, /@\/app\/styles\/tailwind\.css/)
})

test("UI guardrail detects equivalent sub-12px declarations", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "drops-ui-guardrail-"))
  context.after(() => rm(projectRoot, { force: true, recursive: true }))
  await mkdir(path.join(projectRoot, "app"), { recursive: true })
  await writeFile(
    path.join(projectRoot, "app", "fixture.tsx"),
    `export const Fixture = () => (
      <div style={{ fontSize: 10 }} className="text-[0.625rem]">Inline</div>
    )
    const css = \`.short { font: italic 700 9px/1.4 sans-serif; }
      .rem { font-size: .6875rem; }\`
    `,
    "utf8"
  )

  const violations = await collectUiGuardrailViolations(projectRoot)

  assert.deepEqual(
    violations.map((violation) => violation.value).sort((a, b) => a - b),
    [9, 10, 10, 11]
  )
})

test("Playwright snapshot approval guard covers long and short update flags", async () => {
  const config = await readFile(
    new URL("../playwright.config.ts", import.meta.url),
    "utf8"
  )

  assert.match(config, /argument === "-u"/)
  assert.match(config, /argument\.startsWith\("-u="\)/)
  assert.match(config, /argument === "--update-snapshots"/)
  assert.match(config, /argument\.startsWith\("--update-snapshots="\)/)
  assert.match(config, /VISUAL_BASELINE_APPROVED/)
})

test("Project Studio mobile keeps one selected tool surface instead of stacking the canvas", async () => {
  const [responsive, workspace, studio] = await Promise.all([
    readFile(
      new URL("../app/styles/project-studio.responsive.css", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../app/styles/project-studio.workspace.css", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
  ])

  assert.match(
    responsive,
    /@media \(max-width: 920px\)[\s\S]*?\.runtime-stage\s*\{\s*display:\s*none;/
  )
  assert.match(
    responsive,
    /\.project-studio-layout\.tab-preview \.runtime-stage\s*\{[\s\S]*?display:\s*block;/
  )
  assert.match(
    responsive,
    /\.project-studio-layout\.tab-preview \.studio-inspector,[\s\S]*?\.project-studio-layout\.tab-preview \.assistant-panel\s*\{\s*display:\s*none;/
  )
  assert.match(
    responsive,
    /@media \(max-width: 920px\)[\s\S]*?\.studio-inspector,[\s\S]*?\.assistant-panel[\s\S]*?order:\s*1;/
  )
  assert.match(workspace, /@media \(min-width: 1600px\)/)
  assert.match(studio, /matchMedia\("\(min-width: 1600px\)"\)/)
  assert.match(studio, /id: "preview", label: "Preview", icon: Monitor, mobileOnly: true/)
})

test("Base UI wrappers expose real orientation state and preserve addon handlers", async () => {
  const [tabs, toggleGroup, scrollArea, inputGroup] = await Promise.all([
    readFile(new URL("../components/ui/tabs.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/ui/toggle-group.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/ui/scroll-area.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/ui/input-group.tsx", import.meta.url),
      "utf8"
    ),
  ])

  assert.match(tabs, /orientation=\{orientation\}/)
  assert.match(tabs, /data-\[orientation=vertical\]/)
  assert.match(toggleGroup, /orientation=\{orientation\}/)
  assert.match(toggleGroup, /data-\[orientation=vertical\]/)
  assert.match(scrollArea, /data-\[orientation=horizontal\]/)
  assert.doesNotMatch(`${tabs}\n${toggleGroup}\n${scrollArea}`, /data-horizontal/)

  assert.match(inputGroup, /onClick\?\.\(e\)/)
  assert.match(inputGroup, /e\.defaultPrevented/)
  assert.match(inputGroup, /\[data-slot='input-group-control'\]/)
})
