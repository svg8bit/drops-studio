import { z } from "zod";

import { assertProjectPayloadSafe } from "./artifact-security.ts";
import {
  canonicalProjectV2Json,
  hashProjectV2CanonicalState,
  hashProjectV2FileContent,
  hashProjectV2Snapshot,
} from "./project-v2-hash.ts";
import {
  assertProjectV2FileSetLimits,
  normalizeProjectV2Path,
} from "./project-v2-path.ts";
import type {
  ProjectCanonicalSnapshotV2,
  ProjectManifestV2,
  ProjectV2,
} from "./project-v2-types.ts";
import { validateProjectSpec } from "./project-validator.ts";

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid identifier.");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/, "Invalid SHA-256 hash.");
const timestampSchema = z.string().refine(
  (value) => Number.isFinite(new Date(value).getTime()),
  "Invalid timestamp.",
);
const stringRecordSchema = z.record(
  z.string().min(1).max(128),
  z.string().min(1).max(500),
);

const legacyFallbackSchema = z
  .object({
    supported: z.boolean(),
    adapter: z.literal("legacy-html"),
    reason: z.string().min(1).max(500),
    sourceSchemaVersion: z.literal(1),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    name: z.string().min(1).max(80),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(72),
    packageManager: z.literal("npm"),
    framework: z
      .object({
        name: z.enum(["legacy-html", "nextjs"]),
        version: z.string().min(1).max(40),
      })
      .strict(),
    runtime: z
      .object({ name: z.literal("nodejs"), version: z.literal("24") })
      .strict(),
    scripts: stringRecordSchema,
    dependencies: stringRecordSchema,
    devDependencies: stringRecordSchema,
    entrypoints: z.array(z.string().min(1).max(240)).min(1).max(16),
    legacyFallback: legacyFallbackSchema,
  })
  .strict();

const fileSchema = z
  .object({
    kind: z.literal("file"),
    path: z.string().min(1).max(240),
    content: z.string(),
    language: z.enum([
      "css",
      "html",
      "javascript",
      "json",
      "jsx",
      "markdown",
      "text",
      "typescript",
      "tsx",
    ]),
    role: z.enum([
      "asset",
      "component",
      "config",
      "documentation",
      "entry",
      "integration",
      "manifest",
      "source",
      "style",
      "test",
    ]),
    provenance: z.enum(["generated", "ai", "manual"]),
    editable: z.boolean(),
    bytes: z.number().int().nonnegative(),
    hash: hashSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const integrationSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["dropstab", "drops-bot", "telegram", "project-data", "custom"]),
    status: z.enum(["available", "demo", "setup-required", "unconfigured"]),
    capabilities: z.array(z.string().min(1).max(96)).max(32),
    proxyPath: z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/).max(240).optional(),
    providerEvidenceRequired: z.boolean(),
  })
  .strict();

const environmentSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/),
    description: z.string().min(1).max(300),
    required: z.boolean(),
    secret: z.boolean(),
    scope: z.enum(["build", "deployment", "runtime"]),
  })
  .strict();

const permissionSchema = z
  .object({
    id: idSchema,
    capability: z.string().min(1).max(128),
    effect: z.enum(["allow", "deny", "approval-required"]),
    destructive: z.boolean(),
    external: z.boolean(),
  })
  .strict();

const taskSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(120),
    kind: z.enum(["build", "dev", "lint", "test", "typecheck", "custom"]),
    command: z.literal("npm"),
    args: z.array(z.string().min(1).max(200)).min(1).max(20),
    cwd: z.string().min(1).max(240),
    timeoutMs: z.number().int().min(1_000).max(600_000),
    previewPort: z.number().int().min(1_024).max(65_535).optional(),
    approvalRequired: z.boolean(),
  })
  .strict();

const runSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    projectRevision: z.number().int().positive(),
    status: z.enum(["queued", "running", "succeeded", "failed", "stopped"]),
    runtime: z.literal("vercel-sandbox"),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
    exitCode: z.number().int().nullable().optional(),
    logIds: z.array(idSchema).max(256),
    auditEventIds: z.array(idSchema).max(256),
  })
  .strict();

const logSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    stream: z.enum(["audit", "browser", "stderr", "stdout"]),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();

const migrationSchema = z
  .object({
    sourceSchemaVersion: z.union([z.literal(1), z.literal(2)]),
    sourceKind: z.enum([
      "generated-project-v1",
      "project-workspace-v1",
      "project-v2-template",
    ]),
    sourceProjectId: idSchema.optional(),
    sourceFidelity: z.enum(["exact", "reconstructed", "native"]),
    adapter: z.enum(["legacy-html", "native-v2"]),
    migratedAt: timestampSchema,
  })
  .strict();

const canonicalSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().positive(),
    contentHash: hashSchema,
    manifest: manifestSchema,
    files: z.record(z.string(), fileSchema),
    productSpec: z.unknown(),
    integrations: z.array(integrationSchema).max(32),
    environment: z.array(environmentSchema).max(64),
    permissions: z.array(permissionSchema).max(64),
    tasks: z.array(taskSchema).max(32),
    migration: migrationSchema,
  })
  .strict();

const checkpointSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(120),
    source: z.enum(["ai", "manual", "migration", "system"]),
    createdAt: timestampSchema,
    snapshotHash: hashSchema,
    snapshot: canonicalSnapshotSchema,
  })
  .strict();

const previewSchema = z
  .object({
    status: z.enum(["idle", "starting", "ready", "failed", "stopped"]),
    projectRevision: z.number().int().positive(),
    sandboxId: idSchema.optional(),
    url: z.string().url().refine((value) => new URL(value).protocol === "https:").optional(),
    port: z.number().int().min(1_024).max(65_535).optional(),
    startedAt: timestampSchema.optional(),
    stoppedAt: timestampSchema.optional(),
    error: z.string().max(1_000).optional(),
  })
  .strict();

const deploymentSchema = z
  .object({
    status: z.enum(["none", "queued", "building", "ready", "failed", "rolled-back"]),
    provider: z.enum(["legacy-publish", "vercel"]),
    deploymentId: idSchema.optional(),
    url: z.string().url().refine((value) => new URL(value).protocol === "https:").optional(),
    createdAt: timestampSchema.optional(),
    legacyPublishedSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(72).optional(),
    legacyPublishedUrl: z.string().min(1).max(500).optional(),
  })
  .strict();

export const projectV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    revision: z.number().int().positive(),
    contentHash: hashSchema,
    manifest: manifestSchema,
    files: z.record(z.string(), fileSchema),
    productSpec: z.unknown(),
    integrations: z.array(integrationSchema).max(32),
    environment: z.array(environmentSchema).max(64),
    permissions: z.array(permissionSchema).max(64),
    tasks: z.array(taskSchema).max(32),
    runs: z.array(runSchema).max(256),
    logs: z.array(logSchema).max(2_048),
    checkpoints: z.array(checkpointSchema).max(50),
    preview: previewSchema.optional(),
    deployment: deploymentSchema.optional(),
    migration: migrationSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

function assertUniqueIds(
  values: readonly { id: string }[],
  label: string,
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${label} contains duplicate id ${value.id}.`);
    ids.add(value.id);
  }
}

function parsePackageRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`package.json ${label} must be an object.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64 || entries.some(([name, item]) => !name || typeof item !== "string")) {
    throw new Error(`package.json ${label} must contain at most 64 string entries.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function assertSameRecord(
  actual: Record<string, string>,
  expected: Record<string, string>,
  label: string,
): void {
  if (canonicalProjectV2Json(actual) !== canonicalProjectV2Json(expected)) {
    throw new Error(`Project manifest ${label} must match package.json.`);
  }
}

function assertExactVersions(dependencies: Record<string, string>): void {
  for (const [name, version] of Object.entries(dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Dependency ${name} must use an exact package version.`);
    }
  }
}

function assertPackageManifest(
  files: ProjectCanonicalSnapshotV2["files"],
  manifest: ProjectManifestV2,
): void {
  const source = files["package.json"]?.content;
  if (!source) throw new Error("Project V2 requires package.json.");
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    value = parsed as Record<string, unknown>;
  } catch {
    throw new Error("package.json must contain one valid JSON object.");
  }
  const scripts = parsePackageRecord(value.scripts, "scripts");
  const dependencies = parsePackageRecord(value.dependencies, "dependencies");
  const devDependencies = parsePackageRecord(value.devDependencies, "devDependencies");
  for (const name of Object.keys(scripts)) {
    if (/^(?:pre|post)?(?:install|publish|pack|prepare)$/.test(name.toLowerCase())) {
      throw new Error(`package.json lifecycle script ${name} is blocked.`);
    }
  }
  assertExactVersions(dependencies);
  assertExactVersions(devDependencies);
  assertSameRecord(scripts, manifest.scripts, "scripts");
  assertSameRecord(dependencies, manifest.dependencies, "dependencies");
  assertSameRecord(devDependencies, manifest.devDependencies, "devDependencies");
}

async function assertCanonicalState(
  state: ProjectCanonicalSnapshotV2,
): Promise<void> {
  const entries = Object.entries(state.files);
  assertProjectV2FileSetLimits(entries.map(([path, file]) => ({ path, content: file.content })));
  for (const [key, file] of entries) {
    const normalizedKey = normalizeProjectV2Path(key);
    const normalizedPath = normalizeProjectV2Path(file.path);
    if (normalizedKey !== key || normalizedPath !== key) {
      throw new Error(`Project file key/path mismatch for ${key}.`);
    }
    if ((await hashProjectV2FileContent(file.content)) !== file.hash) {
      throw new Error(`Project file hash is invalid for ${key}.`);
    }
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (file.bytes !== bytes) throw new Error(`Project file byte count is invalid for ${key}.`);
  }
  for (const entrypoint of state.manifest.entrypoints) {
    const path = normalizeProjectV2Path(entrypoint);
    if (!state.files[path]) throw new Error(`Project entrypoint ${path} is missing.`);
  }
  const normalizedSpec = validateProjectSpec(state.productSpec);
  if (
    canonicalProjectV2Json(normalizedSpec) !==
    canonicalProjectV2Json(state.productSpec)
  ) {
    throw new Error("Project productSpec is not a canonical GeneratedProjectSpec.");
  }
  assertPackageManifest(state.files, state.manifest);
  if ((await hashProjectV2CanonicalState(state)) !== state.contentHash) {
    throw new Error("Project content hash is invalid.");
  }
}

export async function validateProjectV2(value: unknown): Promise<ProjectV2> {
  const project = projectV2Schema.parse(value) as ProjectV2;
  assertProjectPayloadSafe(project, "Project V2");
  assertUniqueIds(project.integrations, "Project integrations");
  assertUniqueIds(project.permissions, "Project permissions");
  assertUniqueIds(project.tasks, "Project tasks");
  assertUniqueIds(project.runs, "Project runs");
  assertUniqueIds(project.logs, "Project logs");
  assertUniqueIds(project.checkpoints, "Project checkpoints");
  const taskIds = new Set(project.tasks.map((task) => task.id));
  const runIds = new Set(project.runs.map((run) => run.id));
  for (const task of project.tasks) {
    if (task.cwd !== ".") normalizeProjectV2Path(task.cwd);
  }
  for (const run of project.runs) {
    if (!taskIds.has(run.taskId)) throw new Error(`Project run ${run.id} references an unknown task.`);
  }
  for (const log of project.logs) {
    if (!runIds.has(log.runId)) throw new Error(`Project log ${log.id} references an unknown run.`);
  }
  await assertCanonicalState({
    ...project,
    contentHash: project.contentHash,
  });
  for (const checkpoint of project.checkpoints) {
    await assertCanonicalState(checkpoint.snapshot);
    if ((await hashProjectV2Snapshot(checkpoint.snapshot)) !== checkpoint.snapshotHash) {
      throw new Error(`Project checkpoint ${checkpoint.id} snapshot hash is invalid.`);
    }
  }
  return project;
}
