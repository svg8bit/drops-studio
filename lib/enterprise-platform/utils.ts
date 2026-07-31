import { createHash } from "node:crypto";

import { enterpriseError } from "./errors.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,191}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(?:ghp_|github_pat_|sk-proj-|dst_sa_)[A-Za-z0-9_-]{16,})/i;

function isSecretKey(value: string): boolean {
  const compact = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (["apikey", "accesstoken", "refreshtoken", "token", "secret", "password", "authorization", "cookie", "privatekey"].includes(compact)) return true;
  if (["tokenhash", "tokenprefix", "secretreference", "secretreferenceid"].some((suffix) => compact.endsWith(suffix))) return false;
  return ["apikey", "accesstoken", "refreshtoken", "token", "secret", "password", "authorization", "cookie", "privatekey"]
    .some((suffix) => compact.endsWith(suffix));
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function assertSafeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) enterpriseError("INVALID_INPUT", `${label} is invalid.`);
  return value;
}

export function boundedText(value: string, label: string, maximum = 240): string {
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > maximum || normalized.includes("\0")) {
    enterpriseError("INVALID_INPUT", `${label} is invalid.`);
  }
  return normalized;
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    enterpriseError("INVALID_INPUT", "Email is invalid.");
  }
  return normalized;
}

export function normalizeDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.length > 253 || normalized.split(".").some((part) =>
    !part || part.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))) {
    enterpriseError("INVALID_INPUT", "Domain is invalid.");
  }
  return normalized;
}

export function normalizeProjectPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    !normalized
    || normalized.length > 512
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || normalized.split("/").some((part) => !part || part === "." || part === ".." || !SAFE_PATH_SEGMENT.test(part))
  ) enterpriseError("INVALID_INPUT", "Project path is invalid.");
  return normalized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fileHash(value: string | undefined): string | null {
  return value === undefined ? null : sha256(value);
}

export function matchesScope(path: string, scope: string): boolean {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedScope = normalizeProjectPath(scope.replace(/\/\*\*$/, "/placeholder")).replace(/\/placeholder$/, "/**");
  if (normalizedScope.endsWith("/**")) return normalizedPath.startsWith(normalizedScope.slice(0, -2));
  return normalizedPath === normalizedScope;
}

export function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.some(containsSecretLikeValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
    isSecretKey(key) || containsSecretLikeValue(entry));
}

export function secretFreeClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(secretFreeClone);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && SECRET_VALUE.test(value) ? "[REDACTED]" : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSecretKey(key))
      .map(([key, entry]) => [key, secretFreeClone(entry)]),
  );
}

export function iso(date: Date): string {
  if (!Number.isFinite(date.getTime())) enterpriseError("INVALID_INPUT", "Date is invalid.");
  return date.toISOString();
}
