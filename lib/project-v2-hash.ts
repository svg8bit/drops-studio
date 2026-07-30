import type {
  ProjectCanonicalSnapshotV2,
  ProjectFileV2,
  ProjectV2,
} from "./project-v2-types.ts";

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalProjectV2Json(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalProjectV2Json(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalProjectV2Json(item)}`)
    .join(",")}}`;
}

export async function sha256ProjectV2(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this runtime.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hashProjectV2FileContent(content: string): Promise<string> {
  return sha256ProjectV2(content);
}

export function hashProjectV2Files(
  files: Record<string, Pick<ProjectFileV2, "content" | "hash" | "path">>,
): Promise<string> {
  return sha256ProjectV2(
    canonicalProjectV2Json(
      Object.entries(files)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, file]) => ({ key, path: file.path, hash: file.hash, content: file.content })),
    ),
  );
}

export function projectV2CanonicalState(
  project: Pick<
    ProjectV2,
    | "environment"
    | "files"
    | "integrations"
    | "manifest"
    | "migration"
    | "permissions"
    | "productSpec"
    | "revision"
    | "schemaVersion"
    | "tasks"
  >,
): Omit<ProjectCanonicalSnapshotV2, "contentHash"> {
  return {
    schemaVersion: project.schemaVersion,
    revision: project.revision,
    manifest: project.manifest,
    files: project.files,
    productSpec: project.productSpec,
    integrations: project.integrations,
    environment: project.environment,
    permissions: project.permissions,
    tasks: project.tasks,
    migration: project.migration,
  };
}

export function hashProjectV2CanonicalState(
  project: Parameters<typeof projectV2CanonicalState>[0],
): Promise<string> {
  return sha256ProjectV2(canonicalProjectV2Json(projectV2CanonicalState(project)));
}

export function hashProjectV2Snapshot(
  snapshot: ProjectCanonicalSnapshotV2,
): Promise<string> {
  return sha256ProjectV2(canonicalProjectV2Json(snapshot));
}
