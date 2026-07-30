import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ProjectDataError,
  type ProjectDataCapabilityPayload,
  type ProjectDataPermission,
} from "./types.ts";
import {
  validateProjectDataNamespace,
  validateProjectDataProjectId,
  validateProjectDataSubject,
} from "./validation.ts";

const CAPABILITY_MAX_BYTES = 4_096;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;
const permissions = new Set<ProjectDataPermission>(["read", "write", "delete"]);

function signingSecret(secret: string): string {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new ProjectDataError("storage_unavailable", "Project data capability signing is not configured safely.");
  }
  return secret;
}

function signature(encoded: string, secret: string): string {
  return createHmac("sha256", signingSecret(secret))
    .update(`drops-studio:project-data:v1:${encoded}`, "utf8")
    .digest("base64url");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function capabilityPayload(value: unknown): ProjectDataCapabilityPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDataError("invalid_request", "Project data capability payload is invalid.");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== 1) throw new ProjectDataError("invalid_request", "Project data capability version is invalid.");
  const projectId = validateProjectDataProjectId(input.projectId);
  const subject = validateProjectDataSubject(input.subject);
  if (!Array.isArray(input.namespaces) || input.namespaces.length < 1 || input.namespaces.length > 16) {
    throw new ProjectDataError("invalid_request", "Project data capability namespaces are invalid.");
  }
  const namespaces = unique(input.namespaces.map(validateProjectDataNamespace));
  if (!Array.isArray(input.permissions) || input.permissions.length < 1 || input.permissions.length > 3) {
    throw new ProjectDataError("invalid_request", "Project data capability permissions are invalid.");
  }
  const capabilityPermissions = unique(input.permissions.map((permission) => {
    if (typeof permission !== "string" || !permissions.has(permission as ProjectDataPermission)) {
      throw new ProjectDataError("invalid_request", "Project data capability permission is invalid.");
    }
    return permission as ProjectDataPermission;
  }));
  const issuedAt = input.issuedAt;
  const expiresAt = input.expiresAt;
  if (
    typeof issuedAt !== "number"
    || !Number.isSafeInteger(issuedAt)
    || typeof expiresAt !== "number"
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 24 * 60 * 60 * 1_000
  ) {
    throw new ProjectDataError("invalid_request", "Project data capability lifetime is invalid.");
  }
  if (typeof input.nonce !== "string" || !NONCE_PATTERN.test(input.nonce)) {
    throw new ProjectDataError("invalid_request", "Project data capability nonce is invalid.");
  }
  return {
    version: 1,
    projectId,
    subject,
    namespaces,
    permissions: capabilityPermissions,
    issuedAt,
    expiresAt,
    nonce: input.nonce,
  };
}

export function createProjectDataCapability(
  input: Omit<ProjectDataCapabilityPayload, "version">,
  secret: string,
): string {
  const payload = capabilityPayload({ version: 1, ...input });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyProjectDataCapability(
  capability: string,
  secret: string,
  now = Date.now(),
): ProjectDataCapabilityPayload | null {
  try {
    if (!capability || new TextEncoder().encode(capability).byteLength > CAPABILITY_MAX_BYTES) return null;
    const separator = capability.lastIndexOf(".");
    if (separator <= 0 || separator === capability.length - 1) return null;
    const encoded = capability.slice(0, separator);
    const provided = Buffer.from(capability.slice(separator + 1), "base64url");
    const expected = Buffer.from(signature(encoded, secret), "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const payload = capabilityPayload(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (now < payload.issuedAt - 30_000 || now > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authorizeProjectDataCapability(
  payload: ProjectDataCapabilityPayload,
  input: { projectId: string; namespace: string; permission: ProjectDataPermission },
): void {
  if (payload.projectId !== input.projectId) {
    throw new ProjectDataError("forbidden", "Project data capability does not grant access to this project.");
  }
  if (!payload.namespaces.includes(input.namespace)) {
    throw new ProjectDataError("forbidden", "Project data capability does not grant access to this namespace.");
  }
  if (!payload.permissions.includes(input.permission)) {
    throw new ProjectDataError("forbidden", "Project data capability does not grant this operation.");
  }
}
