import { createHash, randomUUID } from "node:crypto";

import {
  createDurableProjectDataBackend,
  DEFAULT_PROJECT_DATA_QUOTAS,
  ProjectDataError,
  ProjectDataStore,
  projectDataByteLength,
  sanitizeProjectDataDocument,
  type ProjectDataBackend,
  type ProjectDataDocument,
  type ProjectDataJsonObject,
  type ProjectDataJsonValue,
} from "./project-data/index.ts";

export const COLLABORATION_EVENT_TYPES = [
  "document.patch",
  "document.replace",
  "presence.update",
  "comment.create",
  "comment.resolve",
  "ai.branch.apply",
  "checkpoint.created",
] as const;

export type CollaborationEventType = typeof COLLABORATION_EVENT_TYPES[number];

export const COLLABORATION_MAX_REQUEST_BYTES = 12 * 1_024;
export const COLLABORATION_MAX_EVENT_PAYLOAD_BYTES = 8 * 1_024;
export const COLLABORATION_MAX_RETAINED_EVENTS = 32;
export const COLLABORATION_MAX_ROOM_BYTES = 56 * 1_024;
export const COLLABORATION_MAX_READ_EVENTS = 50;

const ROOM_NAMESPACE = "collaboration";
const ROOM_DOCUMENT_ID = "room";
const SAFE_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:@._-]{0,191}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const EVENT_ID_PATTERN = /^evt_[1-9]\d*_[A-Za-z0-9]{1,32}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const eventTypeSet = new Set<string>(COLLABORATION_EVENT_TYPES);

export interface CollaborationRoomScope {
  workspaceId: string;
  projectId: string;
}

export interface CollaborationEvent {
  id: string;
  revision: number;
  actorId: string;
  type: CollaborationEventType;
  payload: ProjectDataJsonObject;
  createdAt: string;
}

interface CollaborationIdempotencyRecord {
  key: string;
  actorId: string;
  fingerprint: string;
  revision: number;
}

interface CollaborationRoomData {
  schemaVersion: 1;
  revision: number;
  events: CollaborationEvent[];
  idempotency: CollaborationIdempotencyRecord[];
}

export interface CollaborationAppendInput extends CollaborationRoomScope {
  actorId: string;
  expectedRevision: number;
  idempotencyKey: string;
  type: CollaborationEventType;
  payload: unknown;
}

export interface CollaborationAppendResult {
  revision: number;
  event: CollaborationEvent;
  idempotent: boolean;
  retainedFromRevision: number;
}

export interface CollaborationReadResult {
  revision: number;
  retainedFromRevision: number;
  events: CollaborationEvent[];
}

export interface CollaborationHealthReceipt {
  status: "working";
  mode: ProjectDataBackend["kind"];
  checkedAt: string;
  latencyMs: number;
  evidence: [
    "collaboration-durable-write-live",
    "collaboration-durable-read-live",
    "collaboration-two-actor-order-live",
    "collaboration-idempotency-live",
    "collaboration-cleanup-live",
  ];
}

export type CollaborationTransportErrorCode =
  | "invalid_request"
  | "conflict"
  | "quota_exceeded"
  | "secret_rejected"
  | "storage_unavailable";

export class CollaborationTransportError extends Error {
  readonly code: CollaborationTransportErrorCode;
  readonly status: number;
  readonly currentRevision?: number;

  constructor(
    code: CollaborationTransportErrorCode,
    message: string,
    options: { status?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = "CollaborationTransportError";
    this.code = code;
    this.status = options.status ?? ({
      invalid_request: 400,
      conflict: 409,
      quota_exceeded: 413,
      secret_rejected: 400,
      storage_unavailable: 503,
    } satisfies Record<CollaborationTransportErrorCode, number>)[code];
    this.currentRevision = options.currentRevision;
  }
}

function validScope(scope: CollaborationRoomScope): CollaborationRoomScope {
  if (
    typeof scope?.workspaceId !== "string"
    || typeof scope.projectId !== "string"
    || !SAFE_SCOPE_PATTERN.test(scope.workspaceId)
    || !SAFE_SCOPE_PATTERN.test(scope.projectId)
  ) {
    throw new CollaborationTransportError("invalid_request", "Collaboration room scope is invalid.");
  }
  return { workspaceId: scope.workspaceId, projectId: scope.projectId };
}

function validActor(actorId: unknown): string {
  if (typeof actorId !== "string" || !SAFE_ACTOR_PATTERN.test(actorId)) {
    throw new CollaborationTransportError("invalid_request", "Collaboration actor is invalid.");
  }
  return actorId;
}

function validRevision(value: unknown, field = "expectedRevision"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CollaborationTransportError("invalid_request", `${field} must be a non-negative integer.`);
  }
  return value;
}

function validIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new CollaborationTransportError(
      "invalid_request",
      "Collaboration idempotency key must be 8-128 safe characters.",
    );
  }
  return value;
}

function validEventType(value: unknown): CollaborationEventType {
  if (typeof value !== "string" || !eventTypeSet.has(value)) {
    throw new CollaborationTransportError("invalid_request", "Collaboration event type is unsupported.");
  }
  return value as CollaborationEventType;
}

function safePayload(value: unknown): ProjectDataJsonObject {
  try {
    if (projectDataByteLength(value) > COLLABORATION_MAX_EVENT_PAYLOAD_BYTES) {
      throw new CollaborationTransportError("quota_exceeded", "Collaboration event payload is too large.");
    }
    const sanitized = sanitizeProjectDataDocument(
      { payload: value },
      {
        ...DEFAULT_PROJECT_DATA_QUOTAS,
        maxDocumentBytes: COLLABORATION_MAX_EVENT_PAYLOAD_BYTES + 256,
      },
    );
    const payload = sanitized.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new CollaborationTransportError(
        "invalid_request",
        "Collaboration event payload must be a JSON object.",
      );
    }
    return payload as ProjectDataJsonObject;
  } catch (error) {
    if (error instanceof CollaborationTransportError) throw error;
    throw mapProjectDataError(error);
  }
}

function canonicalJson(value: ProjectDataJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key] as ProjectDataJsonValue)}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventFingerprint(
  actorId: string,
  type: CollaborationEventType,
  payload: ProjectDataJsonObject,
): string {
  return createHash("sha256")
    .update(`${actorId}\n${type}\n${canonicalJson(payload)}`, "utf8")
    .digest("hex");
}

function storageProjectId(scope: CollaborationRoomScope): string {
  validScope(scope);
  const digest = createHash("sha256")
    .update(`${scope.workspaceId}\u0000${scope.projectId}`, "utf8")
    .digest("hex");
  return `collab:${digest}`;
}

function emptyRoom(): CollaborationRoomData {
  return {
    schemaVersion: 1,
    revision: 0,
    events: [],
    idempotency: [],
  };
}

function roomFromDocument(document: ProjectDataDocument | null): CollaborationRoomData {
  if (!document) return emptyRoom();
  let data: Partial<CollaborationRoomData>;
  try {
    data = sanitizeProjectDataDocument(document.data, {
      ...DEFAULT_PROJECT_DATA_QUOTAS,
      maxDocumentBytes: 60 * 1_024,
      maxProjectBytes: 64 * 1_024,
    }) as unknown as Partial<CollaborationRoomData>;
  } catch {
    throw new CollaborationTransportError(
      "storage_unavailable",
      "Collaboration storage returned an unsafe room state.",
    );
  }
  if (
    data.schemaVersion !== 1
    || !Number.isSafeInteger(data.revision)
    || Number(data.revision) < 1
    || document.revision !== data.revision
    || !Array.isArray(data.events)
    || data.events.length < 1
    || data.events.length > COLLABORATION_MAX_RETAINED_EVENTS
    || !Array.isArray(data.idempotency)
    || data.idempotency.length > COLLABORATION_MAX_RETAINED_EVENTS
  ) {
    throw new CollaborationTransportError(
      "storage_unavailable",
      "Collaboration storage returned an invalid room state.",
    );
  }
  let previousRevision = 0;
  for (const event of data.events) {
    if (
      !event
      || typeof event !== "object"
      || !EVENT_ID_PATTERN.test(event.id)
      || !Number.isSafeInteger(event.revision)
      || event.revision <= previousRevision
      || !SAFE_ACTOR_PATTERN.test(event.actorId)
      || !eventTypeSet.has(event.type)
      || !event.payload
      || typeof event.payload !== "object"
      || Array.isArray(event.payload)
      || typeof event.createdAt !== "string"
      || !Number.isFinite(Date.parse(event.createdAt))
    ) {
      throw new CollaborationTransportError(
        "storage_unavailable",
        "Collaboration storage returned an invalid event log.",
      );
    }
    previousRevision = event.revision;
  }
  if (previousRevision !== data.revision) {
    throw new CollaborationTransportError(
      "storage_unavailable",
      "Collaboration storage returned an incomplete event log.",
    );
  }
  const idempotencyKeys = new Set<string>();
  for (const record of data.idempotency) {
    if (
      !record
      || typeof record !== "object"
      || !IDEMPOTENCY_KEY_PATTERN.test(record.key)
      || idempotencyKeys.has(record.key)
      || !SAFE_ACTOR_PATTERN.test(record.actorId)
      || !FINGERPRINT_PATTERN.test(record.fingerprint)
      || !Number.isSafeInteger(record.revision)
      || !data.events.some((event) => event.revision === record.revision)
    ) {
      throw new CollaborationTransportError(
        "storage_unavailable",
        "Collaboration storage returned an invalid idempotency window.",
      );
    }
    idempotencyKeys.add(record.key);
  }
  return structuredClone(data as CollaborationRoomData);
}

function retainedFromRevision(room: CollaborationRoomData): number {
  return room.events[0]?.revision ?? (room.revision === 0 ? 0 : room.revision + 1);
}

function mapProjectDataError(error: unknown): CollaborationTransportError {
  if (error instanceof CollaborationTransportError) return error;
  if (error instanceof ProjectDataError) {
    const code: CollaborationTransportErrorCode = error.code === "conflict"
      ? "conflict"
      : error.code === "quota_exceeded"
        ? "quota_exceeded"
        : error.code === "secret_rejected"
          ? "secret_rejected"
          : error.code === "invalid_request"
            ? "invalid_request"
            : "storage_unavailable";
    return new CollaborationTransportError(code, error.message, {
      status: error.status,
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    });
  }
  return new CollaborationTransportError(
    "storage_unavailable",
    "Collaboration storage is temporarily unavailable.",
  );
}

function existingIdempotentResult(
  room: CollaborationRoomData,
  key: string,
  actorId: string,
  fingerprint: string,
): CollaborationAppendResult | null {
  const record = room.idempotency.find((item) => item.key === key);
  if (!record) return null;
  if (record.actorId !== actorId || record.fingerprint !== fingerprint) {
    throw new CollaborationTransportError(
      "conflict",
      "Collaboration idempotency key was already used for another event.",
      { currentRevision: room.revision },
    );
  }
  const event = room.events.find((item) => item.revision === record.revision);
  if (!event) {
    throw new CollaborationTransportError(
      "conflict",
      "Collaboration idempotency window expired. Refresh before retrying.",
      { currentRevision: room.revision },
    );
  }
  return {
    revision: room.revision,
    event: structuredClone(event),
    idempotent: true,
    retainedFromRevision: retainedFromRevision(room),
  };
}

function nextRoom(
  room: CollaborationRoomData,
  event: CollaborationEvent,
  idempotency: CollaborationIdempotencyRecord,
): CollaborationRoomData {
  const next: CollaborationRoomData = {
    schemaVersion: 1,
    revision: event.revision,
    events: [...room.events, event],
    idempotency: [...room.idempotency, idempotency],
  };
  while (
    next.events.length > COLLABORATION_MAX_RETAINED_EVENTS
    || projectDataByteLength(next) > COLLABORATION_MAX_ROOM_BYTES
  ) {
    const removed = next.events.shift();
    if (!removed) break;
    next.idempotency = next.idempotency.filter((item) => item.revision !== removed.revision);
  }
  if (!next.events.length || projectDataByteLength(next) > COLLABORATION_MAX_ROOM_BYTES) {
    throw new CollaborationTransportError("quota_exceeded", "Collaboration room event exceeds its quota.");
  }
  return next;
}

export class CollaborationTransport {
  readonly #backend: ProjectDataBackend;
  readonly #store: ProjectDataStore;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(
    backend: ProjectDataBackend,
    options: { now?: () => Date; id?: () => string } = {},
  ) {
    this.#backend = backend;
    this.#store = new ProjectDataStore(backend, {
      quotas: {
        maxNamespacesPerProject: 1,
        maxDocumentsPerNamespace: 1,
        maxDocumentBytes: 60 * 1_024,
        maxProjectBytes: 64 * 1_024,
      },
      now: () => (options.now ?? (() => new Date()))().toISOString(),
    });
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
  }

  get mode(): ProjectDataBackend["kind"] {
    return this.#backend.kind;
  }

  async read(
    scope: CollaborationRoomScope,
    options: { afterRevision?: number; limit?: number } = {},
  ): Promise<CollaborationReadResult> {
    const afterRevision = validRevision(options.afterRevision ?? 0, "afterRevision");
    const limit = options.limit ?? COLLABORATION_MAX_READ_EVENTS;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > COLLABORATION_MAX_READ_EVENTS) {
      throw new CollaborationTransportError(
        "invalid_request",
        `Collaboration event limit must be between 1 and ${COLLABORATION_MAX_READ_EVENTS}.`,
      );
    }
    try {
      const room = roomFromDocument(
        await this.#store.get(storageProjectId(scope), ROOM_NAMESPACE, ROOM_DOCUMENT_ID),
      );
      return {
        revision: room.revision,
        retainedFromRevision: retainedFromRevision(room),
        events: room.events
          .filter((event) => event.revision > afterRevision)
          .slice(0, limit)
          .map((event) => structuredClone(event)),
      };
    } catch (error) {
      throw mapProjectDataError(error);
    }
  }

  async append(input: CollaborationAppendInput): Promise<CollaborationAppendResult> {
    const scope = validScope(input);
    const actorId = validActor(input.actorId);
    const expectedRevision = validRevision(input.expectedRevision);
    const idempotencyKey = validIdempotencyKey(input.idempotencyKey);
    const type = validEventType(input.type);
    const payload = safePayload(input.payload);
    const fingerprint = eventFingerprint(actorId, type, payload);
    const projectId = storageProjectId(scope);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const currentDocument = await this.#store.get(projectId, ROOM_NAMESPACE, ROOM_DOCUMENT_ID);
        const room = roomFromDocument(currentDocument);
        const idempotent = existingIdempotentResult(
          room,
          idempotencyKey,
          actorId,
          fingerprint,
        );
        if (idempotent) return idempotent;
        if (room.revision !== expectedRevision) {
          throw new CollaborationTransportError(
            "conflict",
            "Collaboration room changed concurrently. Refresh and retry.",
            { currentRevision: room.revision },
          );
        }
        const revision = room.revision + 1;
        const event: CollaborationEvent = {
          id: `evt_${revision}_${this.#id().replaceAll("-", "").slice(0, 20)}`,
          revision,
          actorId,
          type,
          payload,
          createdAt: this.#now().toISOString(),
        };
        const next = nextRoom(room, event, {
          key: idempotencyKey,
          actorId,
          fingerprint,
          revision,
        });
        if (currentDocument) {
          await this.#store.update({
            projectId,
            namespace: ROOM_NAMESPACE,
            id: ROOM_DOCUMENT_ID,
            expectedRevision: currentDocument.revision,
            data: next as unknown as ProjectDataJsonObject,
          });
        } else {
          await this.#store.create({
            projectId,
            namespace: ROOM_NAMESPACE,
            id: ROOM_DOCUMENT_ID,
            data: next as unknown as ProjectDataJsonObject,
          });
        }
        return {
          revision,
          event: structuredClone(event),
          idempotent: false,
          retainedFromRevision: retainedFromRevision(next),
        };
      } catch (error) {
        const mapped = mapProjectDataError(error);
        // Retry only storage-layer compare-and-swap races. Caller-visible stale
        // revisions and idempotency conflicts are terminal and must not cause a
        // second durable read.
        const storageConflict = error instanceof ProjectDataError && error.code === "conflict";
        if (!storageConflict || attempt > 0) throw mapped;
      }
    }
    throw new CollaborationTransportError(
      "conflict",
      "Collaboration room changed concurrently. Refresh and retry.",
    );
  }

  async liveHealth(): Promise<CollaborationHealthReceipt> {
    const startedAt = Date.now();
    const nonce = this.#id().replaceAll("-", "");
    const scope = {
      workspaceId: `health_${nonce.slice(0, 32)}`,
      projectId: `project_${nonce.slice(0, 32)}`,
    };
    const scopedProjectId = storageProjectId(scope);
    let cleanupComplete = false;
    try {
      const first = await this.append({
        ...scope,
        actorId: "health-actor-a",
        expectedRevision: 0,
        idempotencyKey: `health-a-${nonce.slice(0, 32)}`,
        type: "presence.update",
        payload: { state: "editing", sequence: 1 },
      });
      const secondInput: CollaborationAppendInput = {
        ...scope,
        actorId: "health-actor-b",
        expectedRevision: first.revision,
        idempotencyKey: `health-b-${nonce.slice(0, 32)}`,
        type: "document.patch",
        payload: { operation: "health-check", sequence: 2 },
      };
      const second = await this.append(secondInput);
      const replay = await this.append(secondInput);
      const read = await this.read(scope, { afterRevision: 0, limit: 4 });
      if (
        first.revision !== 1
        || second.revision !== 2
        || !replay.idempotent
        || replay.event.id !== second.event.id
        || read.revision !== 2
        || read.events.length !== 2
        || read.events[0]?.actorId !== "health-actor-a"
        || read.events[1]?.actorId !== "health-actor-b"
        || read.events[0]?.revision !== 1
        || read.events[1]?.revision !== 2
      ) {
        throw new CollaborationTransportError(
          "storage_unavailable",
          "Collaboration live health receipt did not preserve two-actor event order.",
        );
      }
      const snapshot = await this.#backend.read(scopedProjectId);
      if (!snapshot) {
        throw new CollaborationTransportError(
          "storage_unavailable",
          "Collaboration live health receipt could not read its durable snapshot.",
        );
      }
      await this.#backend.deleteProject(scopedProjectId, snapshot.storeRevision);
      cleanupComplete = (await this.#backend.read(scopedProjectId)) === null;
      if (!cleanupComplete) {
        throw new CollaborationTransportError(
          "storage_unavailable",
          "Collaboration live health receipt cleanup was not confirmed.",
        );
      }
      return {
        status: "working",
        mode: this.#backend.kind,
        checkedAt: this.#now().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        evidence: [
          "collaboration-durable-write-live",
          "collaboration-durable-read-live",
          "collaboration-two-actor-order-live",
          "collaboration-idempotency-live",
          "collaboration-cleanup-live",
        ],
      };
    } catch (error) {
      if (!cleanupComplete) {
        try {
          const snapshot = await this.#backend.read(scopedProjectId);
          if (snapshot) await this.#backend.deleteProject(scopedProjectId, snapshot.storeRevision);
        } catch {
          // Preserve the original bounded health failure; the provider retains no reusable capability.
        }
      }
      throw mapProjectDataError(error);
    }
  }
}

export async function createProductionCollaborationTransport(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CollaborationTransport | null> {
  const backend = await createDurableProjectDataBackend(environment);
  return backend ? new CollaborationTransport(backend) : null;
}
