import { z } from "zod";

import { findArtifactSecrets } from "../../artifact-security.ts";
import { normalizeProjectV2Path } from "../../project-v2-path.ts";
import type { ProjectFileOperationV2, ProjectV2 } from "../../project-v2-types.ts";
import { pathWithinScopes } from "./scopes.ts";
import type { AgentTask, FileLease, PatchBundle } from "./types.ts";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("write"),
      path: z.string().min(1).max(240),
      content: z.string(),
      language: z
        .enum(["css", "html", "javascript", "json", "jsx", "markdown", "text", "typescript", "tsx"])
        .optional(),
      role: z
        .enum(["asset", "component", "config", "documentation", "entry", "integration", "manifest", "source", "style", "test"])
        .optional(),
      provenance: z.literal("ai"),
      editable: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("delete"), path: z.string().min(1).max(240) }).strict(),
  z
    .object({
      type: z.literal("rename"),
      from: z.string().min(1).max(240),
      to: z.string().min(1).max(240),
      provenance: z.literal("ai"),
    })
    .strict(),
]);

export const patchBundleSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    role: z.enum(["frontend", "backend", "integration"]),
    baseRevision: z.number().int().positive(),
    baseContentHash: hashSchema,
    expectedFileHashes: z.record(z.string(), hashSchema.nullable()),
    operations: z.array(operationSchema).max(64),
    dependencyChanges: z
      .array(
        z
          .object({
            name: z.string().min(1).max(193),
            version: z.string().min(1).max(100).optional(),
            dev: z.boolean(),
            action: z.enum(["add", "remove"]),
          })
          .strict(),
      )
      .max(32),
    testsToRun: z.array(z.string().min(1).max(240)).max(32),
    summary: z.string().min(1).max(2_000),
    unresolvedAssumptions: z.array(z.string().min(1).max(500)).max(32),
    contextProvenanceIds: z.array(z.string().min(1).max(128)).max(64),
  })
  .strict();

export type PatchValidationCode =
  | "invalid-schema"
  | "stale-base"
  | "stale-hash"
  | "outside-lease"
  | "protected-path"
  | "secret-detected"
  | "dependency-policy"
  | "task-limit";

export class PatchValidationError extends Error {
  readonly code: PatchValidationCode;
  readonly rerunRequired: boolean;

  constructor(code: PatchValidationCode, message: string, rerunRequired = false) {
    super(message);
    this.name = "PatchValidationError";
    this.code = code;
    this.rerunRequired = rerunRequired;
  }
}

function operationPaths(operation: ProjectFileOperationV2): string[] {
  if (operation.type === "rename") return [operation.from, operation.to];
  return [operation.path];
}

function changedLineCount(project: ProjectV2, operation: ProjectFileOperationV2): number {
  if (operation.type === "rename") return 0;
  const current = project.files[normalizeProjectV2Path(operation.path)]?.content ?? "";
  if (operation.type === "delete") return current ? current.split("\n").length : 0;
  return Math.max(current.split("\n").length, operation.content.split("\n").length);
}

function assertExpectedHash(project: ProjectV2, bundle: PatchBundle, path: string): void {
  const safePath = normalizeProjectV2Path(path);
  if (!(safePath in bundle.expectedFileHashes)) {
    throw new PatchValidationError("stale-hash", `Patch ${bundle.taskId} omits the expected hash for ${safePath}.`, true);
  }
  const expected = bundle.expectedFileHashes[safePath];
  const actual = project.files[safePath]?.hash ?? null;
  if (expected !== actual) {
    throw new PatchValidationError("stale-hash", `Patch ${bundle.taskId} is stale for ${safePath}.`, true);
  }
}

function assertDependencies(bundle: PatchBundle): void {
  const names = new Set<string>();
  for (const change of bundle.dependencyChanges) {
    if (!PACKAGE_NAME.test(change.name) || names.has(change.name)) {
      throw new PatchValidationError("dependency-policy", `Dependency change ${change.name} is invalid or duplicated.`);
    }
    names.add(change.name);
    if (change.action === "add" && (!change.version || !EXACT_VERSION.test(change.version))) {
      throw new PatchValidationError("dependency-policy", `Dependency ${change.name} requires an exact semver version.`);
    }
    if (change.action === "remove" && change.version !== undefined) {
      throw new PatchValidationError("dependency-policy", `Removed dependency ${change.name} cannot include a version.`);
    }
  }
}

export function validatePatchBundle(input: {
  bundle: unknown;
  task: AgentTask;
  project: ProjectV2;
  lease: FileLease | null;
  allowedProtectedPaths?: readonly string[];
}): PatchBundle {
  let bundle: PatchBundle;
  try {
    bundle = patchBundleSchema.parse(input.bundle) as PatchBundle;
  } catch (error) {
    throw new PatchValidationError("invalid-schema", `Patch bundle is invalid: ${error instanceof Error ? error.message : "schema error"}.`);
  }
  const { task, project, lease } = input;
  if (bundle.taskId !== task.taskId || bundle.role !== task.role) {
    throw new PatchValidationError("invalid-schema", "Patch task or role does not match its assignment.");
  }
  if (
    bundle.baseRevision !== task.baseRevision ||
    bundle.baseRevision !== project.revision ||
    bundle.baseContentHash !== task.baseContentHash ||
    bundle.baseContentHash !== project.contentHash
  ) {
    throw new PatchValidationError("stale-base", `Patch ${bundle.taskId} was produced from a stale canonical revision.`, true);
  }
  if (!lease || lease.taskId !== task.taskId || lease.baseRevision !== bundle.baseRevision) {
    throw new PatchValidationError("outside-lease", `Patch ${bundle.taskId} has no active matching file lease.`);
  }
  if (new Date(lease.expiresAt).getTime() <= Date.now()) {
    throw new PatchValidationError("outside-lease", `Patch ${bundle.taskId} file lease expired.`);
  }
  if (bundle.operations.length > task.limits.maxChangedFiles) {
    throw new PatchValidationError("task-limit", `Patch ${bundle.taskId} exceeds its changed-file limit.`);
  }
  const expectedEntries = Object.entries(bundle.expectedFileHashes).map(([path, hash]) => [normalizeProjectV2Path(path), hash] as const);
  const normalizedExpected = Object.fromEntries(expectedEntries);
  if (Object.keys(normalizedExpected).length !== expectedEntries.length) {
    throw new PatchValidationError("invalid-schema", `Patch ${bundle.taskId} contains colliding normalized hash paths.`);
  }
  bundle.expectedFileHashes = normalizedExpected;
  const allowedProtected = new Set((input.allowedProtectedPaths ?? []).map(normalizeProjectV2Path));
  const touched = new Set<string>();
  let changedLines = 0;
  for (const operation of bundle.operations) {
    const paths = operationPaths(operation).map(normalizeProjectV2Path);
    for (const path of paths) {
      if (touched.has(path)) {
        throw new PatchValidationError("invalid-schema", `Patch ${bundle.taskId} changes ${path} more than once.`);
      }
      touched.add(path);
      if (!pathWithinScopes(path, lease.patterns)) {
        throw new PatchValidationError("outside-lease", `Patch ${bundle.taskId} writes ${path} outside its lease.`);
      }
      if (
        !allowedProtected.has(path) &&
        (path === "package.json" || pathWithinScopes(path, task.protectedScopes))
      ) {
        throw new PatchValidationError("protected-path", `Patch ${bundle.taskId} targets protected file ${path}.`);
      }
      assertExpectedHash(project, bundle, path);
    }
    if (operation.type === "write" && findArtifactSecrets(operation.content, operation.path).length) {
      throw new PatchValidationError("secret-detected", `Patch ${bundle.taskId} contains secret material.`);
    }
    changedLines += changedLineCount(project, operation);
  }
  if (touched.size > task.limits.maxChangedFiles) {
    throw new PatchValidationError("task-limit", `Patch ${bundle.taskId} exceeds its changed-file limit.`);
  }
  if (changedLines > task.limits.maxChangedLines) {
    throw new PatchValidationError("task-limit", `Patch ${bundle.taskId} exceeds its changed-line limit.`);
  }
  if (bundle.dependencyChanges.length) {
    if (task.limits.maxChangedFiles < 1) {
      throw new PatchValidationError("task-limit", `Patch ${bundle.taskId} cannot change dependencies within its file limit.`);
    }
    assertExpectedHash(project, bundle, "package.json");
  }
  assertDependencies(bundle);
  return structuredClone(bundle);
}
