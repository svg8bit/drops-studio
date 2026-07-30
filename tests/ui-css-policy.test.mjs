import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  collectUiArchitectureViolations,
  collectUiGuardrailViolations,
} from "../scripts/check-ui-guardrails.mjs"

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

test("globals.css stays a small import-only manifest", async () => {
  assert.deepEqual(await collectUiArchitectureViolations(), [])
})

test("manual CSS modules cannot regress to a monolithic stylesheet", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "drops-css-architecture-"))
  context.after(() => rm(projectRoot, { force: true, recursive: true }))
  await mkdir(path.join(projectRoot, "app", "styles"), { recursive: true })
  await writeFile(path.join(projectRoot, "app", "globals.css"), '@import "./styles/tokens.css";\n', "utf8")
  await writeFile(
    path.join(projectRoot, "app", "styles", "monolith.css"),
    `/* ${"x".repeat(49 * 1024)} */`,
    "utf8"
  )

  const violations = await collectUiArchitectureViolations(projectRoot)

  assert.equal(violations.length, 1)
  assert.match(violations[0], /monolith\.css is \d+ bytes/)
})

test("Tailwind utilities stay in lazy Base UI islands instead of the LCP stylesheet", async () => {
  const [globals, tailwind, base, setup, dialogs, workspace, dropsBot] =
    await Promise.all([
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
    readFile(
      new URL("../components/project-workspace-dialog.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/dropsbot-webhook-connection.tsx", import.meta.url),
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
  assert.match(workspace, /@\/app\/styles\/tailwind\.css/)
  assert.match(dropsBot, /@\/app\/styles\/tailwind\.css/)
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

test("Project Studio keeps one selected tool surface instead of adding a right Director column", async () => {
  const stylesDirectory = new URL("../app/styles/", import.meta.url)
  const styleNames = (await readdir(stylesDirectory)).filter(
    (name) => name.startsWith("project-studio") && name.endsWith(".css")
  )
  const [responsive, studio, styleSources] = await Promise.all([
    readFile(
      new URL("../app/styles/project-studio.responsive.css", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
    Promise.all(
      styleNames.map(async (name) => ({
        name,
        source: await readFile(new URL(name, stylesDirectory), "utf8"),
      }))
    ),
  ])

  const countGridTracks = (value) => {
    const tracks = []
    let current = ""
    let depth = 0

    for (const character of value.trim()) {
      if (/\s/.test(character) && depth === 0) {
        if (current) tracks.push(current)
        current = ""
        continue
      }

      current += character
      if (character === "(") depth += 1
      if (character === ")") depth -= 1
    }
    if (current) tracks.push(current)

    return tracks.reduce((count, track) => {
      const repeated = /^repeat\(\s*(\d+)\s*,/.exec(track)
      return count + (repeated ? Number(repeated[1]) : 1)
    }, 0)
  }

  const fourColumnRules = styleSources.flatMap(({ name, source }) =>
    [...source.matchAll(/\.project-studio-layout[^\{]*\{([^}]*)\}/g)].flatMap(
      (rule) =>
        [...rule[1].matchAll(/grid-template-columns\s*:\s*([^;]+)(?:;|$)/g)]
          .filter((declaration) => countGridTracks(declaration[1]) > 3)
          .map((declaration) => `${name}: ${declaration[1].trim()}`)
    )
  )

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
  assert.deepEqual(
    fourColumnRules,
    [],
    `Project Studio must not define a fourth persistent column:\n${fourColumnRules.join("\n")}`
  )
  assert.equal(
    styleNames.includes("project-studio.wide.css"),
    false,
    "The retired four-column wide stylesheet must not remain available for import"
  )
  assert.doesNotMatch(studio, /matchMedia\("\(min-width: 1600px\)"\)/)
  assert.match(studio, /id: "preview", label: "Preview", icon: Monitor, mobileOnly: true/)
})

test("Project Studio publish and Director controls keep the 44px interaction floor", async () => {
  const [runtime, workspace, dropsBot, design] = await Promise.all([
    readFile(
      new URL("../app/styles/project-studio.runtime.css", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/project-workspace-dialog.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/dropsbot-webhook-connection.tsx", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../DESIGN.md", import.meta.url), "utf8"),
  ])

  assert.match(runtime, /\.assistant-panel > header button \{[^}]*height: 44px;[^}]*width: 44px;/)
  assert.match(runtime, /\.publish-dialog > header > button \{[^}]*height: 44px;[^}]*width: 44px;/)
  assert.match(runtime, /\.cloud-publish \{[^}]*font-size: 14px;[^}]*min-height: 44px;/)
  assert.match(runtime, /\.public-url button \{[^}]*font-size: 14px;[^}]*min-height: 44px;/)
  assert.match(runtime, /\.pro-hosts > button \{[^}]*font-size: 14px;[^}]*min-height: 44px;/)
  assert.match(runtime, /\.publish-dialog > footer button \{[^}]*font-size: 14px;[^}]*min-height: 44px;/)
  assert.match(workspace, /className="ml-1 flex size-11 items-center justify-center/)
  assert.match(dropsBot, /className="size-11" aria-label="Refresh callback events"/)
  assert.match(design, /project-studio\.runtime\.css` is a bounded legacy exception/)
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
