import { assertProjectPayloadSafe, ArtifactSecretError } from "../artifact-security.ts";

import {
  DEFAULT_PROJECT_DATA_QUOTAS,
  ProjectDataError,
  type ProjectDataJsonObject,
  type ProjectDataJsonValue,
  type ProjectDataQuotas,
} from "./types.ts";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const NAMESPACE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:@._-]{0,191}$/;
const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);

export function validateProjectDataProjectId(value: unknown): string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw new ProjectDataError("invalid_request", "Project id is invalid.");
  }
  return value;
}

export function validateProjectDataNamespace(value: unknown): string {
  if (typeof value !== "string" || !NAMESPACE_PATTERN.test(value)) {
    throw new ProjectDataError("invalid_request", "Project data namespace is invalid.");
  }
  return value;
}

export function validateProjectDataDocumentId(value: unknown): string {
  if (typeof value !== "string" || !DOCUMENT_ID_PATTERN.test(value)) {
    throw new ProjectDataError("invalid_request", "Project data document id is invalid.");
  }
  return value;
}

export function validateProjectDataSubject(value: unknown): string {
  if (typeof value !== "string" || !SUBJECT_PATTERN.test(value)) {
    throw new ProjectDataError("invalid_request", "Project data capability subject is invalid.");
  }
  return value;
}

export function validateExpectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProjectDataError("invalid_request", "expectedRevision must be a non-negative integer.");
  }
  return value;
}

export function projectDataByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function inspectJson(
  value: unknown,
  quotas: ProjectDataQuotas,
  depth: number,
  state: { nodes: number },
): asserts value is ProjectDataJsonValue {
  state.nodes += 1;
  if (state.nodes > quotas.maxJsonNodes) {
    throw new ProjectDataError("quota_exceeded", "Project data document contains too many JSON nodes.");
  }
  if (depth > quotas.maxJsonDepth) {
    throw new ProjectDataError("quota_exceeded", "Project data document is nested too deeply.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProjectDataError("invalid_request", "Project data numbers must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectJson(item, quotas, depth + 1, state);
    return;
  }
  if (typeof value !== "object") {
    throw new ProjectDataError("invalid_request", "Project data must contain JSON values only.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectDataError("invalid_request", "Project data objects must be plain JSON objects.");
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 128 || blockedKeys.has(key)) {
      throw new ProjectDataError("invalid_request", "Project data contains an unsafe or oversized field name.");
    }
    inspectJson(item, quotas, depth + 1, state);
  }
}

export function sanitizeProjectDataDocument(
  value: unknown,
  quotas: ProjectDataQuotas = DEFAULT_PROJECT_DATA_QUOTAS,
): ProjectDataJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDataError("invalid_request", "Project data document must be a JSON object.");
  }
  inspectJson(value, quotas, 0, { nodes: 0 });
  try {
    assertProjectPayloadSafe(value, "project data document");
  } catch (error) {
    if (error instanceof ArtifactSecretError) {
      throw new ProjectDataError(
        "secret_rejected",
        "Project data rejected credential-like material. Keep credentials in an approved server-side connection.",
      );
    }
    throw error;
  }
  const copy = JSON.parse(JSON.stringify(value)) as ProjectDataJsonObject;
  if (projectDataByteLength(copy) > quotas.maxDocumentBytes) {
    throw new ProjectDataError("quota_exceeded", "Project data document exceeds its byte quota.");
  }
  return copy;
}

export function resolvedProjectDataQuotas(
  overrides: Partial<ProjectDataQuotas> | undefined,
): ProjectDataQuotas {
  const quotas = { ...DEFAULT_PROJECT_DATA_QUOTAS, ...overrides };
  for (const [name, value] of Object.entries(quotas)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ProjectDataError("invalid_request", `Project data quota ${name} must be a positive integer.`);
    }
  }
  return quotas;
}
