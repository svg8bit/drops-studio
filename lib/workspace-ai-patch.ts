import { z } from "zod";
import {
  ArtifactSecretError,
  findArtifactSecrets,
} from "./artifact-security.ts";
import type { GeneratedProjectSpec } from "./project-types.ts";
import type {
  ProjectWorkspace,
  ProjectWorkspaceFile,
} from "./project-workspace.ts";
import {
  compileWorkspaceRuntime,
  isUnsafeProjectWorkspacePath,
  PROJECT_WORKSPACE_FILE_LANGUAGES,
  PROJECT_WORKSPACE_FILE_ROLES,
  reconcileProjectWorkspaceTasks,
  validateProjectWorkspace,
} from "./project-workspace.ts";
import { projectPresetIds } from "./presets.ts";
import { validateWorkspaceSandboxRun } from "./workspace-sandbox.ts";

export const WORKSPACE_AI_OPERATION_LIMIT = 24;
export const WORKSPACE_AI_FILE_LIMIT = 64;
export const WORKSPACE_AI_FILE_BYTES_LIMIT = 512_000;
export const WORKSPACE_AI_TOTAL_BYTES_LIMIT = 1_500_000;
export const WORKSPACE_AI_PROMPT_LIMIT = 8_000;
export const WORKSPACE_AI_PACKAGE_LIMIT = 6;
export const WORKSPACE_AI_DEPENDENCY_LIMIT = 24;
export const WORKSPACE_AI_TASK_LIMIT = 16;

const REQUIRED_WORKSPACE_FILES = new Set([
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
]);

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

const BLOCKED_EXECUTABLE_EXTENSIONS = [
  ".bash",
  ".bat",
  ".cmd",
  ".fish",
  ".ps1",
  ".sh",
  ".zsh",
];

const CODE_FILE_EXTENSIONS = [
  ".cjs",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
];

const UNSAFE_EXECUTABLE_PATTERNS: Array<[RegExp, string]> = [
  [/\beval\s*\(/i, "eval is an executable escape hatch"],
  [/\bnew\s+Function\b/i, "new Function is an executable escape hatch"],
  [/(?:node:)?child_process/i, "child_process is not available to generated files"],
  [/\bprocess\s*\.\s*binding\s*\(/i, "process.binding is an executable escape hatch"],
  [/\bBun\s*\.\s*(?:spawn|spawnSync)\s*\(/i, "Bun process spawning is not available"],
  [/\bDeno\s*\.\s*(?:Command|run)\b/i, "Deno process spawning is not available"],
];

const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_REGISTRY_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_WORKSPACE_PATH = /^packages\/[a-z0-9][a-z0-9._-]{0,63}$/;
const PACKAGE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,47}$/;
const AI_CREATED_PACKAGE_SCRIPTS = new Set([
  "start",
  "build",
  "test",
  "check",
  "lint",
  "typecheck",
]);

const fileRoleSchema = z.enum(PROJECT_WORKSPACE_FILE_ROLES);
const fileLanguageSchema = z.enum(PROJECT_WORKSPACE_FILE_LANGUAGES);

const createOperationSchema = z
  .object({
    type: z.literal("create"),
    path: z.string().min(1).max(160),
    content: z.string(),
    language: fileLanguageSchema,
    role: fileRoleSchema,
  })
  .strict();

const updateOperationSchema = z
  .object({
    type: z.literal("update"),
    path: z.string().min(1).max(160),
    content: z.string(),
  })
  .strict();

const deleteOperationSchema = z
  .object({
    type: z.literal("delete"),
    path: z.string().min(1).max(160),
  })
  .strict();

export const workspaceAiPatchSchema = z
  .object({
    baseRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    summary: z.string().trim().min(8).max(240),
    operations: z
      .array(
        z.discriminatedUnion("type", [
          createOperationSchema,
          updateOperationSchema,
          deleteOperationSchema,
        ]),
      )
      .min(1)
      .max(
        WORKSPACE_AI_OPERATION_LIMIT,
        `At most ${WORKSPACE_AI_OPERATION_LIMIT} file operations are allowed per patch.`,
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const operation of value.operations) {
      if (seen.has(operation.path)) {
        context.addIssue({
          code: "custom",
          message: `${operation.path} cannot be changed more than once in one patch.`,
          path: ["operations"],
        });
      }
      seen.add(operation.path);
    }
  });

export type WorkspaceAiPatch = z.infer<typeof workspaceAiPatchSchema>;

const requestWorkspaceFileSchema = z
  .object({
    path: z.string().min(1).max(160),
    content: z.string(),
    language: fileLanguageSchema,
    role: fileRoleSchema,
    editable: z.boolean(),
  })
  .strict();

const requestWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    updatedAt: z.string().min(1).max(64),
    files: z.array(requestWorkspaceFileSchema).max(WORKSPACE_AI_FILE_LIMIT),
    tasks: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,47}$/),
            label: z.string().min(1).max(80),
            command: z.literal("npm"),
            args: z.array(z.string().min(1).max(80)).min(1).max(4),
            cwd: z
              .string()
              .regex(/^packages\/[a-z0-9][a-z0-9._-]{0,63}$/)
              .optional(),
            port: z.number().int().min(1).max(65_535).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(WORKSPACE_AI_TASK_LIMIT),
    runtime: z
      .object({
        executionMode: z.literal("static-preview"),
        provider: z.literal("unconfigured"),
        isolation: z.literal("browser-iframe"),
        runtime: z.literal("node24"),
        packageManager: z.literal("npm"),
        installScripts: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const workspaceAiPatchRequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(WORKSPACE_AI_PROMPT_LIMIT),
    baseRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    workspace: requestWorkspaceSchema,
    provider: z
      .enum(["platform", "openrouter", "openai", "anthropic", "kimi"])
      .default("platform"),
    model: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,160}$/)
      .optional(),
  })
  .strict();

export type WorkspaceAiPatchRequest = z.infer<
  typeof workspaceAiPatchRequestSchema
>;

export const workspaceAiPatchJsonSchema = z.toJSONSchema(
  workspaceAiPatchSchema,
  { target: "draft-7" },
) as unknown as Record<string, unknown> & {
  type: "object";
  additionalProperties: false;
  properties: {
    operations: { maxItems: number };
  };
  required: string[];
};

export class WorkspaceAiPatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAiPatchValidationError";
  }
}

export class WorkspaceAiPatchConflictError extends Error {
  readonly expectedRevision: number;
  readonly receivedRevision: number;

  constructor(expectedRevision: number, receivedRevision: number) {
    super(
      `Workspace revision conflict: expected ${expectedRevision}, received ${receivedRevision}. Refresh the workspace before retrying.`,
    );
    this.name = "WorkspaceAiPatchConflictError";
    this.expectedRevision = expectedRevision;
    this.receivedRevision = receivedRevision;
  }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validationError(message: string): never {
  throw new WorkspaceAiPatchValidationError(message);
}

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "The model returned an invalid workspace patch.";
}

export function parseWorkspaceAiPatch(value: unknown): WorkspaceAiPatch {
  const parsed = workspaceAiPatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkspaceAiPatchValidationError(
      `Invalid workspace AI patch: ${zodMessage(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function parseWorkspaceAiPatchRequest(
  value: unknown,
): WorkspaceAiPatchRequest {
  const parsed = workspaceAiPatchRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkspaceAiPatchValidationError(
      `Invalid workspace AI request: ${zodMessage(parsed.error)}`,
    );
  }
  if (parsed.data.baseRevision !== parsed.data.workspace.revision) {
    throw new WorkspaceAiPatchConflictError(
      parsed.data.workspace.revision,
      parsed.data.baseRevision,
    );
  }
  validateFileGraph(parsed.data.workspace.files);
  return parsed.data;
}

function assertSafePath(path: string): void {
  const lower = path.toLowerCase();
  if (
    isUnsafeProjectWorkspacePath(path) ||
    BLOCKED_EXECUTABLE_EXTENSIONS.some((extension) =>
      lower.endsWith(extension),
    )
  ) {
    validationError(`${path || "A file"} has an unsafe workspace path.`);
  }
}

function assertSafeContent(
  path: string,
  content: string,
  checkExecutable = false,
): void {
  const byteLength = bytes(content);
  if (byteLength > WORKSPACE_AI_FILE_BYTES_LIMIT) {
    validationError(
      `${path} exceeds the ${WORKSPACE_AI_FILE_BYTES_LIMIT} byte per-file limit.`,
    );
  }
  const findings = findArtifactSecrets(content, path);
  if (findings.length) throw new ArtifactSecretError(findings);

  const lower = path.toLowerCase();
  if (
    !checkExecutable ||
    !CODE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))
  ) {
    return;
  }
  for (const [pattern, reason] of UNSAFE_EXECUTABLE_PATTERNS) {
    if (pattern.test(content)) {
      validationError(`${path} is unsafe: ${reason}.`);
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseManifest(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      validationError("package.json must contain one JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WorkspaceAiPatchValidationError) throw error;
    return validationError("package.json must contain valid JSON.");
  }
}

function dependencyEntries(
  manifest: Record<string, unknown>,
  path: string,
): Array<[string, unknown]> {
  const sections = ["dependencies", "devDependencies"] as const;
  return sections.flatMap((section) => {
    const value = manifest[section] ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      validationError(`${path} ${section} must be an object.`);
    }
    return Object.entries(value as Record<string, unknown>);
  });
}

function packageManifestCwd(path: string): string | null {
  if (path === "package.json") return ".";
  const match = /^(packages\/[a-z0-9][a-z0-9._-]{0,63})\/package\.json$/.exec(
    path,
  );
  return match?.[1] ?? null;
}

interface ValidatedManifest {
  manifest: Record<string, unknown>;
  dependencyCount: number;
}

function validateManifest(
  nextContent: string,
  path: string,
  previousContent?: string,
  enforceCreatedScriptAllowlist = false,
): ValidatedManifest {
  const next = parseManifest(nextContent);
  if (next.private !== true) {
    validationError(`${path} must remain private.`);
  }
  if (path === "package.json" && next.type !== "module") {
    validationError('package.json must keep type "module".');
  }
  if (path !== "package.json" && next.workspaces !== undefined) {
    validationError(`${path} cannot declare nested npm workspaces.`);
  }
  for (const field of [
    "overrides",
    "resolutions",
    "pnpm",
    "publishConfig",
  ]) {
    if (next[field] !== undefined) {
      validationError(
        `${path} ${field} is blocked from the bounded package contract.`,
      );
    }
  }
  const config = next.config;
  if (
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    "registry" in config
  ) {
    validationError(`${path} cannot declare a custom npm registry.`);
  }
  for (const field of [
    "optionalDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ]) {
    const value = next[field];
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value as object).length > 0
    ) {
      validationError(`${path} ${field} is blocked from installation.`);
    }
  }
  const nextScripts = next.scripts;
  if (nextScripts === undefined && path === "package.json") {
    validationError("package.json must keep its declared scripts.");
  }
  if (
    nextScripts !== undefined &&
    (!nextScripts ||
      typeof nextScripts !== "object" ||
      Array.isArray(nextScripts))
  ) {
    validationError(`${path} scripts must be an object.`);
  }
  for (const [name, command] of Object.entries(
    (nextScripts ?? {}) as Record<string, unknown>,
  )) {
    if (BLOCKED_LIFECYCLE_SCRIPTS.has(name.toLowerCase())) {
      validationError(`npm lifecycle scripts are blocked in ${path} (${name}).`);
    }
    if (!PACKAGE_SCRIPT_NAME.test(name)) {
      validationError(`${path} script names must be bounded and alphanumeric.`);
    }
    if (
      typeof command !== "string" ||
      !command.trim() ||
      command.length > 500
    ) {
      validationError(`${path} script ${name} must be a bounded command string.`);
    }
    if (enforceCreatedScriptAllowlist && !AI_CREATED_PACKAGE_SCRIPTS.has(name)) {
      validationError(
        `${path} AI-created scripts must use the start, build, test, check, lint or typecheck allowlist.`,
      );
    }
  }
  if (previousContent) {
    const previous = parseManifest(previousContent);
    if (stableJson(previous.scripts) !== stableJson(nextScripts)) {
      validationError(
        `${path} scripts cannot be changed by an AI workspace patch.`,
      );
    }
  }

  const dependencies = dependencyEntries(next, path);
  for (const [name, version] of dependencies) {
    if (
      !PACKAGE_NAME.test(name) ||
      typeof version !== "string" ||
      !EXACT_REGISTRY_VERSION.test(version)
    ) {
      validationError(
        `${path} dependency ${name} must use an exact registry version, not a range, URL, file, git or workspace spec.`,
      );
    }
  }
  return { manifest: next, dependencyCount: dependencies.length };
}

function validateWorkspaceDeclarations(
  root: Record<string, unknown>,
  filePaths: Set<string>,
): void {
  if (root.workspaces === undefined) return;
  if (!Array.isArray(root.workspaces)) {
    validationError(
      "package.json workspaces must be an array of explicit package directories.",
    );
  }
  if (root.workspaces.length > WORKSPACE_AI_PACKAGE_LIMIT) {
    validationError(
      `A workspace may declare at most ${WORKSPACE_AI_PACKAGE_LIMIT} package directories.`,
    );
  }
  const seen = new Set<string>();
  for (const value of root.workspaces) {
    if (typeof value !== "string" || !PACKAGE_WORKSPACE_PATH.test(value)) {
      validationError(
        "package.json workspaces must use explicit packages/<safe-name> directories without globs, URLs or traversal.",
      );
    }
    if (seen.has(value)) {
      validationError(`package.json workspace ${value} appears more than once.`);
    }
    seen.add(value);
    if (!filePaths.has(`${value}/package.json`)) {
      validationError(
        `${value}/package.json is required by the root workspace declaration.`,
      );
    }
  }
}

function validateFileGraph(
  files: Array<Pick<ProjectWorkspaceFile, "path" | "content">>,
  previousManifests?: Map<string, string>,
): void {
  if (files.length > WORKSPACE_AI_FILE_LIMIT) {
    validationError(
      `A workspace may contain at most ${WORKSPACE_AI_FILE_LIMIT} files.`,
    );
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const item of files) {
    assertSafePath(item.path);
    if (seen.has(item.path)) {
      validationError(`${item.path} appears more than once.`);
    }
    seen.add(item.path);
    assertSafeContent(item.path, item.content);
    totalBytes += bytes(item.content);
  }
  if (totalBytes > WORKSPACE_AI_TOTAL_BYTES_LIMIT) {
    validationError(
      `Workspace source exceeds the ${WORKSPACE_AI_TOTAL_BYTES_LIMIT} byte total limit.`,
    );
  }
  const manifestFiles = files
    .filter((item) =>
      item.path === "package.json" || item.path.endsWith("/package.json")
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  let root: Record<string, unknown> | null = null;
  let dependencyCount = 0;
  for (const manifestFile of manifestFiles) {
    if (!packageManifestCwd(manifestFile.path)) {
      validationError(
        `${manifestFile.path} is not allowed; package manifests must use packages/<safe-name>/package.json.`,
      );
    }
    const validated = validateManifest(
      manifestFile.content,
      manifestFile.path,
      previousManifests?.get(manifestFile.path),
      previousManifests !== undefined &&
        !previousManifests.has(manifestFile.path),
    );
    dependencyCount += validated.dependencyCount;
    if (manifestFile.path === "package.json") root = validated.manifest;
  }
  if (dependencyCount > WORKSPACE_AI_DEPENDENCY_LIMIT) {
    validationError(
      `A canonical AI workspace may declare at most ${WORKSPACE_AI_DEPENDENCY_LIMIT} npm dependencies across all package manifests.`,
    );
  }
  if (root) {
    validateWorkspaceDeclarations(root, new Set(files.map((item) => item.path)));
  }
}

export interface ApplyWorkspaceAiPatchOptions {
  now?: () => Date;
}

export interface AppliedWorkspaceAiPatch {
  workspace: ProjectWorkspace;
  patch: WorkspaceAiPatch;
  appliedOperations: {
    created: number;
    updated: number;
    deleted: number;
  };
}

export interface RunnableWorkspaceAiRevision {
  spec: GeneratedProjectSpec;
  runtimeHtml: string;
}

function workspaceProjectSpec(workspace: ProjectWorkspace): GeneratedProjectSpec {
  const source = workspace.files.find((item) => item.path === "project.json")
    ?.content;
  if (!source) {
    validationError("project.json is required for canonical workspace validation.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return validationError("project.json must contain valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1 ||
    typeof (value as Record<string, unknown>).presetId !== "string" ||
    !projectPresetIds.includes(
      (value as Record<string, unknown>).presetId as (typeof projectPresetIds)[number],
    )
  ) {
    validationError(
      "project.json must contain a supported generated project specification.",
    );
  }
  return value as GeneratedProjectSpec;
}

/**
 * Final release gate for a model patch. The route calls this only after the
 * atomic patch is assembled, so no partially valid revision can be returned.
 */
export function assertRunnableWorkspaceAiRevision(
  workspace: ProjectWorkspace,
): RunnableWorkspaceAiRevision {
  validateFileGraph(workspace.files);
  const spec = workspaceProjectSpec(workspace);
  const validation = validateProjectWorkspace(spec, workspace);
  if (!validation.valid) {
    validationError(
      validation.issues[0] ?? "Canonical workspace validation failed.",
    );
  }
  validateWorkspaceSandboxRun({
    workspaceId: "workspace-ai-validation",
    workspace,
    taskId: workspace.tasks[0]?.id ?? "",
  });
  try {
    return { spec, runtimeHtml: compileWorkspaceRuntime(spec, workspace) };
  } catch (error) {
    if (error instanceof WorkspaceAiPatchValidationError) throw error;
    validationError(
      error instanceof Error
        ? error.message
        : "Canonical workspace compilation failed.",
    );
  }
}

export function applyWorkspaceAiPatch(
  workspace: ProjectWorkspace,
  baseRevision: number,
  rawPatch: unknown,
  options: ApplyWorkspaceAiPatchOptions = {},
): AppliedWorkspaceAiPatch {
  if (!workspace || !Array.isArray(workspace.files)) {
    validationError("A valid editable workspace is required.");
  }
  if (baseRevision !== workspace.revision) {
    throw new WorkspaceAiPatchConflictError(workspace.revision, baseRevision);
  }
  const patch = parseWorkspaceAiPatch(rawPatch);
  if (patch.baseRevision !== workspace.revision) {
    throw new WorkspaceAiPatchConflictError(
      workspace.revision,
      patch.baseRevision,
    );
  }

  const previousManifests = new Map(
    workspace.files
      .filter((item) =>
        item.path === "package.json" || item.path.endsWith("/package.json")
      )
      .map((item) => [item.path, item.content]),
  );
  validateFileGraph(workspace.files);

  const nextFiles = workspace.files.map((item) => ({ ...item }));
  const appliedOperations = { created: 0, updated: 0, deleted: 0 };

  for (const operation of patch.operations) {
    assertSafePath(operation.path);
    const index = nextFiles.findIndex((item) => item.path === operation.path);

    if (operation.type === "create") {
      if (index >= 0) {
        validationError(`${operation.path} already exists in this workspace.`);
      }
      assertSafeContent(operation.path, operation.content, true);
      nextFiles.push({
        path: operation.path,
        content: operation.content,
        language: operation.language,
        role: operation.role,
        editable: true,
      });
      appliedOperations.created += 1;
      continue;
    }

    if (index < 0) {
      validationError(`${operation.path} is not part of this workspace.`);
    }
    const existing = nextFiles[index];
    if (!existing.editable) {
      validationError(`${operation.path} is read-only.`);
    }

    if (operation.type === "update") {
      assertSafeContent(operation.path, operation.content, true);
      nextFiles[index] = { ...existing, content: operation.content };
      appliedOperations.updated += 1;
      continue;
    }

    if (REQUIRED_WORKSPACE_FILES.has(operation.path)) {
      validationError(
        `${operation.path} is a required workspace file and cannot be deleted.`,
      );
    }
    nextFiles.splice(index, 1);
    appliedOperations.deleted += 1;
  }

  validateFileGraph(nextFiles, previousManifests);
  const now = options.now?.() ?? new Date();
  const nextWorkspace = reconcileProjectWorkspaceTasks({
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: now.toISOString(),
    files: nextFiles,
  });

  return { workspace: nextWorkspace, patch, appliedOperations };
}
