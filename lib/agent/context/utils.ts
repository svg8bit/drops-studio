import type { ContextChunk, ContextPermissionState, ContextScope } from "./types.ts";

export function compareContextText(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function stableContextJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableContextJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareContextText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableContextJson(item)}`)
    .join(",")}}`;
}

export async function contextSha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this runtime.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeContextText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function estimateContextTokens(value: string): number {
  if (!value) return 0;
  const words = value.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(Math.max(value.length / 4, words * 1.25)));
}

export function lexicalTerms(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en-US");
  const terms = normalized.match(/[\p{L}\p{N}_@./:-]{2,}/gu) ?? [];
  return [...new Set(terms.flatMap((term) => {
    const parts = term.split(/[/.:-]+/u).filter((part) => part.length >= 2);
    return term.length > 1 ? [term, ...parts] : parts;
  }))].sort(compareContextText);
}

export function sameContextScope(chunk: ContextScope, scope: ContextScope): boolean {
  if (chunk.tenantId !== scope.tenantId || chunk.workspaceId !== scope.workspaceId) return false;
  const workspaceSource = chunk.projectId === undefined;
  if (chunk.projectId !== scope.projectId && !(scope.includeWorkspaceSources && workspaceSource)) return false;
  if (!workspaceSource && scope.branch !== undefined && chunk.branch !== scope.branch) return false;
  if (!workspaceSource && scope.revision !== undefined && chunk.revision !== scope.revision) return false;
  return true;
}

export function chunkPermitted(chunk: ContextChunk, permission: ContextPermissionState): boolean {
  if (permission.allowedTrust && !permission.allowedTrust.includes(chunk.trust)) return false;
  if (chunk.sensitivity === "workspace-private" && !permission.allowWorkspacePrivate) return false;
  if (chunk.sensitivity === "project-private" && !permission.allowProjectPrivate) return false;
  if (chunk.trust === "runtime-evidence" && !permission.includeRuntimeEvidence) return false;
  return true;
}

export function canonicalizeSourceUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) throw new Error("Context source URI is invalid.");
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|credential|signature|auth/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  }
}

export function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
