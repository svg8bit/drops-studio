import { createHash } from "node:crypto";
import { dirname, extname, posix } from "node:path";
import ts from "typescript";

import { findArtifactSecrets } from "../../artifact-security.ts";
import type { GenerationDiagnostic } from "./types.ts";

const SOURCE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".css",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;
const CURATED_UNAVAILABLE_LUCIDE = [
  "BrandTwitter",
  "XTwitter",
  "Telegram",
  "Discord",
  "CryptoToken",
] as const;
const FORBIDDEN_INSTALL_SCRIPTS = new Set(["preinstall", "install", "postinstall"]);

interface DeterministicCheckResult {
  diagnostics: GenerationDiagnostic[];
  environmentVariableNames: string[];
}

function id(code: string, path: string | undefined, message: string): string {
  return createHash("sha256")
    .update(`${code}\0${path ?? ""}\0${message}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function diagnostic(
  code: GenerationDiagnostic["code"],
  severity: GenerationDiagnostic["severity"],
  message: string,
  path?: string,
  evidence?: string,
  fixerId?: string,
): GenerationDiagnostic {
  return {
    id: id(code, path, message),
    code,
    severity,
    message,
    ...(path ? { path } : {}),
    ...(evidence ? { evidence: evidence.slice(0, 2_000) } : {}),
    ...(fixerId ? { fixerId } : {}),
  };
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = objectRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function parseManifest(
  files: Readonly<Record<string, string>>,
  diagnostics: GenerationDiagnostic[],
): Record<string, unknown> | null {
  const source = files["package.json"];
  if (!source) {
    diagnostics.push(diagnostic("PACKAGE_MANIFEST_INVALID", "blocking", "package.json is required.", "package.json"));
    return null;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    diagnostics.push(diagnostic("JSON_INVALID", "blocking", "package.json contains malformed JSON.", "package.json"));
    return null;
  }
  const record = objectRecord(manifest);
  if (!record || typeof record.name !== "string" || objectRecord(record.scripts) === null) {
    diagnostics.push(diagnostic("PACKAGE_MANIFEST_INVALID", "blocking", "package.json must contain a name and scripts object.", "package.json"));
    return null;
  }
  for (const script of Object.keys(objectRecord(record.scripts) ?? {})) {
    if (FORBIDDEN_INSTALL_SCRIPTS.has(script.toLowerCase())) {
      diagnostics.push(diagnostic(
        "INSTALL_SCRIPT_FORBIDDEN",
        "blocking",
        `Generated package.json cannot add the ${script} lifecycle script.`,
        "package.json",
      ));
    }
  }
  const exports = objectRecord(record.exports);
  if (exports) {
    for (const [key, value] of Object.entries(exports)) {
      const validKey = key === "." || key.startsWith("./");
      const validValue = typeof value === "string"
        ? value.startsWith("./")
        : objectRecord(value) !== null;
      if (!validKey || !validValue) {
        diagnostics.push(diagnostic(
          "PACKAGE_EXPORT_INVALID",
          "error",
          `Package export ${key} is not a bounded relative export map entry.`,
          "package.json",
        ));
      }
    }
  }
  return record;
}

function syntaxDiagnostics(path: string, content: string): GenerationDiagnostic[] {
  if (/\.json$/i.test(path)) {
    try {
      JSON.parse(content);
      return [];
    } catch {
      return [diagnostic("JSON_INVALID", "blocking", `${path} contains malformed JSON.`, path)];
    }
  }
  if (!/\.[cm]?[jt]sx?$/i.test(path)) return [];
  const result = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
    },
  });
  return (result.diagnostics ?? [])
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
    .slice(0, 12)
    .map((entry) => diagnostic(
      "SYNTAX_INVALID",
      "blocking",
      ts.flattenDiagnosticMessageText(entry.messageText, " ").slice(0, 600),
      path,
      `TS${entry.code}`,
    ));
}

function importSpecifiers(content: string): string[] {
  const values = [
    ...content.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...content.matchAll(/\bimport\s*["']([^"']+)["']/g),
    ...content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  return [...new Set(values)];
}

function relativeCandidates(
  path: string,
  specifier: string,
  files: Readonly<Record<string, string>>,
): string[] {
  const target = posix.normalize(posix.join(dirname(path), specifier));
  return SOURCE_EXTENSIONS.map((suffix) => `${target}${suffix}`)
    .filter((candidate) => files[candidate] !== undefined);
}

function aliasCandidates(
  specifier: string,
  files: Readonly<Record<string, string>>,
  tsconfig: Record<string, unknown> | null,
): string[] {
  const compilerOptions = objectRecord(tsconfig?.compilerOptions);
  const paths = objectRecord(compilerOptions?.paths);
  const candidates: string[] = [];
  for (const [pattern, rawTargets] of Object.entries(paths ?? {})) {
    if (!Array.isArray(rawTargets) || rawTargets.some((target) => typeof target !== "string")) continue;
    const star = pattern.indexOf("*");
    const prefix = star < 0 ? pattern : pattern.slice(0, star);
    const suffix = star < 0 ? "" : pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const capture = specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
    for (const rawTarget of rawTargets as string[]) {
      const target = rawTarget.replace("*", capture).replace(/^\.\//, "");
      for (const extension of SOURCE_EXTENSIONS) {
        const path = `${target}${extension}`;
        if (files[path] !== undefined) candidates.push(path);
      }
    }
  }
  return [...new Set(candidates)].sort();
}

function checkImports(input: {
  path: string;
  content: string;
  files: Readonly<Record<string, string>>;
  manifest: Record<string, unknown> | null;
  tsconfig: Record<string, unknown> | null;
}): GenerationDiagnostic[] {
  const diagnostics: GenerationDiagnostic[] = [];
  const dependencies = {
    ...stringRecord(input.manifest?.dependencies),
    ...stringRecord(input.manifest?.devDependencies),
  };
  for (const specifier of importSpecifiers(input.content)) {
    if (specifier.startsWith(".")) {
      const candidates = relativeCandidates(input.path, specifier, input.files);
      if (!candidates.length) {
        diagnostics.push(diagnostic(
          "IMPORT_UNRESOLVED",
          "error",
          `Relative import ${specifier} does not resolve to a project file.`,
          input.path,
          specifier,
        ));
      } else if (!extname(specifier) && candidates.filter((path) => /\.(?:json|css)$/.test(path)).length > 1) {
        diagnostics.push(diagnostic(
          "IMPORT_EXTENSION_AMBIGUOUS",
          "error",
          `Relative data import ${specifier} has multiple possible extensions.`,
          input.path,
          candidates.join(","),
        ));
      }
      continue;
    }
    if (specifier.startsWith("@/")) {
      if (!aliasCandidates(specifier, input.files, input.tsconfig).length) {
        diagnostics.push(diagnostic(
          "ALIAS_UNRESOLVED",
          "error",
          `Alias import ${specifier} is not resolved by current tsconfig paths.`,
          input.path,
        ));
      }
      continue;
    }
    const dependency = packageName(specifier);
    if (dependency.startsWith("node:") || dependencies[dependency]) continue;
    diagnostics.push(diagnostic(
      "DEPENDENCY_MISSING",
      "error",
      `Import ${specifier} requires an explicit package.json dependency.`,
      input.path,
      dependency,
    ));
  }
  return diagnostics;
}

function checkFramework(
  path: string,
  content: string,
  files: Readonly<Record<string, string>>,
): GenerationDiagnostic[] {
  const diagnostics: GenerationDiagnostic[] = [];
  for (const icon of CURATED_UNAVAILABLE_LUCIDE) {
    if (!new RegExp(`\\b${icon}\\b`).test(content) || !/lucide-react/.test(content)) continue;
    diagnostics.push(diagnostic(
      "LUCIDE_ICON_UNAVAILABLE",
      "error",
      `Lucide icon ${icon} is not in the curated available registry.`,
      path,
      icon,
      "lucide-curated-icon-map",
    ));
  }
  if (
    /\.(?:tsx|jsx)$/.test(path) &&
    /\b(?:useState|useEffect|useLayoutEffect|window|document)\b/.test(content) &&
    !/^\s*["']use client["'];?/m.test(content)
  ) {
    diagnostics.push(diagnostic(
      "NEXT_CLIENT_BOUNDARY",
      "error",
      "Client-only React or browser APIs require an explicit Next.js client boundary.",
      path,
    ));
  }
  for (const match of content.matchAll(/(["'`])\/public\/([A-Za-z0-9@._+()[\]\/-]+)\1/g)) {
    diagnostics.push(diagnostic(
      "ASSET_PATH_INVALID",
      "error",
      `Next.js public asset /public/${match[2]} must be referenced from the root.`,
      path,
      files[`public/${match[2]}`] ? `public/${match[2]}` : "asset-not-found",
      files[`public/${match[2]}`] ? "next-public-asset-path" : undefined,
    ));
  }
  for (const match of content.matchAll(/\bfetch\(\s*["'`]\/api\/([A-Za-z0-9_./{}:-]+)["'`]/g)) {
    const route = `app/api/${match[1].replace(/\/$/, "")}/route.ts`;
    if (files[route] !== undefined) continue;
    diagnostics.push(diagnostic(
      "API_ROUTE_MISSING",
      "error",
      `Generated API reference /api/${match[1]} has no matching ${route}.`,
      path,
      route,
    ));
  }
  return diagnostics;
}

function environmentNames(files: Readonly<Record<string, string>>): string[] {
  return [...new Set(
    Object.values(files).flatMap((content) =>
      [...content.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]{0,95})\b/g)]
        .map((match) => match[1]),
    ),
  )].sort();
}

export function runDeterministicGenerationChecks(input: {
  files: Readonly<Record<string, string>>;
  changedPaths: readonly string[];
}): DeterministicCheckResult {
  const diagnostics: GenerationDiagnostic[] = [];
  const manifest = parseManifest(input.files, diagnostics);
  let tsconfig: Record<string, unknown> | null = null;
  try {
    tsconfig = objectRecord(JSON.parse(input.files["tsconfig.json"] ?? "null"));
  } catch {
    diagnostics.push(diagnostic("JSON_INVALID", "blocking", "tsconfig.json contains malformed JSON.", "tsconfig.json"));
  }
  for (const path of [...new Set(input.changedPaths)].sort()) {
    const content = input.files[path];
    if (content === undefined) continue;
    if (findArtifactSecrets(content, path).length) {
      diagnostics.push(diagnostic("SECRET_DETECTED", "blocking", "Credential-like material is forbidden before canonical write.", path));
      continue;
    }
    diagnostics.push(...syntaxDiagnostics(path, content));
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      diagnostics.push(...checkImports({ path, content, files: input.files, manifest, tsconfig }));
      diagnostics.push(...checkFramework(path, content, input.files));
    }
  }
  return {
    diagnostics: diagnostics.sort((left, right) =>
      (left.path ?? "").localeCompare(right.path ?? "") ||
      left.code.localeCompare(right.code) ||
      left.id.localeCompare(right.id),
    ),
    environmentVariableNames: environmentNames(input.files),
  };
}
