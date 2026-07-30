import { findArtifactSecrets } from "./artifact-security.ts";
import { createWorkspaceRunDigest } from "./workspace-run-digest.ts";

const MAX_FILES = 64;
const MAX_TASKS = 16;
const MAX_TOTAL_BYTES = 1_500_000;
const MAX_OUTPUT_BYTES = 64_000;
const MAX_DEPENDENCIES = 64;
const MAX_PACKAGE_WORKSPACES = 6;
const MAX_TASK_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 30_000;
const MAX_RUNTIME_ASSET_BYTES = 1_500_000;
const RUNTIME_ASSET_FETCH_TIMEOUT_MS = 5_000;
const WORKSPACE_ROOT = "/vercel/sandbox";
const RUNTIME_ASSET_PATHS = [
  "brand/dropstab-mark.svg",
  "brand/drops-bot-avatar.jpg",
  "assets/market-catcher-retro.png",
  "assets/market-wolf-catcher.png",
] as const;
const BLOCKED_WORKSPACE_FILES = new Set([
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
const LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
]);
const BLOCKED_NODE_FLAGS = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
]);
const BLOCKED_NPM_COMMANDS = new Set([
  "add",
  "ci",
  "install",
  "i",
  "link",
  "rebuild",
  "remove",
  "uninstall",
  "update",
]);
const PACKAGE_WORKSPACE_PATH = /^packages\/[a-z0-9][a-z0-9._-]{0,63}$/;
const PACKAGE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,47}$/;

export interface WorkspaceSandboxFile {
  path: string;
  content: string;
}

export interface WorkspaceSandboxTask {
  id: string;
  argv?: string[];
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  previewPort?: number;
  port?: number;
}

export interface WorkspaceSandboxDefinition {
  id?: string;
  revision: number;
  files: WorkspaceSandboxFile[];
  tasks: WorkspaceSandboxTask[];
}

export interface WorkspaceSandboxRunInput {
  workspaceId?: string;
  workspace: WorkspaceSandboxDefinition;
  taskId: string;
}

export interface NormalizedWorkspaceSandboxTask {
  id: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  previewPort?: number;
}

export interface ValidatedWorkspaceSandboxRun {
  workspaceId: string;
  revision: number;
  files: WorkspaceSandboxFile[];
  task: NormalizedWorkspaceSandboxTask;
  dependencies: Record<string, string>;
  workspaceDirectories: string[];
}

export interface WorkspaceSandboxProviderResult {
  provider: "vercel-sandbox";
  isolation: "firecracker-microvm";
  providerRunId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  previewUrl: string | null;
}

export interface WorkspaceSandboxProvider {
  execute(
    input: ValidatedWorkspaceSandboxRun,
  ): Promise<WorkspaceSandboxProviderResult>;
}

function configuredRuntimeAssetOrigin(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function loadWorkspaceRuntimeAssets(
  files: WorkspaceSandboxFile[],
  options: {
    origin?: string | null;
    fetch?: typeof fetch;
    fetchTimeoutMs?: number;
  } = {},
): Promise<Array<{ path: string; content: Uint8Array }>> {
  const source = files.map((file) => file.content).join("\n");
  const paths = RUNTIME_ASSET_PATHS.filter((path) =>
    source.includes(`/${path}`),
  );
  if (!paths.length) return [];
  const origin = options.origin ?? configuredRuntimeAssetOrigin();
  if (!origin) {
    throw new WorkspaceSandboxUnavailableError(
      "The deployment origin for preview assets is not configured.",
    );
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
    if (
      parsedOrigin.protocol !== "https:" ||
      parsedOrigin.username ||
      parsedOrigin.password
    ) {
      throw new Error();
    }
  } catch {
    throw new WorkspaceSandboxUnavailableError(
      "The deployment origin for preview assets is invalid.",
    );
  }
  const fetchAsset = options.fetch ?? fetch;
  const requestedFetchTimeoutMs =
    Number.isSafeInteger(options.fetchTimeoutMs)
    && Number(options.fetchTimeoutMs) > 0
      ? Number(options.fetchTimeoutMs)
      : RUNTIME_ASSET_FETCH_TIMEOUT_MS;
  const fetchTimeoutMs = Math.min(
    requestedFetchTimeoutMs,
    RUNTIME_ASSET_FETCH_TIMEOUT_MS,
  );
  return Promise.all(
    paths.map(async (path) => {
      const signal = AbortSignal.timeout(fetchTimeoutMs);
      try {
        const response = await fetchAsset(new URL(`/${path}`, parsedOrigin), {
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          throw new WorkspaceSandboxProviderError(
            `Required preview asset ${path} is unavailable.`,
          );
        }
        const content = new Uint8Array(await response.arrayBuffer());
        if (!content.byteLength || content.byteLength > MAX_RUNTIME_ASSET_BYTES) {
          throw new WorkspaceSandboxProviderError(
            `Required preview asset ${path} has an invalid size.`,
          );
        }
        return { path, content };
      } catch (error) {
        if (error instanceof WorkspaceSandboxProviderError) throw error;
        throw new WorkspaceSandboxProviderError(
          signal.aborted
            ? `Required preview asset ${path} timed out.`
            : `Required preview asset ${path} is unavailable.`,
        );
      }
    }),
  );
}

export interface WorkspaceSandboxReceipt {
  provider: "vercel-sandbox";
  isolation: "firecracker-microvm";
  providerRunId: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceDigest: string;
  task: string;
  argv: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  previewUrl: string | null;
}

function secretFreeMessage(
  value: unknown,
  fallback: string,
): string {
  const message = value instanceof Error ? value.message : String(value || "");
  if (!message || findArtifactSecrets(message, "sandbox error").length) {
    return fallback;
  }
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 220) || fallback;
}

export class WorkspaceSandboxValidationError extends Error {
  constructor(message: string) {
    super(secretFreeMessage(message, "Workspace sandbox input is invalid."));
    this.name = "WorkspaceSandboxValidationError";
  }
}

export class WorkspaceSandboxUnavailableError extends Error {
  constructor(message = "Workspace sandbox execution is not configured.") {
    super(
      secretFreeMessage(
        message,
        "Workspace sandbox execution is not configured.",
      ),
    );
    this.name = "WorkspaceSandboxUnavailableError";
  }
}

export class WorkspaceSandboxProviderError extends Error {
  constructor(message = "Workspace sandbox provider failed.") {
    super(secretFreeMessage(message, "Workspace sandbox provider failed."));
    this.name = "WorkspaceSandboxProviderError";
  }
}

function fail(message: string): never {
  throw new WorkspaceSandboxValidationError(message);
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function safeWorkspacePath(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a relative path.`);
  const path = value.trim();
  if (
    !path ||
    path.length > 180 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.includes("\0") ||
    !/^[a-z0-9@._/-]+$/i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail(`${label} must stay inside the workspace.`);
  }
  const fileName = path.toLowerCase().split("/").at(-1) ?? "";
  if (BLOCKED_WORKSPACE_FILES.has(fileName)) {
    fail(`${label} is blocked from sandbox execution.`);
  }
  return path;
}

function safeWorkingDirectory(value: unknown): string {
  if (value === undefined || value === null || value === "" || value === ".") {
    return ".";
  }
  return safeWorkspacePath(value, "Task cwd");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function workspaceFiles(value: unknown): WorkspaceSandboxFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    fail(`Workspace must contain between 1 and ${MAX_FILES} files.`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  return value.map((item, index) => {
    const input = object(item, `Workspace file ${index + 1}`);
    const path = safeWorkspacePath(input.path, `Workspace file ${index + 1} path`);
    if (seen.has(path)) fail(`Workspace file path ${path} is duplicated.`);
    seen.add(path);
    if (typeof input.content !== "string") {
      fail(`Workspace file ${path} must contain text.`);
    }
    totalBytes += byteLength(input.content);
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail("Workspace files exceed the sandbox size limit.");
    }
    if (findArtifactSecrets(input.content, path).length) {
      fail("Workspace files contain potential secret material.");
    }
    return { path, content: input.content };
  });
}

function packageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(
    value,
  );
}

function registryVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i.test(value)
  );
}

function dependencySet(
  value: unknown,
  label: string,
): Record<string, string> {
  if (value === undefined) return {};
  const input = object(value, label);
  const entries = Object.entries(input);
  if (entries.length > MAX_DEPENDENCIES) {
    fail(`${label} exceeds the dependency limit.`);
  }
  const dependencies: Record<string, string> = {};
  for (const [name, version] of entries) {
    if (!packageName(name) || !registryVersion(version)) {
      fail(`${label} must use exact npm registry versions.`);
    }
    dependencies[name] = version;
  }
  return dependencies;
}

interface SandboxPackageContract {
  dependencies: Record<string, string>;
  dependencyCount: number;
  scriptsByCwd: Map<string, Record<string, string>>;
  workspaceDirectories: string[];
}

function parsePackageManifest(
  file: WorkspaceSandboxFile,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content) as unknown;
  } catch {
    fail(`${file.path} must contain valid JSON.`);
  }
  return object(parsed, file.path);
}

function packageManifestCwd(path: string): string | null {
  if (path === "package.json") return ".";
  const match = /^(packages\/[a-z0-9][a-z0-9._-]{0,63})\/package\.json$/.exec(
    path,
  );
  return match?.[1] ?? null;
}

function declaredWorkspaceDirectories(
  root: Record<string, unknown>,
  filePaths: Set<string>,
): string[] {
  if (root.workspaces === undefined) return [];
  if (!Array.isArray(root.workspaces)) {
    fail("package.json workspaces must be an array of explicit package directories.");
  }
  if (root.workspaces.length > MAX_PACKAGE_WORKSPACES) {
    fail(`A sandbox workspace may declare at most ${MAX_PACKAGE_WORKSPACES} packages.`);
  }
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const value of root.workspaces) {
    if (typeof value !== "string" || !PACKAGE_WORKSPACE_PATH.test(value)) {
      fail(
        "package.json workspaces must use explicit packages/<safe-name> directories without globs, URLs or traversal.",
      );
    }
    if (seen.has(value)) {
      fail(`package.json workspace ${value} is duplicated.`);
    }
    seen.add(value);
    directories.push(value);
    if (!filePaths.has(`${value}/package.json`)) {
      fail(`${value}/package.json is required by the root workspace declaration.`);
    }
  }
  return directories;
}

function packageManifestScripts(
  input: Record<string, unknown>,
  path: string,
): Record<string, string> {
  const scriptsInput = input.scripts === undefined
    ? {}
    : object(input.scripts, `${path} scripts`);
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(scriptsInput)) {
    if (LIFECYCLE_SCRIPTS.has(name.toLowerCase())) {
      fail(`npm lifecycle scripts are blocked in ${path}.`);
    }
    if (!PACKAGE_SCRIPT_NAME.test(name)) {
      fail(`${path} script names must be bounded and alphanumeric.`);
    }
    if (
      typeof command !== "string" ||
      !command.trim() ||
      command.length > 500 ||
      findArtifactSecrets(command, `${path} script ${name}`).length
    ) {
      fail(`${path} script ${name} is invalid.`);
    }
    scripts[name] = command;
  }
  return scripts;
}

function validatePackageManifestFields(
  input: Record<string, unknown>,
  path: string,
): void {
  if (input.private !== true) {
    fail(`${path} must set private to true.`);
  }
  for (const field of [
    "overrides",
    "resolutions",
    "pnpm",
    "publishConfig",
  ]) {
    if (input[field] !== undefined) {
      fail(`${path} ${field} is blocked from the bounded sandbox package contract.`);
    }
  }
  const config = input.config;
  if (
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    "registry" in config
  ) {
    fail(`${path} cannot declare a custom npm registry.`);
  }
  for (const field of [
    "optionalDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ]) {
    if (
      input[field] &&
      typeof input[field] === "object" &&
      !Array.isArray(input[field]) &&
      Object.keys(input[field] as object).length
    ) {
      fail(`${path} ${field} is blocked from sandbox installation.`);
    }
  }
}

function packageContract(files: WorkspaceSandboxFile[]): {
  dependencies: Record<string, string>;
  dependencyCount: number;
  scriptsByCwd: Map<string, Record<string, string>>;
  workspaceDirectories: string[];
} {
  const packageFile = files.find((file) => file.path === "package.json");
  if (!packageFile) {
    return {
      dependencies: {},
      dependencyCount: 0,
      scriptsByCwd: new Map([[".", {}]]),
      workspaceDirectories: [],
    };
  }
  const root = parsePackageManifest(packageFile);
  const filePaths = new Set(files.map((file) => file.path));
  const workspaceDirectories = declaredWorkspaceDirectories(root, filePaths);
  const manifests = files
    .filter((file) =>
      file.path === "package.json" || file.path.endsWith("/package.json")
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const dependencies: Record<string, string> = {};
  const scriptsByCwd = new Map<string, Record<string, string>>();
  let dependencyCount = 0;
  for (const manifestFile of manifests) {
    const cwd = packageManifestCwd(manifestFile.path);
    if (!cwd) {
      fail(
        `${manifestFile.path} is not allowed; package manifests must use packages/<safe-name>/package.json.`,
      );
    }
    const input = manifestFile.path === "package.json"
      ? root
      : parsePackageManifest(manifestFile);
    if (manifestFile.path !== "package.json" && input.workspaces !== undefined) {
      fail(`${manifestFile.path} cannot declare nested npm workspaces.`);
    }
    validatePackageManifestFields(input, manifestFile.path);
    scriptsByCwd.set(
      cwd,
      packageManifestScripts(input, manifestFile.path),
    );
    const runtimeDependencies = dependencySet(
      input.dependencies,
      `${manifestFile.path} dependencies`,
    );
    const developmentDependencies = dependencySet(
      input.devDependencies,
      `${manifestFile.path} devDependencies`,
    );
    dependencyCount +=
      Object.keys(runtimeDependencies).length +
      Object.keys(developmentDependencies).length;
    Object.assign(dependencies, runtimeDependencies, developmentDependencies);
  }
  if (dependencyCount > MAX_DEPENDENCIES) {
    fail(
      `Workspace package manifests exceed the aggregate ${MAX_DEPENDENCIES} dependency limit.`,
    );
  }
  return {
    dependencies,
    dependencyCount,
    scriptsByCwd,
    workspaceDirectories,
  };
}

function safeArgument(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    findArtifactSecrets(value, label).length
  ) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function validateNodeArguments(argv: string[]): void {
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const flag = argument.split("=", 1)[0];
    if (BLOCKED_NODE_FLAGS.has(flag)) {
      fail(`Node flag ${flag} is blocked from workspace tasks.`);
    }
    if (
      !argument.startsWith("-") &&
      (argument.startsWith("/") || argument.includes("\\") || argument
        .split("/")
        .some((part) => part === ".."))
    ) {
      fail("Node task arguments must stay inside the workspace.");
    }
  }
}

function validateNpmArguments(
  argv: string[],
  scripts: Record<string, string>,
): void {
  const command = argv[1] ?? "";
  if (BLOCKED_NPM_COMMANDS.has(command.toLowerCase())) {
    fail("Workspace tasks cannot install packages directly.");
  }
  const scriptName = command === "test"
    ? "test"
    : command === "start"
      ? "start"
    : command === "run"
      ? argv[2] ?? ""
      : "";
  if (!scriptName || !Object.hasOwn(scripts, scriptName)) {
    fail("npm workspace tasks must run a declared package.json script for their cwd.");
  }
}

function workspaceTasks(
  value: unknown,
  packageJson: SandboxPackageContract,
): NormalizedWorkspaceSandboxTask[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TASKS) {
    fail(`Workspace must contain between 1 and ${MAX_TASKS} tasks.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const input = object(item, `Workspace task ${index + 1}`);
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/i.test(id) || seen.has(id)) {
      fail(`Workspace task ${index + 1} has an invalid or duplicate id.`);
    }
    seen.add(id);
    const hasArgv = Array.isArray(input.argv);
    const hasCommandArgs =
      typeof input.command === "string" && Array.isArray(input.args);
    if (hasArgv === hasCommandArgs) {
      fail(
        `Workspace task ${id} must declare either argv or command with args.`,
      );
    }
    const rawArgv = hasArgv
      ? input.argv as unknown[]
      : [input.command, ...(input.args as unknown[])];
    if (rawArgv.length < 2 || rawArgv.length > 24) {
      fail(`Workspace task ${id} must declare a bounded argv array.`);
    }
    const argv = rawArgv.map((argument, argumentIndex) =>
      safeArgument(argument, `Workspace task ${id} argument ${argumentIndex + 1}`),
    );
    if (argv[0] !== "node" && argv[0] !== "npm") {
      fail("Workspace tasks may execute only node or declared npm scripts.");
    }
    const cwd = safeWorkingDirectory(input.cwd);
    if (
      cwd !== "." &&
      !packageJson.workspaceDirectories.includes(cwd)
    ) {
      fail("Task cwd must be the root or a declared package workspace.");
    }
    if (argv[0] === "node") validateNodeArguments(argv);
    else {
      validateNpmArguments(
        argv,
        packageJson.scriptsByCwd.get(cwd) ?? {},
      );
    }
    const timeoutMs = input.timeoutMs === undefined
      ? 15_000
      : Number(input.timeoutMs);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > MAX_TASK_TIMEOUT_MS
    ) {
      fail(`Workspace task ${id} has an invalid timeout.`);
    }
    if (input.previewPort !== undefined && input.port !== undefined) {
      fail(`Workspace task ${id} declares more than one preview port.`);
    }
    const rawPreviewPort = input.previewPort ?? input.port;
    const previewPort = rawPreviewPort === undefined
      ? undefined
      : Number(rawPreviewPort);
    if (
      previewPort !== undefined &&
      (!Number.isSafeInteger(previewPort) ||
        previewPort < 1_024 ||
        previewPort > 65_535)
    ) {
      fail(`Workspace task ${id} has an invalid preview port.`);
    }
    return {
      id,
      argv,
      cwd,
      timeoutMs,
      ...(previewPort === undefined ? {} : { previewPort }),
    };
  });
}

export function validateWorkspaceSandboxRun(
  value: unknown,
): ValidatedWorkspaceSandboxRun {
  const input = object(value, "Workspace sandbox request");
  if ("argv" in input || "cmd" in input || "command" in input) {
    fail("Raw commands are not accepted; select a declared workspace task.");
  }
  const workspace = object(input.workspace, "Workspace");
  const workspaceIdValue = input.workspaceId ?? workspace.id;
  const workspaceId = typeof workspaceIdValue === "string"
    ? workspaceIdValue.trim()
    : "";
  if (!/^[a-z0-9][a-z0-9_-]{2,127}$/i.test(workspaceId)) {
    fail("Workspace id is invalid.");
  }
  const revision = Number(workspace.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    fail("Workspace revision is invalid.");
  }
  const files = workspaceFiles(workspace.files);
  const packageJson = packageContract(files);
  const tasks = workspaceTasks(workspace.tasks, packageJson);
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) fail("Requested task is not declared by this workspace.");
  return {
    workspaceId,
    revision,
    files,
    task: {
      id: task.id,
      argv: [...task.argv],
      cwd: task.cwd ?? ".",
      timeoutMs: task.timeoutMs ?? 15_000,
      ...(task.previewPort === undefined
        ? {}
        : { previewPort: task.previewPort }),
    },
    dependencies: packageJson.dependencies,
    workspaceDirectories: [...packageJson.workspaceDirectories],
  };
}

function safeTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new WorkspaceSandboxProviderError(
      `Sandbox provider returned an invalid ${label}.`,
    );
  }
  return new Date(value).toISOString();
}

function safeProviderRunId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9:._-]{5,255}$/i.test(value)
  ) {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider returned an invalid run id.",
    );
  }
  return value;
}

function safeOutput(value: unknown, label: string): string {
  const output = typeof value === "string" ? value.slice(0, MAX_OUTPUT_BYTES) : "";
  if (findArtifactSecrets(output, label).length) {
    return "[redacted secret material]";
  }
  return output.replace(/\u0000/g, "");
}

function safePreviewUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider returned an invalid preview URL.",
    );
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider returned an invalid preview URL.",
    );
  }
}

export function workspaceSandboxConfigured(): boolean {
  return Boolean(
    process.env.VERCEL_OIDC_TOKEN ||
      (process.env.VERCEL_TEAM_ID &&
        process.env.VERCEL_PROJECT_ID &&
        process.env.VERCEL_TOKEN),
  );
}

function taskCwd(task: ValidatedWorkspaceSandboxRun["task"]): string {
  return task.cwd === "." ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${task.cwd}`;
}

async function commandResult(
  command: {
    exitCode: number;
    startedAt: number;
    durationMs?: number;
    stdout(): Promise<string>;
    stderr(): Promise<string>;
  },
): Promise<Pick<
  WorkspaceSandboxProviderResult,
  "exitCode" | "stdout" | "stderr" | "startedAt" | "finishedAt"
>> {
  const [stdout, stderr] = await Promise.all([
    command.stdout(),
    command.stderr(),
  ]);
  const started = new Date(command.startedAt);
  const finished = new Date(
    command.startedAt + Math.max(0, command.durationMs ?? 0),
  );
  return {
    exitCode: command.exitCode,
    stdout,
    stderr,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
  };
}

export const vercelWorkspaceSandboxProvider: WorkspaceSandboxProvider = {
  async execute(input) {
    if (!workspaceSandboxConfigured()) {
      throw new WorkspaceSandboxUnavailableError(
        "Vercel Sandbox is not configured for this deployment.",
      );
    }
    const { Sandbox } = await import("@vercel/sandbox");
    const dependencyInstall = Object.keys(input.dependencies).length > 0;
    const packageInstall =
      dependencyInstall || input.workspaceDirectories.length > 0;
    let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | null = null;
    let keepPreview = false;
    try {
      sandbox = await Sandbox.create({
        name: `drops-${input.workspaceId.slice(0, 28)}-${crypto
          .randomUUID()
          .slice(0, 8)}`,
        runtime: "node24",
        resources: { vcpus: 1 },
        timeout: 300_000,
        ports: input.task.previewPort ? [input.task.previewPort] : [],
        persistent: false,
        networkPolicy: dependencyInstall
          ? { allow: ["registry.npmjs.org", "*.npmjs.org"] }
          : "deny-all",
        tags: {
          product: "drops-studio",
          workspace: input.workspaceId.slice(0, 48),
        },
      });
      await sandbox.writeFiles(
        input.files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      );
      if (input.task.previewPort) {
        const runtimeAssets = await loadWorkspaceRuntimeAssets(input.files);
        if (runtimeAssets.length) await sandbox.writeFiles(runtimeAssets);
      }

      if (packageInstall) {
        const install = await sandbox.runCommand({
          cmd: "npm",
          args: [
            "install",
            ...(input.workspaceDirectories.length
              ? ["--workspaces", "--include-workspace-root"]
              : []),
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--package-lock=false",
          ],
          cwd: WORKSPACE_ROOT,
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        if (install.exitCode !== 0) {
          return {
            provider: "vercel-sandbox",
            isolation: "firecracker-microvm",
            providerRunId: `${sandbox.name}:${sandbox.currentSession().sessionId}`,
            ...(await commandResult(install)),
            previewUrl: null,
          };
        }
        await sandbox.update({ networkPolicy: "deny-all" });
      }

      const [cmd, ...args] = input.task.argv;
      if (input.task.previewPort) {
        const previewCommand = await sandbox.runCommand({
          cmd,
          args,
          cwd: taskCwd(input.task),
          detached: true,
        });
        const previewPort = input.task.previewPort;
        const readiness = await sandbox.runCommand({
          cmd: "node",
          args: [
            "-e",
            `const url = "http://127.0.0.1:${previewPort}/"; const deadline = Date.now() + 7000; while (Date.now() < deadline) { try { const response = await fetch(url); if (response.status < 500) { console.log("Preview process is ready"); process.exit(0); } } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error("Preview process did not become ready");`,
          ],
          cwd: WORKSPACE_ROOT,
          timeoutMs: 8_000,
        });
        const output = await commandResult(readiness);
        let previewUrl: string | null = null;
        if (readiness.exitCode === 0) {
          previewUrl = sandbox.domain(previewPort);
          keepPreview = true;
        } else {
          await previewCommand.kill().catch(() => undefined);
        }
        return {
          provider: "vercel-sandbox",
          isolation: "firecracker-microvm",
          providerRunId: `${sandbox.name}:${sandbox.currentSession().sessionId}:${previewCommand.cmdId}`,
          ...output,
          exitCode: previewUrl ? null : output.exitCode,
          previewUrl,
        };
      }
      const command = await sandbox.runCommand({
        cmd,
        args,
        cwd: taskCwd(input.task),
        timeoutMs: input.task.timeoutMs,
      });
      const output = await commandResult(command);
      return {
        provider: "vercel-sandbox",
        isolation: "firecracker-microvm",
        providerRunId: `${sandbox.name}:${sandbox.currentSession().sessionId}`,
        ...output,
        previewUrl: null,
      };
    } catch (error) {
      if (error instanceof WorkspaceSandboxUnavailableError) throw error;
      throw new WorkspaceSandboxProviderError(
        secretFreeMessage(error, "Vercel Sandbox execution failed."),
      );
    } finally {
      if (sandbox && !keepPreview) {
        await sandbox.stop().catch(() => undefined);
      }
    }
  },
};

export async function runWorkspaceSandbox(
  input: unknown,
  options: { provider?: WorkspaceSandboxProvider } = {},
): Promise<WorkspaceSandboxReceipt> {
  const validated = validateWorkspaceSandboxRun(input);
  const workspaceDigest = await createWorkspaceRunDigest({
    files: validated.files,
    task: {
      id: validated.task.id,
      argv: validated.task.argv,
      cwd: validated.task.cwd,
      timeoutMs: validated.task.timeoutMs,
      previewPort: validated.task.previewPort,
    },
  });
  let result: WorkspaceSandboxProviderResult;
  try {
    result = await (options.provider ?? vercelWorkspaceSandboxProvider).execute(
      validated,
    );
  } catch (error) {
    if (error instanceof WorkspaceSandboxUnavailableError) {
      throw new WorkspaceSandboxUnavailableError(error.message);
    }
    if (error instanceof WorkspaceSandboxProviderError) {
      throw new WorkspaceSandboxProviderError(error.message);
    }
    throw new WorkspaceSandboxProviderError(
      secretFreeMessage(error, "Workspace sandbox provider failed."),
    );
  }

  const startedAt = safeTimestamp(result.startedAt, "start timestamp");
  const finishedAt = safeTimestamp(result.finishedAt, "finish timestamp");
  if (
    result.provider !== "vercel-sandbox" ||
    result.isolation !== "firecracker-microvm"
  ) {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider did not return verified execution evidence.",
    );
  }
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider returned timestamps out of order.",
    );
  }
  const previewUrl = safePreviewUrl(result.previewUrl);
  if (
    result.exitCode !== null &&
    !Number.isSafeInteger(result.exitCode)
  ) {
    throw new WorkspaceSandboxProviderError(
      "Sandbox provider returned an invalid exit code.",
    );
  }
  if (result.exitCode === null && !previewUrl) {
    throw new WorkspaceSandboxProviderError(
      "A running sandbox process requires a verified preview URL.",
    );
  }
  return {
    provider: result.provider,
    isolation: result.isolation,
    providerRunId: safeProviderRunId(result.providerRunId),
    workspaceId: validated.workspaceId,
    workspaceRevision: validated.revision,
    workspaceDigest,
    task: validated.task.id,
    argv: [...validated.task.argv],
    exitCode: result.exitCode,
    stdout: safeOutput(result.stdout, "sandbox stdout"),
    stderr: safeOutput(result.stderr, "sandbox stderr"),
    startedAt,
    finishedAt,
    previewUrl,
  };
}
