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
  const ancestors = new Set<object>();
  const serialize = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Stable context JSON only accepts finite numbers.");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") throw new Error(`Stable context JSON received an unsupported ${typeof item} value.`);
    if (ancestors.has(item)) throw new Error("Stable context JSON cannot serialize cyclic values.");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return `[${item.map((entry) => serialize(entry)).join(",")}]`;
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("Stable context JSON only accepts arrays and plain objects.");
      }
      return `{${Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareContextText(left, right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry)}`)
        .join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  };
  return serialize(value);
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
  if (chunk.sensitivity === "secret-like") return false;
  if (chunk.trust === "untrusted-external" && !permission.allowedTrust?.includes("untrusted-external")) return false;
  if (permission.allowedTrust && !permission.allowedTrust.includes(chunk.trust)) return false;
  if (chunk.sensitivity === "workspace-private" && !permission.allowWorkspacePrivate) return false;
  if (chunk.sensitivity === "project-private" && !permission.allowProjectPrivate) return false;
  if (chunk.trust === "runtime-evidence" && !permission.includeRuntimeEvidence) return false;
  return true;
}

export function canonicalizeSourceUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) throw new Error("Context source URI is invalid.");
  const credentialParameters = new Set([
    "api-key", "api_key", "apikey", "access-token", "access_token", "accesstoken",
    "auth", "authorization", "client-secret", "client_secret", "clientsecret", "credential",
    "credentials", "key", "secret", "sig", "signature", "token",
  ]);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed)) {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (credentialParameters.has(key.toLocaleLowerCase("en-US"))) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hash = "";
    return url.toString();
  }
  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.startsWith("/")) throw new Error("Context source URI cannot be an absolute path.");
  const hashIndex = normalized.indexOf("#");
  const withoutHash = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const queryIndex = withoutHash.indexOf("?");
  const rawPath = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const rawQuery = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("Context source URI contains path traversal.");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length) throw new Error("Context source URI is invalid.");
  const parameters = new URLSearchParams(rawQuery);
  for (const key of [...parameters.keys()]) {
    if (credentialParameters.has(key.toLocaleLowerCase("en-US"))) parameters.delete(key);
  }
  parameters.sort();
  const query = parameters.toString();
  return `${segments.join("/")}${query ? `?${query}` : ""}`;
}

export function isEnvironmentContextSource(path: string | undefined, sourceUri: string): boolean {
  const candidates = path ? [path] : [];
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(sourceUri)) candidates.push(decodeURIComponent(new URL(sourceUri).pathname));
    else candidates.push(sourceUri.split(/[?#]/u, 1)[0]);
  } catch {
    candidates.push(sourceUri.split(/[?#]/u, 1)[0]);
  }
  return candidates.some((candidate) => /(?:^|\/)\.env(?:\.|$)/iu.test(candidate.replace(/\\/g, "/")));
}

export function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
