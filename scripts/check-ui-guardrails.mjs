import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const SOURCE_ROOTS = ["app", "components", "lib"]
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
])
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`
const FONT_PATTERNS = [
  {
    pattern: new RegExp(String.raw`font-size\s*:\s*(${NUMBER})px`, "gi"),
    toPixels: Number,
  },
  {
    pattern: new RegExp(String.raw`font-size\s*:\s*(${NUMBER})rem`, "gi"),
    toPixels: (value) => Number(value) * 16,
  },
  {
    pattern: new RegExp(
      String.raw`\bfont\s*:\s*[^;{}]*?\b(${NUMBER})px(?:\s*\/[^;\s{}]+)?`,
      "gi"
    ),
    toPixels: Number,
  },
  {
    pattern: new RegExp(
      String.raw`\bfont\s*:\s*[^;{}]*?\b(${NUMBER})rem(?:\s*\/[^;\s{}]+)?`,
      "gi"
    ),
    toPixels: (value) => Number(value) * 16,
  },
  {
    pattern: new RegExp(
      String.raw`\bfontSize\s*:\s*(${NUMBER})(?=\s*[,}])`,
      "g"
    ),
    toPixels: Number,
  },
  {
    pattern: new RegExp(String.raw`text-\[(${NUMBER})px\]`, "gi"),
    toPixels: Number,
  },
  {
    pattern: new RegExp(String.raw`text-\[(${NUMBER})rem\]`, "gi"),
    toPixels: (value) => Number(value) * 16,
  },
]

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(filePath)))
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(filePath)
    }
  }

  return files
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length
}

export async function collectUiGuardrailViolations(projectRoot = process.cwd()) {
  const files = []

  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = path.join(projectRoot, sourceRoot)

    try {
      files.push(...(await sourceFiles(directory)))
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error
      }
    }
  }

  const violations = []

  for (const file of files.sort()) {
    const source = await readFile(file, "utf8")

    for (const { pattern, toPixels } of FONT_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) {
        const value = toPixels(match[1])

        if (value > 0 && value < 12) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: lineNumber(source, match.index),
            value,
            source: match[0],
          })
        }
      }
    }
  }

  return violations
}

function formatViolation(violation) {
  return `${violation.file}:${violation.line} ${violation.source} (${violation.value}px)`
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMainModule) {
  const violations = await collectUiGuardrailViolations()

  if (violations.length > 0) {
    console.error(
      `UI font-size guardrail failed: ${violations.length} source declaration(s) below 12px.\n${violations
        .slice(0, 50)
        .map(formatViolation)
        .join("\n")}${violations.length > 50 ? "\n…output truncated" : ""}`
    )
    process.exitCode = 1
  } else {
    console.log("UI font-size guardrail passed.")
  }
}
