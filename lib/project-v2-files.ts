import {
  ArtifactSecretError,
  findArtifactSecrets,
} from "./artifact-security.ts";
import { hashProjectV2CanonicalState, hashProjectV2FileContent } from "./project-v2-hash.ts";
import {
  assertProjectV2FileSetLimits,
  normalizeProjectV2Path,
} from "./project-v2-path.ts";
import type {
  ProjectFileLanguageV2,
  ProjectFileOperationV2,
  ProjectFileRoleV2,
  ProjectFileV2,
  ProjectV2,
} from "./project-v2-types.ts";
import { validateProjectV2 } from "./project-v2-validator.ts";

const FILE_OPERATION_LIMIT = 64;

export class ProjectV2RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly receivedRevision: number;

  constructor(expectedRevision: number, receivedRevision: number) {
    super(
      `Project revision conflict: expected ${expectedRevision}, received ${receivedRevision}.`,
    );
    this.name = "ProjectV2RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.receivedRevision = receivedRevision;
  }
}

function inferLanguage(path: string): ProjectFileLanguageV2 {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md") || path.endsWith(".mdx")) return "markdown";
  return "text";
}

function inferRole(path: string): ProjectFileRoleV2 {
  if (path === "package.json") return "manifest";
  if (path.startsWith("app/") && /(?:page|layout)\.tsx$/.test(path)) return "entry";
  if (path.startsWith("components/")) return "component";
  if (path.startsWith("tests/") || /\.test\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (path.endsWith(".css")) return "style";
  if (path.endsWith(".md")) return "documentation";
  if (path.includes("integration") || path.includes("drops.config")) return "integration";
  if (/config|tsconfig/.test(path)) return "config";
  return "source";
}

function timestamp(value: string | Date | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("Project file timestamp is invalid.");
  return date.toISOString();
}

function assertSecretFree(content: string, path: string): void {
  const findings = findArtifactSecrets(content, path);
  if (findings.length) throw new ArtifactSecretError(findings);
}

export async function createProjectV2File(input: {
  path: string;
  content: string;
  language?: ProjectFileLanguageV2;
  role?: ProjectFileRoleV2;
  provenance: ProjectFileV2["provenance"];
  editable?: boolean;
  now?: string | Date;
}): Promise<ProjectFileV2> {
  const path = normalizeProjectV2Path(input.path);
  assertProjectV2FileSetLimits([{ path, content: input.content }]);
  assertSecretFree(input.content, path);
  const now = timestamp(input.now);
  return {
    kind: "file",
    path,
    content: input.content,
    language: input.language ?? inferLanguage(path),
    role: input.role ?? inferRole(path),
    provenance: input.provenance,
    editable: input.editable ?? true,
    bytes: new TextEncoder().encode(input.content).byteLength,
    hash: await hashProjectV2FileContent(input.content),
    createdAt: now,
    updatedAt: now,
  };
}

function cloneFiles(files: Record<string, ProjectFileV2>): Record<string, ProjectFileV2> {
  return Object.fromEntries(
    Object.entries(files).map(([path, file]) => [path, { ...file }]),
  );
}

function requiredPaths(project: ProjectV2): Set<string> {
  return new Set(["package.json", ...project.manifest.entrypoints]);
}

function syncManifestFromPackage(
  project: ProjectV2,
  files: Record<string, ProjectFileV2>,
): ProjectV2["manifest"] {
  const source = files["package.json"]?.content;
  if (!source) throw new Error("package.json is required.");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw new Error("package.json must contain valid JSON.");
  }
  const stringRecord = (value: unknown, label: string): Record<string, string> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (value === undefined) return {};
      throw new Error(`package.json ${label} must be an object.`);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([, item]) => typeof item !== "string")) {
      throw new Error(`package.json ${label} must contain string values.`);
    }
    return Object.fromEntries(entries) as Record<string, string>;
  };
  return {
    ...project.manifest,
    scripts: stringRecord(manifest.scripts, "scripts"),
    dependencies: stringRecord(manifest.dependencies, "dependencies"),
    devDependencies: stringRecord(manifest.devDependencies, "devDependencies"),
  };
}

export async function applyProjectV2FileOperations(
  project: ProjectV2,
  expectedRevision: number,
  operations: readonly ProjectFileOperationV2[],
  options: { now?: () => Date } = {},
): Promise<ProjectV2> {
  if (expectedRevision !== project.revision) {
    throw new ProjectV2RevisionConflictError(project.revision, expectedRevision);
  }
  if (!operations.length || operations.length > FILE_OPERATION_LIMIT) {
    throw new Error(`A Project V2 revision must contain 1-${FILE_OPERATION_LIMIT} file operations.`);
  }
  const files = cloneFiles(project.files);
  const protectedPaths = requiredPaths(project);
  const now = (options.now?.() ?? new Date()).toISOString();
  const touched = new Set<string>();

  for (const operation of operations) {
    if (operation.type === "rename") {
      const from = normalizeProjectV2Path(operation.from);
      const to = normalizeProjectV2Path(operation.to);
      if (touched.has(from) || touched.has(to)) {
        throw new Error("A path cannot be changed more than once in one atomic revision.");
      }
      touched.add(from);
      touched.add(to);
      const existing = files[from];
      if (!existing) throw new Error(`${from} is not part of this project.`);
      if (!existing.editable) throw new Error(`${from} is read-only.`);
      if (protectedPaths.has(from)) throw new Error(`${from} is a required project file.`);
      if (files[to]) throw new Error(`${to} already exists.`);
      delete files[from];
      files[to] = {
        ...existing,
        path: to,
        language: inferLanguage(to),
        role: inferRole(to),
        provenance: operation.provenance,
        updatedAt: now,
      };
      continue;
    }

    const path = normalizeProjectV2Path(operation.path);
    if (touched.has(path)) {
      throw new Error(`${path} cannot be changed more than once in one atomic revision.`);
    }
    touched.add(path);
    const existing = files[path];

    if (operation.type === "delete") {
      if (!existing) throw new Error(`${path} is not part of this project.`);
      if (!existing.editable) throw new Error(`${path} is read-only.`);
      if (protectedPaths.has(path)) throw new Error(`${path} is a required project file.`);
      delete files[path];
      continue;
    }

    if (existing && !existing.editable) throw new Error(`${path} is read-only.`);
    const next = await createProjectV2File({
      path,
      content: operation.content,
      language: operation.language ?? existing?.language,
      role: operation.role ?? existing?.role,
      provenance: operation.provenance,
      editable: operation.editable ?? existing?.editable ?? true,
      now,
    });
    files[path] = existing ? { ...next, createdAt: existing.createdAt } : next;
  }

  assertProjectV2FileSetLimits(Object.values(files));
  const next: ProjectV2 = {
    ...project,
    revision: project.revision + 1,
    files,
    manifest: syncManifestFromPackage(project, files),
    updatedAt: now,
    contentHash: "",
    preview: project.preview
      ? { status: "stopped", projectRevision: project.revision + 1, stoppedAt: now }
      : undefined,
  };
  next.contentHash = await hashProjectV2CanonicalState(next);
  return validateProjectV2(next);
}

export function writeProjectV2File(
  project: ProjectV2,
  expectedRevision: number,
  operation: Extract<ProjectFileOperationV2, { type: "write" }>,
): Promise<ProjectV2> {
  return applyProjectV2FileOperations(project, expectedRevision, [operation]);
}

export function deleteProjectV2File(
  project: ProjectV2,
  expectedRevision: number,
  path: string,
): Promise<ProjectV2> {
  return applyProjectV2FileOperations(project, expectedRevision, [{ type: "delete", path }]);
}

export function renameProjectV2File(
  project: ProjectV2,
  expectedRevision: number,
  from: string,
  to: string,
  provenance: ProjectFileV2["provenance"] = "manual",
): Promise<ProjectV2> {
  return applyProjectV2FileOperations(project, expectedRevision, [
    { type: "rename", from, to, provenance },
  ]);
}
