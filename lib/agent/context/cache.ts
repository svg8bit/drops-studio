import type { ContextPermissionState, ContextScope } from "./types.ts";
import { contextSha256, stableContextJson } from "./utils.ts";
import { redactContextContent } from "./redaction.ts";

export async function ingestionCacheKey(input: {
  sourceUri: string;
  sourceVersion: string;
  contentHash: string;
  chunkerVersion: string;
  redactionVersion: string;
  embeddingVersion: string;
}): Promise<string> {
  return contextSha256(stableContextJson(input));
}

export async function retrievalCacheKey(input: ContextScope & {
  projectRevision: string;
  normalizedQueries: string[];
  role: string;
  modelProfileHash: string;
  permission: ContextPermissionState;
  indexVersion: number;
  retrievalPolicyVersion: string;
  approvalState: string;
}): Promise<string> {
  return contextSha256(stableContextJson(input));
}

export async function contextPackageCacheKey(input: {
  retrievalChunkIds: string[];
  exactFileHashes: string[];
  taskHash: string;
  rolePromptVersion: string;
  tokenBudget: number;
  approvalState: string;
}): Promise<string> {
  return contextSha256(stableContextJson(input));
}

interface CacheEntry<T> {
  value: T;
  tags: Set<string>;
}

export class ContextCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  readonly #maxEntries: number;

  constructor(maxEntries = 1_024) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error("Context cache capacity must be an integer between 1 and 10000.");
    }
    this.#maxEntries = maxEntries;
  }

  get(key: string): T | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: T, tags: string[]): void {
    const serialized = JSON.stringify(value);
    if (redactContextContent(serialized).content !== serialized) {
      throw new Error("Secret-bearing context payloads cannot be cached.");
    }
    this.#entries.delete(key);
    this.#entries.set(key, { value: structuredClone(value), tags: new Set(tags) });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  invalidateTags(tags: string[]): number {
    const requested = new Set(tags);
    let deleted = 0;
    for (const [key, entry] of this.#entries) {
      if (![...entry.tags].some((tag) => requested.has(tag))) continue;
      this.#entries.delete(key);
      deleted += 1;
    }
    return deleted;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

export function contextCacheTags(scope: ContextScope, extras: { revision?: string; sourceUri?: string; permissionHash?: string } = {}): string[] {
  return [
    `tenant:${scope.tenantId}`,
    `workspace:${scope.tenantId}:${scope.workspaceId}`,
    scope.projectId ? `project:${scope.tenantId}:${scope.workspaceId}:${scope.projectId}` : "platform",
    extras.revision ? `revision:${extras.revision}` : "",
    extras.sourceUri ? `source:${extras.sourceUri}` : "",
    extras.permissionHash ? `permission:${extras.permissionHash}` : "",
  ].filter(Boolean);
}
