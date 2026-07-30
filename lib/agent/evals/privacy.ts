import { createHash } from "node:crypto";
import { findArtifactSecrets } from "../../artifact-security.ts";

const credentialLike = /\b(?:Bearer\s+)?(?:sk-(?:(?:proj|ant|or-v1)-)?[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|(?:vercel|vca)_[A-Za-z0-9_-]{20,}|\d{6,12}:[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,})\b/gi;
const controlCharacters = /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function traceFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function privacySafeText(value: string, maxLength = 240): string {
  const normalized = value
    .replace(controlCharacters, " ")
    .replace(credentialLike, "[redacted]")
    .replace(/\b(?:chain[- ]of[- ]thought|private scratchpad|hidden reasoning)\b/gi, "[private reasoning omitted]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = normalized.slice(0, Math.max(0, maxLength));
  return findArtifactSecrets(bounded, "agent trace").length ? "[redacted sensitive content]" : bounded;
}

export function privacySafeActorHash(actorId: string): string {
  return traceFingerprint(`drops-agent-actor:v2:${actorId}`);
}

export function assertPrivacySafeTrace(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 2_000_000) throw new Error("Agent trace exceeds the privacy-safe storage limit.");
  if (findArtifactSecrets(serialized, "agent trace").length) {
    throw new Error("Agent trace contains credential-like material.");
  }
  if (/\b(?:chain[- ]of[- ]thought|private scratchpad|hidden reasoning)\b/i.test(serialized)) {
    throw new Error("Agent trace cannot store private reasoning.");
  }
}

export function safePromptMetadata(prompt: string): { promptFingerprint: string; promptSummary: string } {
  return {
    promptFingerprint: traceFingerprint(prompt),
    promptSummary: privacySafeText(prompt, 180),
  };
}
