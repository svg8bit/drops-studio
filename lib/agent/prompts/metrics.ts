import { createHash } from "node:crypto";

export function promptContentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function estimatePromptTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

export function promptLineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stablePromptJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}
