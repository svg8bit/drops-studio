export const PROJECT_V2_FILE_LIMIT = 64;
export const PROJECT_V2_FILE_BYTES_LIMIT = 512_000;
export const PROJECT_V2_TOTAL_BYTES_LIMIT = 1_500_000;
export const PROJECT_V2_PATH_BYTES_LIMIT = 240;

const SAFE_SEGMENT = /^[A-Za-z0-9@._+()[\]-]+$/;
const PROTECTED_SEGMENTS = new Set([".git", "node_modules"]);

export class ProjectV2PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectV2PathError";
  }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeProjectV2Path(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProjectV2PathError("Project file path must be a string.");
  }
  const path = value.normalize("NFC");
  if (!path || path !== path.trim()) {
    throw new ProjectV2PathError("Project file path cannot be empty or padded.");
  }
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
    throw new ProjectV2PathError("Project file path must be a relative POSIX path.");
  }
  if (/^[A-Za-z]:/.test(path) || bytes(path) > PROJECT_V2_PATH_BYTES_LIMIT) {
    throw new ProjectV2PathError("Project file path is absolute or exceeds the path limit.");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !SAFE_SEGMENT.test(segment),
    )
  ) {
    throw new ProjectV2PathError("Project file path contains an unsafe or malformed segment.");
  }
  if (
    segments.some((segment) => PROTECTED_SEGMENTS.has(segment.toLowerCase())) ||
    segments.at(-1)?.toLowerCase().startsWith(".env")
  ) {
    throw new ProjectV2PathError("Project file path targets a protected location.");
  }
  return segments.join("/");
}

export function assertProjectV2FileSetLimits(
  files: Iterable<{ path: string; content: string }>,
): void {
  const entries = [...files];
  if (entries.length > PROJECT_V2_FILE_LIMIT) {
    throw new Error(`A Project V2 filesystem may contain at most ${PROJECT_V2_FILE_LIMIT} files.`);
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const path = normalizeProjectV2Path(entry.path);
    if (seen.has(path)) throw new Error(`${path} appears more than once.`);
    seen.add(path);
    if (typeof entry.content !== "string") throw new Error(`${path} must contain string source.`);
    const size = bytes(entry.content);
    if (size > PROJECT_V2_FILE_BYTES_LIMIT) {
      throw new Error(`${path} exceeds the ${PROJECT_V2_FILE_BYTES_LIMIT} byte per-file limit.`);
    }
    total += size;
  }
  if (total > PROJECT_V2_TOTAL_BYTES_LIMIT) {
    throw new Error(`Project V2 source exceeds the ${PROJECT_V2_TOTAL_BYTES_LIMIT} byte total limit.`);
  }
}
