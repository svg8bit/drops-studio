import {
  ArtifactSecretError,
  findArtifactSecrets,
} from "./artifact-security.ts";
import { PROJECT_WORKSPACE_CSP } from "./artifact-csp.ts";
import type {
  GeneratedProject,
  GeneratedProjectSpec,
} from "./project-types.ts";
import {
  prepareEditableRuntimeHtml,
  validateEditableRuntimeHtml,
} from "./source-workspace.ts";
import { unexpectedRuntimeActiveContent } from "./runtime-active-content.ts";

export const PROJECT_WORKSPACE_FILE_LIMIT = 64;
export const PROJECT_WORKSPACE_BYTES_LIMIT = 1_500_000;
export const PROJECT_WORKSPACE_FILE_BYTES_LIMIT = 1_500_000;
export const PROJECT_WORKSPACE_PACKAGE_LIMIT = 6;
export const PROJECT_WORKSPACE_DEPENDENCY_LIMIT = 24;

export const PROJECT_WORKSPACE_FILE_ROLES = [
  "entry",
  "style",
  "client",
  "project-config",
  "integration-config",
  "package-manifest",
  "server",
  "task",
  "test",
  "documentation",
] as const;

export type ProjectWorkspaceFileRole =
  (typeof PROJECT_WORKSPACE_FILE_ROLES)[number];

export const PROJECT_WORKSPACE_FILE_LANGUAGES = [
  "html",
  "css",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "markdown",
  "text",
] as const;

export type ProjectWorkspaceFileLanguage =
  (typeof PROJECT_WORKSPACE_FILE_LANGUAGES)[number];

export interface ProjectWorkspaceFile {
  path: string;
  content: string;
  language: ProjectWorkspaceFileLanguage;
  role: ProjectWorkspaceFileRole;
  editable: boolean;
}

export interface ProjectWorkspaceTask {
  id: string;
  label: string;
  command: "npm";
  args: string[];
  cwd?: string;
  port?: number;
}

export interface ProjectWorkspace {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  files: ProjectWorkspaceFile[];
  tasks: ProjectWorkspaceTask[];
  runtime: {
    executionMode: "static-preview";
    provider: "unconfigured";
    isolation: "browser-iframe";
    runtime: "node24";
    packageManager: "npm";
    installScripts: false;
  };
}

export interface ProjectWorkspaceValidation {
  valid: boolean;
  issues: string[];
}

const REQUIRED_FILES = [
  "index.html",
  "src/styles.css",
  "src/app.js",
  "project.json",
  "drops.config.json",
  "package.json",
  "server.mjs",
  "scripts/check.mjs",
  "tests/smoke.mjs",
  "README.md",
] as const;

const BLOCKED_LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishonly",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
]);

const BLOCKED_PACKAGE_FIELDS = [
  "overrides",
  "resolutions",
  "pnpm",
  "publishConfig",
] as const;

const BLOCKED_OPTIONAL_DEPENDENCY_FIELDS = [
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
] as const;

const BLOCKED_PACKAGE_FILES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const WORKSPACE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)(?!.*\/\/)[A-Za-z0-9@._/-]{1,160}$/;
const PACKAGE_WORKSPACE_PATH = /^packages\/[a-z0-9][a-z0-9._-]{0,63}$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,47}$/;
const PACKAGE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,47}$/;
const PACKAGE_TASK_PRIORITY = ["start", "build", "test", "check"] as const;
const PROJECT_WORKSPACE_TASK_LIMIT = 16;
const PROJECT_WORKSPACE_ROOT_TASK_LIMIT = 4;
const CANONICAL_STYLESHEET_LINK =
  '<link rel="stylesheet" href="./src/styles.css">';
const CANONICAL_RUNTIME_SCRIPT = '<script src="./src/app.js"></script>';
const WORKSPACE_FILE_ROLE_SET = new Set<string>(PROJECT_WORKSPACE_FILE_ROLES);
const WORKSPACE_FILE_LANGUAGE_SET = new Set<string>(
  PROJECT_WORKSPACE_FILE_LANGUAGES,
);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function file(
  path: string,
  content: string,
  language: ProjectWorkspaceFileLanguage,
  role: ProjectWorkspaceFileRole,
  editable = true,
): ProjectWorkspaceFile {
  return { path, content, language, role, editable };
}

export function isUnsafeProjectWorkspacePath(path: unknown): boolean {
  if (typeof path !== "string" || !WORKSPACE_PATH.test(path)) return true;
  const segments = path.toLowerCase().split("/");
  const fileName = segments.at(-1) ?? "";
  return (
    segments.some(
      (segment) => segment === ".git" || segment.startsWith(".env"),
    ) ||
    segments.includes("node_modules") ||
    BLOCKED_PACKAGE_FILES.has(fileName)
  );
}

function htmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  ).exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function isInsideTemplate(html: string, offset: number): boolean {
  const prefix = html.slice(0, offset).toLowerCase();
  return prefix.lastIndexOf("<template") > prefix.lastIndexOf("</template");
}

function isNonExecutableScript(attributes: string): boolean {
  const type = htmlAttribute(attributes, "type")?.trim().toLowerCase();
  return Boolean(
    type &&
      ![
        "module",
        "text/javascript",
        "application/javascript",
        "text/ecmascript",
        "application/ecmascript",
      ].includes(type),
  );
}

function extractRuntimeSource(html: string): {
  indexHtml: string;
  css: string;
  javascript: string;
} {
  const styles: string[] = [];
  const scripts: string[] = [];
  let styleAttached = false;
  let scriptAttached = false;

  let indexHtml = html.replace(
    /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi,
    (_match, source: string) => {
      styles.push(source.trim());
      if (styleAttached) return "";
      styleAttached = true;
      return CANONICAL_STYLESHEET_LINK;
    },
  );

  indexHtml = indexHtml.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attributes: string, source: string, offset: number) => {
      if (
        isInsideTemplate(indexHtml, offset) ||
        htmlAttribute(attributes, "src") !== null ||
        isNonExecutableScript(attributes) ||
        !source.trim()
      ) {
        return match;
      }
      if (attributes.trim()) {
        throw new Error(
          "The compiled runtime script must be one classic inline script without attributes; module, async and deferred scripts cannot be rewritten safely.",
        );
      }
      if (scriptAttached) {
        throw new Error(
          "The compiled product must contain exactly one executable inline runtime script so script scope and ordering are preserved.",
        );
      }
      scripts.push(source.trim());
      scriptAttached = true;
      return CANONICAL_RUNTIME_SCRIPT;
    },
  );

  if (!styleAttached || !scriptAttached) {
    throw new Error("The compiled product must contain inline style and runtime script sources.");
  }

  return {
    indexHtml,
    css: styles.filter(Boolean).join("\n\n"),
    javascript: scripts.filter(Boolean).join("\n\n"),
  };
}

export function staticWorkspaceServerSource(): string {
  return `import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const htmlCsp = ${JSON.stringify(PROJECT_WORKSPACE_CSP)};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://workspace.local");
    const relative = decodeURIComponent(url.pathname).replace(/^\\/+/, "") || "index.html";
    const normalized = normalize(relative);
    if (normalized.startsWith("..") || normalized.includes("/../")) throw new Error("Invalid path");
    let target = join(root, normalized);
    if ((await stat(target)).isDirectory()) target = join(target, "index.html");
    const content = await readFile(target);
    const extension = extname(target);
    const headers = { "content-type": types[extension] || "application/octet-stream", "x-content-type-options": "nosniff", "cache-control": "no-store" };
    if (extension === ".html") headers["content-security-policy"] = htmlCsp;
    response.writeHead(200, headers);
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Not found");
  }
}).listen(port, "0.0.0.0", () => console.log(\`Drops workspace ready on :\${port}\`));
`;
}

function checkTaskSource(spec: GeneratedProjectSpec): string {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, javascript, manifest] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../drops.config.json", import.meta.url), "utf8").then(JSON.parse),
]);
assert.match(html, /data-project-kind="${spec.presetId}"/);
assert.match(html, /\\.\\/src\\/styles\\.css/);
assert.match(html, /\\.\\/src\\/app\\.js/);
assert.ok(css.trim().length > 100, "styles.css must contain the product visual system");
assert.match(javascript, /function\\s+refreshData\\s*\\(/);
assert.equal(manifest.project.presetId, "${spec.presetId}");
assert.equal(manifest.runtime.provider, "Unconfigured");
console.log("Workspace structure and runtime contracts passed");
`;
}

function smokeTaskSource(spec: GeneratedProjectSpec): string {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const javascript = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
new Script(javascript, { filename: "src/app.js" });
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /data-project-kind="${spec.presetId}"/);
assert.doesNotMatch(html + javascript, /\\beval\\s*\\(|new Function/);
console.log("Workspace runtime smoke passed");
`;
}

function packageManifest(spec: GeneratedProjectSpec): string {
  return JSON.stringify(
    {
      name: spec.slug,
      version: "1.0.0",
      private: true,
      type: "module",
      engines: { node: ">=22.13.0" },
      scripts: {
        check: "node scripts/check.mjs",
        test: "node tests/smoke.mjs",
        build: "node scripts/check.mjs && node tests/smoke.mjs",
        start: "node server.mjs",
      },
      dependencies: {},
    },
    null,
    2,
  );
}

function integrationManifest(project: GeneratedProject): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      project: {
        id: project.id,
        presetId: project.spec.presetId,
        slug: project.spec.slug,
      },
      runtime: {
        provider: "Unconfigured",
        executionMode: "Static preview",
        isolation: "Browser iframe",
        credentialsIncluded: false,
        providerEvidenceRequired: true,
      },
      data: {
        provider: "DropsTab Public API",
        endpoint: project.spec.dataEndpoint,
        keyIncluded: false,
      },
      automation: {
        provider: "Drops Bot API",
        credentialsIncluded: false,
        providerEvidenceRequired: true,
      },
    },
    null,
    2,
  );
}

function workspaceReadme(project: GeneratedProject): string {
  return `# ${project.spec.name}

This is the editable multi-file source workspace produced by Drops Studio.

## Tasks

- \`npm run check\` validates the file graph and integration manifest.
- \`npm test\` parses the runnable JavaScript in an isolated task.
- \`npm run build\` runs both release checks.
- \`npm start\` serves the workspace on \`PORT\` (default 4173).

Drops Studio preserves the root \`index.html\`, \`src/styles.css\` and \`src/app.js\` as the static preview and publishing runtime. The root manifest may additionally declare up to six explicit \`packages/<safe-name>\` npm workspaces. Package tasks run only from the root or a declared package directory and must match a script in that directory's private manifest.

Server tasks run in an ephemeral Vercel Sandbox only after the API returns a provider run receipt. Dependencies use exact registry versions, install scripts are disabled, and runtime network access is denied. Connected provider credentials are never written into workspace files or inherited by a sandbox.
`;
}

export function materializeProjectWorkspace(
  project: GeneratedProject,
): ProjectWorkspace {
  const source = extractRuntimeSource(prepareEditableRuntimeHtml(project.html));
  return {
    schemaVersion: 1,
    revision: 1,
    updatedAt: project.updatedAt,
    files: [
      file("index.html", source.indexHtml, "html", "entry"),
      file("src/styles.css", source.css, "css", "style"),
      file("src/app.js", source.javascript, "javascript", "client"),
      file(
        "project.json",
        prepareEditableRuntimeHtml(JSON.stringify(project.spec, null, 2)),
        "json",
        "project-config",
      ),
      file(
        "drops.config.json",
        prepareEditableRuntimeHtml(integrationManifest(project)),
        "json",
        "integration-config",
      ),
      file("package.json", packageManifest(project.spec), "json", "package-manifest"),
      file("server.mjs", staticWorkspaceServerSource(), "javascript", "server"),
      file("scripts/check.mjs", checkTaskSource(project.spec), "javascript", "task"),
      file("tests/smoke.mjs", smokeTaskSource(project.spec), "javascript", "test"),
      file("README.md", workspaceReadme(project), "markdown", "documentation"),
    ],
    tasks: [
      { id: "check", label: "Check workspace", command: "npm", args: ["run", "check"] },
      { id: "test", label: "Run tests", command: "npm", args: ["test"] },
      { id: "build", label: "Build release", command: "npm", args: ["run", "build"] },
      { id: "start", label: "Start preview", command: "npm", args: ["start"], port: 4173 },
    ],
    runtime: {
      executionMode: "static-preview",
      provider: "unconfigured",
      isolation: "browser-iframe",
      runtime: "node24",
      packageManager: "npm",
      installScripts: false,
    },
  };
}

interface ProjectPackageContract {
  dependencies: Record<string, string>;
  dependencyCount: number;
  scriptsByCwd: Map<string, Record<string, string>>;
  packageNamesByCwd: Map<string, string>;
  workspaceDirectories: string[];
}

function parseManifest(
  content: string,
  path: string,
  issues: string[],
): Record<string, unknown> {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(`${path} must contain one JSON object.`);
      return {};
    }
    return value as Record<string, unknown>;
  } catch {
    issues.push(`${path} must contain valid JSON.`);
    return {};
  }
}

function manifestCwd(path: string): string | null {
  if (path === "package.json") return ".";
  const match = /^(packages\/[a-z0-9][a-z0-9._-]{0,63})\/package\.json$/.exec(
    path,
  );
  return match?.[1] ?? null;
}

function packageScripts(
  manifest: Record<string, unknown>,
  path: string,
  issues: string[],
  requireRootScripts: boolean,
): Record<string, string> {
  const raw = manifest.scripts;
  if (raw === undefined && !requireRootScripts) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push(`${path} must declare package scripts as an object.`);
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(raw as Record<string, unknown>)) {
    if (BLOCKED_LIFECYCLE_SCRIPTS.has(name.toLowerCase())) {
      issues.push(`npm lifecycle scripts are blocked in ${path} (${name}).`);
      continue;
    }
    if (!PACKAGE_SCRIPT_NAME.test(name)) {
      issues.push(
        `${path} script ${name} must use a bounded alphanumeric npm script name.`,
      );
      continue;
    }
    if (
      typeof command !== "string" ||
      !command.trim() ||
      command.length > 500
    ) {
      issues.push(`${path} script ${name} must be a bounded command string.`);
      continue;
    }
    scripts[name] = command;
  }
  if (requireRootScripts) {
    for (const required of ["check", "test", "build", "start"]) {
      if (!Object.hasOwn(scripts, required)) {
        issues.push(`package.json must keep the ${required} task.`);
      }
    }
  }
  return scripts;
}

function packageDisplayName(
  manifest: Record<string, unknown>,
  cwd: string,
  path: string,
  issues: string[],
): string {
  if (manifest.name === undefined) return cwd.split("/").at(-1) ?? cwd;
  if (
    typeof manifest.name !== "string" ||
    manifest.name.length > 214 ||
    !PACKAGE_NAME.test(manifest.name)
  ) {
    issues.push(`${path} name must be a valid bounded npm package name.`);
    return cwd.split("/").at(-1) ?? cwd;
  }
  return manifest.name;
}

function packageDependencies(
  manifest: Record<string, unknown>,
  path: string,
  issues: string[],
): { dependencies: Record<string, string>; count: number } {
  const dependencies: Record<string, string> = {};
  let count = 0;
  for (const section of ["dependencies", "devDependencies"] as const) {
    const raw = manifest[section] ?? {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(`${path} ${section} must be an object.`);
      continue;
    }
    for (const [name, version] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      count += 1;
      if (
        !PACKAGE_NAME.test(name) ||
        typeof version !== "string" ||
        !REGISTRY_VERSION.test(version)
      ) {
        issues.push(
          `${path} dependency ${name} must use an exact package registry version, not a range, URL, file, git or workspace spec.`,
        );
        continue;
      }
      dependencies[name] = version;
    }
  }
  return { dependencies, count };
}

function validatePackageFields(
  manifest: Record<string, unknown>,
  path: string,
  issues: string[],
): void {
  if (manifest.private !== true) {
    issues.push(`${path} must remain private.`);
  }
  for (const field of BLOCKED_PACKAGE_FIELDS) {
    if (manifest[field] !== undefined) {
      issues.push(`${path} ${field} is blocked from the bounded package contract.`);
    }
  }
  for (const field of BLOCKED_OPTIONAL_DEPENDENCY_FIELDS) {
    const value = manifest[field];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    ) {
      issues.push(`${path} ${field} is blocked from installation.`);
    }
  }
  const config = manifest.config;
  if (
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    "registry" in config
  ) {
    issues.push(`${path} cannot declare a custom npm registry.`);
  }
}

function workspaceDirectories(
  manifest: Record<string, unknown>,
  byPath: Map<string, ProjectWorkspaceFile>,
  issues: string[],
): string[] {
  if (manifest.workspaces === undefined) return [];
  if (!Array.isArray(manifest.workspaces)) {
    issues.push("package.json workspaces must be an array of explicit package directories.");
    return [];
  }
  if (manifest.workspaces.length > PROJECT_WORKSPACE_PACKAGE_LIMIT) {
    issues.push(
      `A workspace may declare at most ${PROJECT_WORKSPACE_PACKAGE_LIMIT} package directories.`,
    );
  }
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const value of manifest.workspaces) {
    if (typeof value !== "string" || !PACKAGE_WORKSPACE_PATH.test(value)) {
      issues.push(
        "package.json workspaces must use explicit packages/<safe-name> directories without globs, URLs or traversal.",
      );
      continue;
    }
    if (seen.has(value)) {
      issues.push(`package.json workspace ${value} appears more than once.`);
      continue;
    }
    seen.add(value);
    directories.push(value);
    if (!byPath.has(`${value}/package.json`)) {
      issues.push(`${value}/package.json is required by the root workspace declaration.`);
    }
  }
  return directories;
}

function parsePackageGraph(
  byPath: Map<string, ProjectWorkspaceFile>,
  issues: string[],
): ProjectPackageContract {
  const rootFile = byPath.get("package.json");
  const root = parseManifest(rootFile?.content ?? "", "package.json", issues);
  if (root.type !== "module") {
    issues.push('package.json must keep type "module".');
  }
  const directories = workspaceDirectories(root, byPath, issues);
  const scriptsByCwd = new Map<string, Record<string, string>>();
  const packageNamesByCwd = new Map<string, string>();
  const dependencies: Record<string, string> = {};
  let dependencyCount = 0;

  const manifests = [...byPath.entries()]
    .filter(([path]) => path === "package.json" || path.endsWith("/package.json"))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [path, item] of manifests) {
    const cwd = manifestCwd(path);
    if (!cwd) {
      issues.push(
        `${path} is not an allowed package manifest; packages must use packages/<safe-name>/package.json.`,
      );
      continue;
    }
    const manifest = path === "package.json"
      ? root
      : parseManifest(item.content, path, issues);
    if (path !== "package.json" && manifest.workspaces !== undefined) {
      issues.push(`${path} cannot declare nested npm workspaces.`);
    }
    validatePackageFields(manifest, path, issues);
    packageNamesByCwd.set(
      cwd,
      packageDisplayName(manifest, cwd, path, issues),
    );
    scriptsByCwd.set(
      cwd,
      packageScripts(manifest, path, issues, path === "package.json"),
    );
    const parsed = packageDependencies(manifest, path, issues);
    Object.assign(dependencies, parsed.dependencies);
    dependencyCount += parsed.count;
  }

  if (dependencyCount > PROJECT_WORKSPACE_DEPENDENCY_LIMIT) {
    issues.push(
      `A canonical AI workspace may declare at most ${PROJECT_WORKSPACE_DEPENDENCY_LIMIT} npm dependencies across all package manifests.`,
    );
  }
  return {
    dependencies,
    dependencyCount,
    scriptsByCwd,
    packageNamesByCwd,
    workspaceDirectories: directories,
  };
}

function npmTaskScript(args: string[]): string | null {
  if (args[0] === "test") return "test";
  if (args[0] === "start") return "start";
  if (args[0] === "run" && args[1]) return args[1];
  return null;
}

function isPackageInstallCommand(command: string | undefined): boolean {
  return [
    "add",
    "ci",
    "install",
    "i",
    "link",
    "rebuild",
    "remove",
    "uninstall",
    "update",
  ].includes(command?.toLowerCase() ?? "");
}

function validateTasks(
  tasks: ProjectWorkspaceTask[],
  contract: ProjectPackageContract,
  issues: string[],
): void {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 16) {
    issues.push("A workspace must declare between 1 and 16 bounded tasks.");
    return;
  }
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!TASK_ID.test(task.id) || seen.has(task.id)) {
      issues.push(`${task.id || "A task"} has an invalid or duplicate task id.`);
      continue;
    }
    seen.add(task.id);
    const cwd = task.cwd === undefined || task.cwd === "." ? "." : task.cwd;
    if (cwd !== "." && !contract.workspaceDirectories.includes(cwd)) {
      issues.push(`${task.id} cwd must be the root or a declared package workspace.`);
      continue;
    }
    if (
      task.command !== "npm" ||
      !Array.isArray(task.args) ||
      task.args.length < 1 ||
      task.args.length > 4 ||
      task.args.some((argument) => typeof argument !== "string" || !argument)
    ) {
      issues.push(`${task.id} must run one bounded npm script.`);
      continue;
    }
    if (isPackageInstallCommand(task.args[0])) {
      issues.push(`${task.id} cannot install packages directly.`);
      continue;
    }
    const script = npmTaskScript(task.args);
    const scripts = contract.scriptsByCwd.get(cwd) ?? {};
    if (!script || !Object.hasOwn(scripts, script)) {
      issues.push(
        `${task.id} must match a declared package.json script in ${cwd === "." ? "the root" : cwd}.`,
      );
    }
  }
}

function packageTaskHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(-7);
}

function packageTaskId(
  cwd: string,
  script: string,
  usedIds: Set<string>,
): string {
  const readable = `${cwd.slice("packages/".length)}-${script}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  let attempt = 0;
  while (attempt < 100) {
    const key = `${cwd}:${script}:${attempt}`;
    const id = `pkg-${readable.slice(0, 36)}-${packageTaskHash(key)}`;
    if (!usedIds.has(id)) return id;
    attempt += 1;
  }
  throw new Error("Could not derive a unique package task id.");
}

function sameTasks(
  left: ProjectWorkspaceTask[],
  right: ProjectWorkspaceTask[],
): boolean {
  return (
    left.length === right.length &&
    left.every((task, index) => {
      const candidate = right[index];
      return (
        candidate &&
        task.id === candidate.id &&
        task.label === candidate.label &&
        task.command === candidate.command &&
        task.cwd === candidate.cwd &&
        task.port === candidate.port &&
        task.args.length === candidate.args.length &&
        task.args.every((argument, argumentIndex) =>
          argument === candidate.args[argumentIndex]
        )
      );
    })
  );
}

export function reconcileProjectWorkspaceTasks(
  workspace: ProjectWorkspace,
): ProjectWorkspace {
  const issues: string[] = [];
  const contract = parsePackageGraph(
    new Map(workspace.files.map((item) => [item.path, item])),
    issues,
  );
  if (issues.length) {
    throw new Error(issues[0] ?? "Workspace package graph is invalid.");
  }

  const rootTasks = workspace.tasks
    .filter((task) => !task.cwd || task.cwd === ".")
    .slice(0, PROJECT_WORKSPACE_ROOT_TASK_LIMIT);
  const usedIds = new Set(rootTasks.map((task) => task.id));
  const ordered: Array<{ cwd: string; script: string }> = [];
  for (const script of PACKAGE_TASK_PRIORITY) {
    for (const cwd of contract.workspaceDirectories) {
      if (Object.hasOwn(contract.scriptsByCwd.get(cwd) ?? {}, script)) {
        ordered.push({ cwd, script });
      }
    }
  }
  for (const cwd of contract.workspaceDirectories) {
    const scripts = Object.keys(contract.scriptsByCwd.get(cwd) ?? {})
      .filter(
        (script) =>
          !PACKAGE_TASK_PRIORITY.includes(
            script as (typeof PACKAGE_TASK_PRIORITY)[number],
          ) && PACKAGE_SCRIPT_NAME.test(script),
      )
      .sort((left, right) => left.localeCompare(right));
    for (const script of scripts) ordered.push({ cwd, script });
  }

  const tasks = [...rootTasks];
  for (const { cwd, script } of ordered) {
    if (tasks.length >= PROJECT_WORKSPACE_TASK_LIMIT) break;
    const id = packageTaskId(cwd, script, usedIds);
    usedIds.add(id);
    const packageName = contract.packageNamesByCwd.get(cwd) ?? cwd;
    tasks.push({
      id,
      label: `${packageName} · ${script}`.slice(0, 80),
      command: "npm",
      args: ["run", script],
      cwd,
    });
  }

  return sameTasks(workspace.tasks, tasks)
    ? workspace
    : { ...workspace, tasks };
}

function validateProjectWorkspaceValue(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
): ProjectWorkspaceValidation {
  const issues: string[] = [];
  if (workspace.schemaVersion !== 1) issues.push("Unsupported workspace schema version.");
  if (!Number.isSafeInteger(workspace.revision) || workspace.revision < 1) {
    issues.push("Workspace revision must be a positive integer.");
  }
  if (
    typeof workspace.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(workspace.updatedAt))
  ) {
    issues.push("Workspace updatedAt must be a valid timestamp.");
  }
  const runtime = workspace.runtime;
  if (
    !runtime ||
    runtime.executionMode !== "static-preview" ||
    runtime.provider !== "unconfigured" ||
    runtime.isolation !== "browser-iframe" ||
    runtime.runtime !== "node24" ||
    runtime.packageManager !== "npm" ||
    runtime.installScripts !== false
  ) {
    issues.push("Workspace runtime must preserve the bounded Node 24 preview contract.");
  }
  if (!Array.isArray(workspace.files) || workspace.files.length > PROJECT_WORKSPACE_FILE_LIMIT) {
    issues.push(`A workspace may contain at most ${PROJECT_WORKSPACE_FILE_LIMIT} files.`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const item of workspace.files ?? []) {
    if (isUnsafeProjectWorkspacePath(item.path)) {
      issues.push(`${item.path || "A file"} has an unsafe workspace path.`);
    }
    if (!WORKSPACE_FILE_LANGUAGE_SET.has(item.language)) {
      issues.push(`${item.path} must use a supported workspace language.`);
    }
    if (!WORKSPACE_FILE_ROLE_SET.has(item.role)) {
      issues.push(`${item.path} must use a supported workspace file role.`);
    }
    if (typeof item.content !== "string" || typeof item.editable !== "boolean") {
      issues.push(`${item.path} must contain string source and an editable flag.`);
      continue;
    }
    if (seen.has(item.path)) issues.push(`${item.path} appears more than once.`);
    seen.add(item.path);
    const bytes = byteLength(item.content);
    totalBytes += bytes;
    if (bytes > PROJECT_WORKSPACE_FILE_BYTES_LIMIT) {
      issues.push(`${item.path} exceeds the 1.5 MB file limit.`);
    }
    const secrets = findArtifactSecrets(item.content, item.path);
    if (secrets.length) issues.push(new ArtifactSecretError(secrets).message);
  }
  if (totalBytes > PROJECT_WORKSPACE_BYTES_LIMIT) {
    issues.push("Workspace source exceeds the 1.5 MB total limit.");
  }
  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) issues.push(`${required} is required.`);
  }
  const byPath = new Map((workspace.files ?? []).map((item) => [item.path, item]));
  const index = byPath.get("index.html")?.content ?? "";
  if (!index.includes(`data-project-kind="${spec.presetId}"`)) {
    issues.push("index.html must preserve the product-kind contract.");
  }
  const stylesheetReferences =
    index.match(
      /<link\b[^>]*\bhref\s*=\s*["']\.\/src\/styles\.css["'][^>]*>/gi,
    ) ?? [];
  const runtimeReferences =
    index.match(
      /<script\b[^>]*\bsrc\s*=\s*["']\.\/src\/app\.js["'][^>]*>\s*<\/script\s*>/gi,
    ) ?? [];
  if (
    stylesheetReferences.length !== 1 ||
    stylesheetReferences[0] !== CANONICAL_STYLESHEET_LINK ||
    runtimeReferences.length !== 1 ||
    runtimeReferences[0] !== CANONICAL_RUNTIME_SCRIPT
  ) {
    issues.push(
      "index.html must load src/styles.css and src/app.js using the exact canonical entry tags.",
    );
  }
  issues.push(...unexpectedRuntimeActiveContent(index, "canonical-workspace"));
  if (/<\/style/i.test(byPath.get("src/styles.css")?.content ?? "")) {
    issues.push("src/styles.css cannot close the runtime style element.");
  }
  if (/<\/script/i.test(byPath.get("src/app.js")?.content ?? "")) {
    issues.push("src/app.js cannot close the runtime script element.");
  }
  const packageContract = parsePackageGraph(byPath, issues);
  validateTasks(workspace.tasks, packageContract, issues);
  return { valid: issues.length === 0, issues };
}

export function validateProjectWorkspace(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
): ProjectWorkspaceValidation;
export function validateProjectWorkspace(
  spec: GeneratedProjectSpec,
  workspace: unknown,
): ProjectWorkspaceValidation;
export function validateProjectWorkspace(
  spec: GeneratedProjectSpec,
  workspace: unknown,
): ProjectWorkspaceValidation {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return { valid: false, issues: ["Workspace must be one bounded object."] };
  }
  try {
    return validateProjectWorkspaceValue(spec, workspace as ProjectWorkspace);
  } catch {
    return {
      valid: false,
      issues: ["Workspace persisted structure is malformed and was rejected."],
    };
  }
}

function requiredFile(workspace: ProjectWorkspace, path: string): ProjectWorkspaceFile {
  const item = workspace.files.find((candidate) => candidate.path === path);
  if (!item) throw new Error(`${path} is missing from the workspace.`);
  return item;
}

export function compileWorkspaceRuntime(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
): string {
  const validation = validateProjectWorkspace(spec, workspace);
  if (!validation.valid) throw new Error(validation.issues[0] ?? "Workspace validation failed.");
  const index = requiredFile(workspace, "index.html").content;
  const css = requiredFile(workspace, "src/styles.css").content;
  const javascript = requiredFile(workspace, "src/app.js").content;
  const runtime = index
    .replace(CANONICAL_STYLESHEET_LINK, () => `<style>${css}</style>`)
    .replace(CANONICAL_RUNTIME_SCRIPT, () => `<script>${javascript}</script>`);
  const runtimeValidation = validateEditableRuntimeHtml(spec, runtime);
  if (!runtimeValidation.valid) {
    throw new Error(runtimeValidation.issues[0] ?? "Compiled workspace runtime is invalid.");
  }
  return runtime;
}

export function updateWorkspaceFile(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
  path: string,
  content: string,
): ProjectWorkspace {
  const existing = workspace.files.find((item) => item.path === path);
  if (!existing) throw new Error(`${path} is not part of this workspace.`);
  if (!existing.editable) throw new Error(`${path} is read-only.`);
  const secrets = findArtifactSecrets(content, path);
  if (secrets.length) throw new ArtifactSecretError(secrets);
  const next = reconcileProjectWorkspaceTasks({
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: new Date().toISOString(),
    files: workspace.files.map((item) =>
      item.path === path ? { ...item, content } : item,
    ),
  });
  const validation = validateProjectWorkspace(spec, next);
  if (!validation.valid) throw new Error(validation.issues[0] ?? "Workspace validation failed.");
  return next;
}

export function addWorkspaceFile(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
  input: Omit<ProjectWorkspaceFile, "editable"> & { editable?: boolean },
): ProjectWorkspace {
  if (isUnsafeProjectWorkspacePath(input.path)) {
    throw new Error(`${input.path || "A file"} has an unsafe workspace path.`);
  }
  if (workspace.files.some((item) => item.path === input.path)) {
    throw new Error(`${input.path} already exists in this workspace.`);
  }
  if (workspace.files.length >= PROJECT_WORKSPACE_FILE_LIMIT) {
    throw new Error(`A workspace may contain at most ${PROJECT_WORKSPACE_FILE_LIMIT} files.`);
  }
  const secrets = findArtifactSecrets(input.content, input.path);
  if (secrets.length) throw new ArtifactSecretError(secrets);
  const next = reconcileProjectWorkspaceTasks({
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: new Date().toISOString(),
    files: [
      ...workspace.files,
      { ...input, editable: input.editable ?? true },
    ],
  });
  const validation = validateProjectWorkspace(spec, next);
  if (!validation.valid) throw new Error(validation.issues[0] ?? "Workspace validation failed.");
  return next;
}

export function deleteWorkspaceFile(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
  path: string,
): ProjectWorkspace {
  if ((REQUIRED_FILES as readonly string[]).includes(path)) {
    throw new Error(`${path} is a required workspace file and cannot be deleted.`);
  }
  const existing = workspace.files.find((item) => item.path === path);
  if (!existing) throw new Error(`${path} is not part of this workspace.`);
  if (!existing.editable) throw new Error(`${path} is read-only.`);
  const next = reconcileProjectWorkspaceTasks({
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: new Date().toISOString(),
    files: workspace.files.filter((item) => item.path !== path),
  });
  const validation = validateProjectWorkspace(spec, next);
  if (!validation.valid) throw new Error(validation.issues[0] ?? "Workspace validation failed.");
  return next;
}

export function workspaceFilesForSandbox(
  spec: GeneratedProjectSpec,
  workspace: ProjectWorkspace,
): {
  files: Array<{ path: string; content: string }>;
  dependencies: Record<string, string>;
} {
  const validation = validateProjectWorkspace(spec, workspace);
  if (!validation.valid) throw new Error(validation.issues[0] ?? "Workspace validation failed.");
  const packageIssues: string[] = [];
  const dependencies = parsePackageGraph(
    new Map(workspace.files.map((item) => [item.path, item])),
    packageIssues,
  ).dependencies;
  if (packageIssues.length) throw new Error(packageIssues[0]);
  return {
    files: workspace.files.map(({ path, content }) => ({ path, content })),
    dependencies,
  };
}
