import type { TeamSharedProject, TeamWorkspace } from "./team-workspaces.ts";

const TRANSPORT_ENDPOINT = "/api/collaboration/transport";
const DURABLE_TRANSPORT_MODES = new Set([
  "neon-postgres",
  "vercel-blob-private",
]);
const SAFE_SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_EVENT_PAYLOAD_BYTES = 8 * 1_024;
const INVALIDATION_FIELDS = new Set([
  "digest",
  "operation",
  "projectId",
  "projectRevision",
  "schemaVersion",
  "target",
  "updatedAt",
  "workspaceRevision",
]);

export type CollaborationTransportMode =
  | "neon-postgres"
  | "vercel-blob-private";

export interface CollaborationClientScope {
  workspaceId: string;
  projectId: string;
}

export interface CollaborationClientEvent {
  id: string;
  revision: number;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CollaborationReadReceipt {
  revision: number;
  retainedFromRevision: number;
  events: CollaborationClientEvent[];
  mode: CollaborationTransportMode;
  historyGap: boolean;
}

export interface TeamProjectInvalidationPayload {
  schemaVersion: 1;
  target: "team-shared-project";
  operation: "project.upsert";
  projectId: string;
  projectRevision: number;
  workspaceRevision: number;
  digest: string;
  updatedAt: string;
}

export interface CollaborationAppendReceipt {
  revision: number;
  event: CollaborationClientEvent;
  idempotent: boolean;
  mode: CollaborationTransportMode;
  reconciledEvents: CollaborationClientEvent[];
  reconciledHistoryGap: boolean;
}

export type CollaborationClientErrorCode =
  | "conflict"
  | "forbidden"
  | "history_gap"
  | "invalid_response"
  | "non_durable"
  | "signed_out"
  | "unavailable";

export class CollaborationClientError extends Error {
  readonly code: CollaborationClientErrorCode;
  readonly status: number;
  readonly currentRevision?: number;

  constructor(
    code: CollaborationClientErrorCode,
    message: string,
    options: { status?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = "CollaborationClientError";
    this.code = code;
    this.status = options.status ?? 0;
    this.currentRevision = options.currentRevision;
  }
}

type Fetcher = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responseRecord(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().then(record).catch(() => null);
  return value ?? {};
}

function apiError(
  response: Response,
  payload: Record<string, unknown>,
  fallback: string,
): CollaborationClientError {
  const message = typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : fallback;
  const currentRevision = Number.isSafeInteger(payload.currentRevision)
    ? Number(payload.currentRevision)
    : undefined;
  if (response.status === 401) {
    return new CollaborationClientError("signed_out", message, { status: 401 });
  }
  if (response.status === 403 || response.status === 404) {
    return new CollaborationClientError("forbidden", message, { status: response.status });
  }
  if (response.status === 409) {
    return new CollaborationClientError("conflict", message, {
      status: 409,
      currentRevision,
    });
  }
  return new CollaborationClientError("unavailable", message, {
    status: response.status,
    currentRevision,
  });
}

function scope(value: CollaborationClientScope): CollaborationClientScope {
  if (!SAFE_SCOPE.test(value.workspaceId) || !SAFE_SCOPE.test(value.projectId)) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration scope is invalid.",
    );
  }
  return value;
}

function durableMode(value: unknown): CollaborationTransportMode {
  if (typeof value !== "string" || !DURABLE_TRANSPORT_MODES.has(value)) {
    throw new CollaborationClientError(
      "non_durable",
      "Durable collaboration transport did not return a live provider receipt.",
    );
  }
  return value as CollaborationTransportMode;
}

function event(value: unknown): CollaborationClientEvent {
  const input = record(value);
  const payload = record(input?.payload);
  if (
    !input
    || typeof input.id !== "string"
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 1
    || typeof input.actorId !== "string"
    || typeof input.type !== "string"
    || !payload
    || typeof input.createdAt !== "string"
    || !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration transport returned an invalid event receipt.",
    );
  }
  return {
    id: input.id,
    revision: Number(input.revision),
    actorId: input.actorId,
    type: input.type,
    payload,
    createdAt: input.createdAt,
  };
}

function readReceipt(
  payload: Record<string, unknown>,
  afterRevision: number,
): CollaborationReadReceipt {
  if (
    payload.status !== "working"
    || !Number.isSafeInteger(payload.revision)
    || Number(payload.revision) < 0
    || !Number.isSafeInteger(payload.retainedFromRevision)
    || Number(payload.retainedFromRevision) < 0
    || !Array.isArray(payload.events)
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration transport returned an invalid read receipt.",
    );
  }
  const revision = Number(payload.revision);
  const retainedFromRevision = Number(payload.retainedFromRevision);
  const events = payload.events.map(event);
  if (
    revision < afterRevision
    || events.some((item, index) => (
      item.revision <= afterRevision
      || item.revision > revision
      || (index > 0 && item.revision <= events[index - 1].revision)
    ))
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration transport returned an unordered revision receipt.",
    );
  }
  return {
    revision,
    retainedFromRevision,
    events,
    mode: durableMode(payload.mode),
    historyGap: afterRevision > 0 && retainedFromRevision > afterRevision + 1,
  };
}

export async function readCollaborationTransport(
  value: CollaborationClientScope,
  afterRevision: number,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<CollaborationReadReceipt> {
  const selected = scope(value);
  if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration revision is invalid.",
    );
  }
  const query = new URLSearchParams({
    workspaceId: selected.workspaceId,
    projectId: selected.projectId,
    afterRevision: String(afterRevision),
    limit: "32",
  });
  let response: Response;
  try {
    response = await fetcher(`${TRANSPORT_ENDPOINT}?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    throw new CollaborationClientError(
      "unavailable",
      "Collaboration transport could not be reached.",
    );
  }
  const payload = await responseRecord(response);
  if (!response.ok) {
    throw apiError(response, payload, "Collaboration updates are unavailable.");
  }
  return readReceipt(payload, afterRevision);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function createTeamProjectInvalidation(
  workspace: Pick<TeamWorkspace, "id" | "revision">,
  project: TeamSharedProject,
): Promise<TeamProjectInvalidationPayload> {
  if (
    !SAFE_SCOPE.test(workspace.id)
    || !SAFE_SCOPE.test(project.projectId)
    || !Number.isSafeInteger(workspace.revision)
    || workspace.revision < 1
    || !Number.isSafeInteger(project.revision)
    || project.revision < 1
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Shared project receipt is invalid.",
    );
  }
  const bytes = new TextEncoder().encode(canonicalJson({
    projectId: project.projectId,
    revision: project.revision,
    draft: project.draft,
    updatedAt: project.updatedAt,
    updatedBy: project.updatedBy,
  }));
  const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    schemaVersion: 1,
    target: "team-shared-project",
    operation: "project.upsert",
    projectId: project.projectId,
    projectRevision: project.revision,
    workspaceRevision: workspace.revision,
    digest,
    updatedAt: project.updatedAt,
  };
}

export function isTeamProjectInvalidation(
  value: CollaborationClientEvent,
  projectId: string,
): value is CollaborationClientEvent & { payload: TeamProjectInvalidationPayload } {
  const payload = value.payload;
  return value.type === "document.replace"
    && payload.schemaVersion === 1
    && payload.target === "team-shared-project"
    && payload.operation === "project.upsert"
    && payload.projectId === projectId
    && Number.isSafeInteger(payload.projectRevision)
    && Number(payload.projectRevision) > 0
    && Number.isSafeInteger(payload.workspaceRevision)
    && Number(payload.workspaceRevision) > 0
    && typeof payload.digest === "string"
    && SHA256.test(payload.digest)
    && typeof payload.updatedAt === "string"
    && Number.isFinite(Date.parse(payload.updatedAt));
}

function appendBody(
  value: CollaborationClientScope,
  expectedRevision: number,
  idempotencyKey: string,
  payload: TeamProjectInvalidationPayload,
): string {
  const selected = scope(value);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new CollaborationClientError("invalid_response", "Collaboration revision is invalid.");
  }
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new CollaborationClientError("invalid_response", "Collaboration idempotency key is invalid.");
  }
  const rawPayload = record(payload);
  if (
    !rawPayload
    || Object.keys(rawPayload).some((field) => !INVALIDATION_FIELDS.has(field))
    || rawPayload.schemaVersion !== 1
    || rawPayload.target !== "team-shared-project"
    || rawPayload.operation !== "project.upsert"
    || rawPayload.projectId !== selected.projectId
    || !Number.isSafeInteger(rawPayload.projectRevision)
    || Number(rawPayload.projectRevision) < 1
    || !Number.isSafeInteger(rawPayload.workspaceRevision)
    || Number(rawPayload.workspaceRevision) < 1
    || typeof rawPayload.digest !== "string"
    || !SHA256.test(rawPayload.digest)
    || typeof rawPayload.updatedAt !== "string"
    || !Number.isFinite(Date.parse(rawPayload.updatedAt))
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration invalidation payload is invalid.",
    );
  }
  const safePayload: TeamProjectInvalidationPayload = {
    schemaVersion: 1,
    target: "team-shared-project",
    operation: "project.upsert",
    projectId: rawPayload.projectId,
    projectRevision: Number(rawPayload.projectRevision),
    workspaceRevision: Number(rawPayload.workspaceRevision),
    digest: rawPayload.digest,
    updatedAt: rawPayload.updatedAt,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(safePayload)).byteLength;
  if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration invalidation receipt exceeds its safe size boundary.",
    );
  }
  return JSON.stringify({
    ...value,
    expectedRevision,
    idempotencyKey,
    type: "document.replace",
    payload: safePayload,
  });
}

async function appendOnce(
  value: CollaborationClientScope,
  expectedRevision: number,
  idempotencyKey: string,
  payload: TeamProjectInvalidationPayload,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<CollaborationAppendReceipt> {
  const body = appendBody(value, expectedRevision, idempotencyKey, payload);
  let response: Response;
  try {
    response = await fetcher(TRANSPORT_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body,
      signal,
    });
  } catch {
    throw new CollaborationClientError(
      "unavailable",
      "Collaboration invalidation could not be delivered.",
    );
  }
  const responsePayload = await responseRecord(response);
  if (!response.ok) {
    throw apiError(response, responsePayload, "Collaboration invalidation was not accepted.");
  }
  if (
    responsePayload.status !== "working"
    || !Number.isSafeInteger(responsePayload.revision)
    || typeof responsePayload.idempotent !== "boolean"
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Collaboration transport returned an invalid append receipt.",
    );
  }
  return {
    revision: Number(responsePayload.revision),
    event: event(responsePayload.event),
    idempotent: responsePayload.idempotent,
    mode: durableMode(responsePayload.mode),
    reconciledEvents: [],
    reconciledHistoryGap: false,
  };
}

export async function appendCollaborationInvalidation(
  value: CollaborationClientScope,
  expectedRevision: number,
  idempotencyKey: string,
  payload: TeamProjectInvalidationPayload,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<CollaborationAppendReceipt> {
  try {
    return await appendOnce(
      value,
      expectedRevision,
      idempotencyKey,
      payload,
      fetcher,
      signal,
    );
  } catch (error) {
    if (!(error instanceof CollaborationClientError) || error.code !== "conflict") {
      throw error;
    }
    const reconciled = await readCollaborationTransport(
      value,
      expectedRevision,
      fetcher,
      signal,
    );
    const receipt = await appendOnce(
      value,
      reconciled.revision,
      idempotencyKey,
      payload,
      fetcher,
      signal,
    );
    return {
      ...receipt,
      reconciledEvents: reconciled.events,
      reconciledHistoryGap: reconciled.historyGap,
    };
  }
}

export async function readAuthoritativeTeamWorkspace(
  workspaceId: string,
  ownerIdentity: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<TeamWorkspace> {
  if (!SAFE_SCOPE.test(workspaceId) || !ownerIdentity) {
    throw new CollaborationClientError(
      "invalid_response",
      "Team workspace lookup is invalid.",
    );
  }
  const query = new URLSearchParams({ owner: ownerIdentity });
  let response: Response;
  try {
    response = await fetcher(`/api/teams/${encodeURIComponent(workspaceId)}?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    throw new CollaborationClientError(
      "unavailable",
      "The authoritative team revision could not be reached.",
    );
  }
  const payload = await responseRecord(response);
  if (!response.ok) {
    throw apiError(response, payload, "The authoritative team revision is unavailable.");
  }
  const workspace = record(payload.workspace);
  if (
    !workspace
    || workspace.id !== workspaceId
    || workspace.ownerIdentity !== ownerIdentity
    || !Number.isSafeInteger(workspace.revision)
    || !Array.isArray(workspace.members)
    || !Array.isArray(workspace.projects)
  ) {
    throw new CollaborationClientError(
      "invalid_response",
      "Team workspace returned an invalid authoritative revision.",
    );
  }
  return workspace as unknown as TeamWorkspace;
}
