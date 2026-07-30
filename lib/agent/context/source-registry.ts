import { redactContextContent } from "./redaction.ts";
import type { ContextScope, ContextSource } from "./types.ts";
import { canonicalizeSourceUri, compareContextText, isEnvironmentContextSource, normalizeContextText, sameContextScope } from "./utils.ts";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 5_000;
const forbiddenPath = /(?:^|\/)(?:\.git|node_modules|\.next|dist|coverage|\.codex)(?:\/|$)|(?:^|\/)(?:credentials?|auth-store|session-store)(?:\.|\/|$)/i;

function registryKey(source: Pick<ContextSource, "tenantId" | "workspaceId" | "projectId" | "branch" | "revision" | "sourceUri" | "sourceVersion">): string {
  return [source.tenantId, source.workspaceId, source.projectId ?? "", source.branch ?? "", source.revision ?? "", source.sourceUri, source.sourceVersion].join("\u0000");
}

function validateIdentifier(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function sanitizeMetadata(metadata: ContextSource["metadata"]): ContextSource["metadata"] {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
    if (typeof value === "string") return [key, redactContextContent(value).content];
    if (Array.isArray(value)) return [key, value.map((item) => redactContextContent(item).content)];
    return [key, value];
  }));
}

function sanitizeSource(source: ContextSource): ContextSource | null {
  validateIdentifier(source.tenantId, "Tenant ID");
  validateIdentifier(source.workspaceId, "Workspace ID");
  validateIdentifier(source.projectId, "Project ID");
  validateIdentifier(source.branch, "Branch");
  validateIdentifier(source.revision, "Revision");
  if (source.sensitivity === "prohibited" || source.sensitivity === "secret-like" || source.noIndex) return null;
  const sourceUri = canonicalizeSourceUri(source.sourceUri);
  const path = source.path?.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path && (path.includes("\0") || path.startsWith("/") || path.split("/").includes("..") || forbiddenPath.test(path))) {
    throw new Error(`Context source path ${path} is not indexable.`);
  }
  if (new TextEncoder().encode(source.content).byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Context source ${sourceUri} exceeds ${MAX_SOURCE_BYTES} bytes.`);
  }
  const environmentFile = isEnvironmentContextSource(path, sourceUri);
  const redacted = redactContextContent(source.content, { environmentFile });
  return {
    ...source,
    sourceUri,
    path,
    content: normalizeContextText(redacted.content),
    metadata: {
      ...sanitizeMetadata(source.metadata),
      redactionCount: redacted.findings.reduce((total, finding) => total + finding.count, 0),
      injectionFlags: redacted.injectionFlags,
    },
  };
}

export class ContextSourceRegistry {
  readonly #sources = new Map<string, ContextSource>();

  register(source: ContextSource): ContextSource | null {
    const safe = sanitizeSource(source);
    if (!safe) return null;
    const key = registryKey(safe);
    if (!this.#sources.has(key) && this.#sources.size >= MAX_SOURCES) {
      throw new Error(`Context registry exceeds ${MAX_SOURCES} sources.`);
    }
    this.#sources.set(key, structuredClone(safe));
    return structuredClone(safe);
  }

  registerMany(sources: ContextSource[]): ContextSource[] {
    return sources.map((source) => this.register(source)).filter((source): source is ContextSource => source !== null);
  }

  list(scope: ContextScope): ContextSource[] {
    return [...this.#sources.values()]
      .filter((source) => sameContextScope(source, scope))
      .sort((left, right) => compareContextText(registryKey(left), registryKey(right)))
      .map((source) => structuredClone(source));
  }

  deleteSource(scope: ContextScope, sourceUri: string, sourceVersion?: string): number {
    const canonicalUri = canonicalizeSourceUri(sourceUri);
    let deleted = 0;
    for (const [key, source] of this.#sources) {
      if (!sameContextScope(source, scope) || source.sourceUri !== canonicalUri) continue;
      if (sourceVersion !== undefined && source.sourceVersion !== sourceVersion) continue;
      this.#sources.delete(key);
      deleted += 1;
    }
    return deleted;
  }

  clearScope(scope: ContextScope): number {
    let deleted = 0;
    for (const [key, source] of this.#sources) {
      if (!sameContextScope(source, scope)) continue;
      this.#sources.delete(key);
      deleted += 1;
    }
    return deleted;
  }
}
