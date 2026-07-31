import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ManagedPrincipal, ManagedScope } from "./contracts.ts";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,95}$/i;
const APPROVAL_PATTERN = /^approval_[a-z0-9_-]{8,160}$/i;
const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|password|private.?key|api.?key|signature|csrf)/i;
const SECRET_VALUE = /(?:Bearer\s+[A-Za-z0-9._~+\/-]{6,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|\d{6,12}:[A-Za-z0-9_-]{20,}|(?:api[_-]?key|secret|token)\s*[:=]\s*[^\s,}]{6,})/gi;

export class ManagedPlatformError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ManagedPlatformError";
    this.code = code;
  }
}

function identifier(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!ID_PATTERN.test(normalized)) throw new ManagedPlatformError("INVALID_IDENTIFIER", `${label} is invalid.`);
  return normalized;
}

export function managedScope(input: Omit<ManagedScope, "scopeKey"> & { scopeKey?: string }): ManagedScope {
  const organizationId = identifier(input.organizationId, "Organization id");
  const workspaceId = identifier(input.workspaceId, "Workspace id");
  const projectId = identifier(input.projectId, "Project id");
  if (!["development", "preview", "production"].includes(input.environment)) {
    throw new ManagedPlatformError("INVALID_ENVIRONMENT", "Managed environment is invalid.");
  }
  const environment = input.environment;
  return Object.freeze({
    organizationId,
    workspaceId,
    projectId,
    environment,
    scopeKey: `${organizationId}/${workspaceId}/${projectId}/${environment}`,
  });
}

export function managedPrincipal(input: Omit<ManagedPrincipal, "scope"> & { scope: ManagedScope }): ManagedPrincipal {
  const scope = managedScope(input.scope);
  const roles = [...new Set(input.roles.map((role) => identifier(role, "Role")))].sort();
  const permissions = [...new Set(input.permissions.map((permission) => {
    const value = permission.trim();
    if (!/^[a-z][a-z0-9.-]{2,127}$/i.test(value)) throw new ManagedPlatformError("INVALID_PERMISSION", "Permission is invalid.");
    return value;
  }))].sort();
  return Object.freeze({
    actorId: identifier(input.actorId, "Actor id"),
    actorType: input.actorType,
    scope,
    roles: Object.freeze(roles) as unknown as string[],
    permissions: Object.freeze(permissions) as unknown as string[],
  });
}

export function assertScope(scope: ManagedScope, principal: ManagedPrincipal): void {
  if (scope.scopeKey !== principal.scope.scopeKey) {
    throw new ManagedPlatformError("SCOPE_MISMATCH", "Principal scope or environment does not authorize this operation.");
  }
}

export function requirePermission(principal: ManagedPrincipal, permission: string): void {
  if (!principal.permissions.includes(permission) && !principal.roles.includes("owner")) {
    throw new ManagedPlatformError("PERMISSION_DENIED", `Permission ${permission} is required.`);
  }
}

export function requireApproval(receipt: string | undefined): void {
  if (!receipt || !APPROVAL_PATTERN.test(receipt)) {
    throw new ManagedPlatformError("APPROVAL_REQUIRED", "A valid explicit approval receipt is required.");
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function signPayload(payload: Record<string, unknown>, key: Uint8Array): string {
  const encoded = Buffer.from(stableJson(payload)).toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySignedPayload(token: string, key: Uint8Array): Record<string, unknown> {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new ManagedPlatformError("CAPABILITY_INVALID", "Signed capability is invalid.");
  }
  const [encoded, signature] = token.split(".");
  const expected = createHmac("sha256", key).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) throw new ManagedPlatformError("CAPABILITY_INVALID", "Signed capability is invalid.");
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ManagedPlatformError("CAPABILITY_INVALID", "Signed capability payload is invalid.");
  }
}

function sanitizeString(value: string): string {
  const bounded = value.length > 2_000 ? `${value.slice(0, 2_000)}…[TRUNCATED]` : value;
  return bounded.replace(SECRET_VALUE, "[REDACTED]");
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeLogValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeLogValue(nested, depth + 1),
    ]));
  }
  return String(value);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
