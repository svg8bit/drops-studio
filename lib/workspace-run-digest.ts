export interface WorkspaceRunDigestFile {
  path: string;
  content: string;
}

export interface WorkspaceRunDigestTask {
  id: string;
  argv: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  previewPort?: number;
}

export interface WorkspaceRunDigestInput {
  files: readonly WorkspaceRunDigestFile[];
  task: WorkspaceRunDigestTask;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) =>
    character.codePointAt(0) ?? 0,
  );
  const rightPoints = Array.from(right, (character) =>
    character.codePointAt(0) ?? 0,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function normalizedDigestPayload(input: WorkspaceRunDigestInput): string {
  const files = input.files
    .map((file) => ({ path: file.path.trim(), content: file.content }))
    .sort((left, right) => compareCodePoints(left.path, right.path));
  const manifestFile = files.find((file) => file.path === "package.json");
  if (!manifestFile) {
    throw new Error("Workspace run digest requires package.json.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestFile.content) as unknown;
  } catch {
    throw new Error("Workspace run digest requires valid package.json.");
  }
  return canonicalJson({
    schemaVersion: 1,
    files,
    manifest,
    task: {
      id: input.task.id.trim(),
      argv: [...input.task.argv],
      cwd: input.task.cwd?.trim() || ".",
      timeoutMs: input.task.timeoutMs ?? 15_000,
      previewPort: input.task.previewPort ?? null,
    },
  });
}

export async function createWorkspaceRunDigest(
  input: WorkspaceRunDigestInput,
): Promise<string> {
  const bytes = new TextEncoder().encode(normalizedDigestPayload(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
