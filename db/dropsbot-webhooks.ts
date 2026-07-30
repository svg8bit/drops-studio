import { BlobPreconditionFailedError } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

import {
  redactDropsBotWebhookPayload,
  validDropsBotWebhookHash,
  type DropsBotJsonObject,
  type DropsBotWebhookEvent,
} from "../lib/dropsbot-webhook.ts";

const CONNECTION_SCHEMA = `CREATE TABLE IF NOT EXISTS dropsbot_webhook_connections (
  id TEXT PRIMARY KEY,
  owner_identity TEXT NOT NULL,
  project_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  callback_received_at TEXT,
  last_event_received_at TEXT,
  last_event_content_hash TEXT,
  UNIQUE (owner_identity, project_id)
)`;
const EVENT_SCHEMA = `CREATE TABLE IF NOT EXISTS dropsbot_webhook_events (
  id TEXT NOT NULL UNIQUE,
  connection_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (connection_id, content_hash)
)`;
const OWNER_INDEX = "CREATE INDEX IF NOT EXISTS dropsbot_webhook_owner_project_idx ON dropsbot_webhook_connections (owner_identity, project_id)";
const EVENT_INDEX = "CREATE INDEX IF NOT EXISTS dropsbot_webhook_event_time_idx ON dropsbot_webhook_events (connection_id, received_at DESC)";
const BLOB_PATH = "drops-studio/dropsbot/webhook-state-v1.json";
const MAX_CONNECTIONS = 500;
const MAX_EVENTS_PER_CONNECTION = 1_000;
const MAX_BLOB_STATE_BYTES = 4 * 1_024 * 1_024;

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

interface InternalConnection {
  id: string;
  ownerIdentity: string;
  projectId: string;
  capabilityHash: string;
  createdAt: string;
  consentedAt: string;
  callbackReceivedAt: string | null;
  lastEventReceivedAt: string | null;
  lastEventContentHash: string | null;
  events: DropsBotWebhookEvent[];
}

interface DropsBotBlobState {
  schemaVersion: 1;
  connections: InternalConnection[];
}

interface BlobSnapshot {
  state: DropsBotBlobState;
  etag: string | null;
}

interface D1ConnectionEvidenceRow {
  capability_hash: string;
  last_event_received_at: string | null;
  last_event_content_hash: string | null;
}

export type DropsBotCallbackEvidence =
  | {
      status: "pending";
      authentication: "capability-url";
      providerVerified: false;
      providerSignatureVerified: false;
    }
  | {
      status: "callback-received";
      authentication: "capability-url";
      providerVerified: false;
      providerSignatureVerified: false;
      receivedAt: string;
      contentHash: string;
    };

export interface DropsBotWebhookProject {
  connectionId: string;
  projectId: string;
  createdAt: string;
  consentedAt: string;
  events: DropsBotWebhookEvent[];
  callbackEvidence: DropsBotCallbackEvidence;
}

export type DropsBotWebhookCreateResult =
  | { status: "created"; project: DropsBotWebhookProject }
  | { status: "exists" };

export type DropsBotWebhookAcceptResult =
  | {
      status: "accepted" | "duplicate";
      event: DropsBotWebhookEvent;
      callbackEvidence: DropsBotCallbackEvidence;
    }
  | { status: "not-found" };

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
  var __DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__: DropsBotBlobState | undefined;
}

export class DropsBotWebhookStorageUnavailableError extends Error {
  constructor(message = "Drops Bot webhook storage is temporarily unavailable.") {
    super(message);
    this.name = "DropsBotWebhookStorageUnavailableError";
  }
}

export class DropsBotWebhookCapacityError extends Error {
  constructor(message = "Drops Bot webhook storage reached its safe MVP capacity.") {
    super(message);
    this.name = "DropsBotWebhookCapacityError";
  }
}

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function localStoreEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function blobAvailable(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export function dropsBotWebhookStorageConfigured(): boolean {
  return localStoreEnabled() || Boolean(database()) || blobAvailable();
}

function emptyState(): DropsBotBlobState {
  return { schemaVersion: 1, connections: [] };
}

function localState(): DropsBotBlobState | null {
  if (!localStoreEnabled()) return null;
  return globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ ??= emptyState();
}

function validIdentity(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Drops Bot webhook storage requires a signed account identity.");
  }
}

function validProjectId(value: string): void {
  if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value)) {
    throw new Error("Drops Bot webhook storage requires a valid project id.");
  }
}

function validConnectionId(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new Error("Drops Bot webhook storage requires a valid connection id.");
  }
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hashesMatch(left: string, right: string): boolean {
  if (!validDropsBotWebhookHash(left) || !validDropsBotWebhookHash(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizedStoredPayload(value: unknown): DropsBotJsonObject {
  const sanitized = redactDropsBotWebhookPayload(value);
  if (JSON.stringify(sanitized) !== JSON.stringify(value)) {
    throw new DropsBotWebhookStorageUnavailableError(
      "Drops Bot webhook storage contained unredacted credential material.",
    );
  }
  return sanitized;
}

function sanitizedEvent(value: unknown): DropsBotWebhookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid event.");
  }
  const input = value as Partial<DropsBotWebhookEvent>;
  if (
    typeof input.id !== "string"
    || !/^[A-Za-z0-9_-]{4,80}$/.test(input.id)
    || typeof input.contentHash !== "string"
    || !validDropsBotWebhookHash(input.contentHash)
    || typeof input.receivedAt !== "string"
    || !validTimestamp(input.receivedAt)
  ) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid event.");
  }
  return {
    id: input.id,
    contentHash: input.contentHash,
    receivedAt: input.receivedAt,
    payload: sanitizedStoredPayload(input.payload),
  };
}

function sanitizedInputEvent(value: DropsBotWebhookEvent): DropsBotWebhookEvent {
  if (
    !/^[A-Za-z0-9_-]{4,80}$/.test(value.id)
    || !validDropsBotWebhookHash(value.contentHash)
    || !validTimestamp(value.receivedAt)
  ) {
    throw new Error("Drops Bot webhook event is invalid.");
  }
  return {
    id: value.id,
    contentHash: value.contentHash,
    receivedAt: value.receivedAt,
    payload: redactDropsBotWebhookPayload(value.payload),
  };
}

function sanitizedConnection(value: unknown): InternalConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid connection.");
  }
  const input = value as Partial<InternalConnection>;
  try {
    validConnectionId(String(input.id ?? ""));
    validIdentity(String(input.ownerIdentity ?? ""));
    validProjectId(String(input.projectId ?? ""));
  } catch {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid connection.");
  }
  if (
    typeof input.capabilityHash !== "string"
    || !validDropsBotWebhookHash(input.capabilityHash)
    || typeof input.createdAt !== "string"
    || !validTimestamp(input.createdAt)
    || typeof input.consentedAt !== "string"
    || !validTimestamp(input.consentedAt)
    || !Array.isArray(input.events)
    || input.events.length > MAX_EVENTS_PER_CONNECTION
  ) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid connection.");
  }
  const events = input.events.map(sanitizedEvent);
  if (new Set(events.map((event) => event.contentHash)).size !== events.length) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned duplicate event receipts.");
  }
  const evidenceValues = [
    input.callbackReceivedAt,
    input.lastEventReceivedAt,
    input.lastEventContentHash,
  ];
  const evidencePending = evidenceValues.every((item) => item === null);
  const evidenceReceived = typeof input.callbackReceivedAt === "string"
    && validTimestamp(input.callbackReceivedAt)
    && typeof input.lastEventReceivedAt === "string"
    && validTimestamp(input.lastEventReceivedAt)
    && typeof input.lastEventContentHash === "string"
    && validDropsBotWebhookHash(input.lastEventContentHash)
    && events.some((event) => event.contentHash === input.lastEventContentHash);
  if (!evidencePending && !evidenceReceived) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned invalid callback evidence.");
  }
  return {
    id: String(input.id),
    ownerIdentity: String(input.ownerIdentity),
    projectId: String(input.projectId),
    capabilityHash: input.capabilityHash,
    createdAt: input.createdAt,
    consentedAt: input.consentedAt,
    callbackReceivedAt: evidencePending ? null : String(input.callbackReceivedAt),
    lastEventReceivedAt: evidencePending ? null : String(input.lastEventReceivedAt),
    lastEventContentHash: evidencePending ? null : String(input.lastEventContentHash),
    events,
  };
}

function parseState(value: unknown): DropsBotBlobState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid state.");
  }
  const input = value as Partial<DropsBotBlobState>;
  if (
    input.schemaVersion !== 1
    || !Array.isArray(input.connections)
    || input.connections.length > MAX_CONNECTIONS
  ) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned an invalid state.");
  }
  const connections = input.connections.map(sanitizedConnection);
  if (
    new Set(connections.map((connection) => connection.id)).size !== connections.length
    || new Set(connections.map((connection) => `${connection.ownerIdentity}:${connection.projectId}`)).size !== connections.length
  ) {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned duplicate connections.");
  }
  return { schemaVersion: 1, connections };
}

function serializedState(state: DropsBotBlobState): string {
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BLOB_STATE_BYTES) {
    throw new DropsBotWebhookCapacityError();
  }
  return serialized;
}

function callbackEvidence(connection: Pick<InternalConnection, "lastEventReceivedAt" | "lastEventContentHash">): DropsBotCallbackEvidence {
  if (connection.lastEventReceivedAt && connection.lastEventContentHash) {
    return {
      status: "callback-received",
      authentication: "capability-url",
      providerVerified: false,
      providerSignatureVerified: false,
      receivedAt: connection.lastEventReceivedAt,
      contentHash: connection.lastEventContentHash,
    };
  }
  return {
    status: "pending",
    authentication: "capability-url",
    providerVerified: false,
    providerSignatureVerified: false,
  };
}

function d1CallbackEvidence(connection: D1ConnectionEvidenceRow): DropsBotCallbackEvidence {
  return callbackEvidence({
    lastEventReceivedAt: connection.last_event_received_at == null
      ? null
      : String(connection.last_event_received_at),
    lastEventContentHash: connection.last_event_content_hash == null
      ? null
      : String(connection.last_event_content_hash),
  });
}

async function latestD1CallbackEvidence(
  db: D1Database,
  connectionId: string,
): Promise<DropsBotCallbackEvidence> {
  const connection = await db.prepare(
    `SELECT capability_hash, last_event_received_at, last_event_content_hash
    FROM dropsbot_webhook_connections WHERE id = ? LIMIT 1`,
  ).bind(connectionId).first<D1ConnectionEvidenceRow>();
  if (!connection) throw new DropsBotWebhookStorageUnavailableError();
  return d1CallbackEvidence(connection);
}

function publicProject(connection: InternalConnection): DropsBotWebhookProject {
  return {
    connectionId: connection.id,
    projectId: connection.projectId,
    createdAt: connection.createdAt,
    consentedAt: connection.consentedAt,
    events: structuredClone(connection.events)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
    callbackEvidence: callbackEvidence(connection),
  };
}

async function ensureDropsBotTables(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(CONNECTION_SCHEMA).run();
  await db.prepare(EVENT_SCHEMA).run();
  await db.prepare(OWNER_INDEX).run();
  await db.prepare(EVENT_INDEX).run();
  return db;
}

async function blobClient(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

async function readBlobState(storage: BlobStorage): Promise<BlobSnapshot> {
  const current = await storage.get(BLOB_PATH, { access: "private", useCache: false });
  if (!current) return { state: emptyState(), etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) {
    throw new DropsBotWebhookStorageUnavailableError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
  } catch {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned unreadable data.");
  }
  return { state: parseState(parsed), etag: current.blob.etag };
}

async function writeBlobState(
  storage: BlobStorage,
  snapshot: BlobSnapshot,
  state: DropsBotBlobState,
): Promise<void> {
  await storage.put(BLOB_PATH, serializedState(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(snapshot.etag),
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
    ...(snapshot.etag ? { ifMatch: snapshot.etag } : {}),
  });
}

async function mutateBlobState<T>(
  storage: BlobStorage,
  mutate: (state: DropsBotBlobState) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshot = await readBlobState(storage);
    const next = structuredClone(snapshot.state);
    const result = mutate(next);
    try {
      await writeBlobState(storage, snapshot, next);
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt === 7) throw error;
    }
  }
  throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage stayed busy after safe retries.");
}

function newConnection(input: {
  id: string;
  ownerIdentity: string;
  projectId: string;
  capabilityHash: string;
  createdAt: string;
  consentedAt: string;
}): InternalConnection {
  validConnectionId(input.id);
  validIdentity(input.ownerIdentity);
  validProjectId(input.projectId);
  if (!validDropsBotWebhookHash(input.capabilityHash)) throw new Error("Drops Bot webhook capability hash is invalid.");
  if (!validTimestamp(input.createdAt) || !validTimestamp(input.consentedAt)) {
    throw new Error("Drops Bot webhook timestamps are invalid.");
  }
  return {
    ...input,
    callbackReceivedAt: null,
    lastEventReceivedAt: null,
    lastEventContentHash: null,
    events: [],
  };
}

function createInState(
  state: DropsBotBlobState,
  connection: InternalConnection,
): DropsBotWebhookCreateResult {
  if (
    state.connections.some((item) => item.id === connection.id)
    || state.connections.some((item) =>
      item.ownerIdentity === connection.ownerIdentity && item.projectId === connection.projectId)
  ) {
    return { status: "exists" };
  }
  if (state.connections.length >= MAX_CONNECTIONS) throw new DropsBotWebhookCapacityError();
  state.connections.push(connection);
  return { status: "created", project: publicProject(connection) };
}

function acceptInState(
  state: DropsBotBlobState,
  input: {
    connectionId: string;
    capabilityHash: string;
    event: DropsBotWebhookEvent;
  },
): DropsBotWebhookAcceptResult {
  const connection = state.connections.find((item) => item.id === input.connectionId);
  if (!connection || !hashesMatch(connection.capabilityHash, input.capabilityHash)) {
    return { status: "not-found" };
  }
  const duplicate = connection.events.find((event) => event.contentHash === input.event.contentHash);
  if (duplicate) {
    return {
      status: "duplicate",
      event: structuredClone(duplicate),
      callbackEvidence: callbackEvidence(connection),
    };
  }
  if (connection.events.length >= MAX_EVENTS_PER_CONNECTION) throw new DropsBotWebhookCapacityError();
  connection.events.push(structuredClone(input.event));
  connection.callbackReceivedAt ??= input.event.receivedAt;
  connection.lastEventReceivedAt = input.event.receivedAt;
  connection.lastEventContentHash = input.event.contentHash;
  return {
    status: "accepted",
    event: structuredClone(input.event),
    callbackEvidence: callbackEvidence(connection),
  };
}

function connectionFromD1Row(row: Record<string, unknown>, events: DropsBotWebhookEvent[]): InternalConnection {
  return sanitizedConnection({
    id: String(row.id),
    ownerIdentity: String(row.owner_identity),
    projectId: String(row.project_id),
    capabilityHash: String(row.capability_hash),
    createdAt: String(row.created_at),
    consentedAt: String(row.consented_at),
    callbackReceivedAt: row.callback_received_at == null ? null : String(row.callback_received_at),
    lastEventReceivedAt: row.last_event_received_at == null ? null : String(row.last_event_received_at),
    lastEventContentHash: row.last_event_content_hash == null ? null : String(row.last_event_content_hash),
    events,
  });
}

function eventFromD1Row(row: Record<string, unknown>): DropsBotWebhookEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(String(row.payload_json)) as unknown;
  } catch {
    throw new DropsBotWebhookStorageUnavailableError("Drops Bot webhook storage returned unreadable event data.");
  }
  return sanitizedEvent({
    id: String(row.id),
    contentHash: String(row.content_hash),
    receivedAt: String(row.received_at),
    payload,
  });
}

export async function createDropsBotWebhookConnection(
  input: {
    id: string;
    ownerIdentity: string;
    projectId: string;
    capabilityHash: string;
    createdAt: string;
    consentedAt: string;
  },
  storageOverride?: BlobStorage,
): Promise<DropsBotWebhookCreateResult> {
  const connection = newConnection(input);
  if (storageOverride) {
    return mutateBlobState(storageOverride, (state) => createInState(state, connection));
  }
  const local = localState();
  if (local) {
    const next = structuredClone(local);
    const result = createInState(next, connection);
    if (result.status === "created") {
      serializedState(next);
      globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = next;
    }
    return result;
  }
  const db = await ensureDropsBotTables();
  if (db) {
    const existing = await db.prepare(
      "SELECT id FROM dropsbot_webhook_connections WHERE owner_identity = ? AND project_id = ? LIMIT 1",
    ).bind(connection.ownerIdentity, connection.projectId).first();
    if (existing) return { status: "exists" };
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO dropsbot_webhook_connections
      (id, owner_identity, project_id, capability_hash, created_at, consented_at, callback_received_at, last_event_received_at, last_event_content_hash)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).bind(
      connection.id,
      connection.ownerIdentity,
      connection.projectId,
      connection.capabilityHash,
      connection.createdAt,
      connection.consentedAt,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) < 1) return { status: "exists" };
    return { status: "created", project: publicProject(connection) };
  }
  if (blobAvailable()) {
    const storage = await blobClient();
    return mutateBlobState(storage, (state) => createInState(state, connection));
  }
  throw new DropsBotWebhookStorageUnavailableError();
}

export async function acceptDropsBotWebhookEvent(
  input: {
    connectionId: string;
    capabilityHash: string;
    event: DropsBotWebhookEvent;
  },
  storageOverride?: BlobStorage,
): Promise<DropsBotWebhookAcceptResult> {
  validConnectionId(input.connectionId);
  if (!validDropsBotWebhookHash(input.capabilityHash)) return { status: "not-found" };
  const event = sanitizedInputEvent(input.event);
  const mutation = { ...input, event };
  if (storageOverride) {
    return mutateBlobState(storageOverride, (state) => acceptInState(state, mutation));
  }
  const local = localState();
  if (local) {
    const next = structuredClone(local);
    const result = acceptInState(next, mutation);
    if (result.status === "accepted") {
      serializedState(next);
      globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = next;
    }
    return result;
  }
  const db = await ensureDropsBotTables();
  if (db) {
    const connection = await db.prepare(
      `SELECT capability_hash, last_event_received_at, last_event_content_hash
      FROM dropsbot_webhook_connections WHERE id = ? LIMIT 1`,
    ).bind(input.connectionId).first<D1ConnectionEvidenceRow>();
    if (!connection || !hashesMatch(String(connection.capability_hash), input.capabilityHash)) {
      return { status: "not-found" };
    }
    const existing = await db.prepare(
      "SELECT id, content_hash, received_at, payload_json FROM dropsbot_webhook_events WHERE connection_id = ? AND content_hash = ? LIMIT 1",
    ).bind(input.connectionId, event.contentHash).first<Record<string, unknown>>();
    if (existing) {
      return {
        status: "duplicate",
        event: eventFromD1Row(existing),
        callbackEvidence: await latestD1CallbackEvidence(db, input.connectionId),
      };
    }
    const count = await db.prepare(
      "SELECT COUNT(*) AS count FROM dropsbot_webhook_events WHERE connection_id = ?",
    ).bind(input.connectionId).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= MAX_EVENTS_PER_CONNECTION) throw new DropsBotWebhookCapacityError();
    const [inserted] = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO dropsbot_webhook_events
        (id, connection_id, content_hash, received_at, payload_json)
        SELECT ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM dropsbot_webhook_events WHERE connection_id = ?) < ?`,
      ).bind(
        event.id,
        input.connectionId,
        event.contentHash,
        event.receivedAt,
        JSON.stringify(event.payload),
        input.connectionId,
        MAX_EVENTS_PER_CONNECTION,
      ),
      db.prepare(
        `UPDATE dropsbot_webhook_connections
        SET callback_received_at = COALESCE(callback_received_at,
          (SELECT received_at FROM dropsbot_webhook_events WHERE connection_id = ? AND content_hash = ? LIMIT 1)),
        last_event_received_at = (SELECT received_at FROM dropsbot_webhook_events WHERE connection_id = ? ORDER BY received_at DESC LIMIT 1),
        last_event_content_hash = (SELECT content_hash FROM dropsbot_webhook_events WHERE connection_id = ? ORDER BY received_at DESC LIMIT 1)
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM dropsbot_webhook_events WHERE connection_id = ? AND content_hash = ?
        )`,
      ).bind(
        input.connectionId,
        event.contentHash,
        input.connectionId,
        input.connectionId,
        input.connectionId,
        input.connectionId,
        event.contentHash,
      ),
    ]);
    const accepted = Number(inserted.meta?.changes ?? 0) > 0;
    const duplicate = accepted ? null : await db.prepare(
        "SELECT id, content_hash, received_at, payload_json FROM dropsbot_webhook_events WHERE connection_id = ? AND content_hash = ? LIMIT 1",
      ).bind(input.connectionId, event.contentHash).first<Record<string, unknown>>();
    if (!accepted && !duplicate) throw new DropsBotWebhookCapacityError();
    const stored = accepted ? event : eventFromD1Row(duplicate as Record<string, unknown>);
    return {
      status: accepted ? "accepted" : "duplicate",
      event: stored,
      callbackEvidence: await latestD1CallbackEvidence(db, input.connectionId),
    };
  }
  if (blobAvailable()) {
    const storage = await blobClient();
    return mutateBlobState(storage, (state) => acceptInState(state, mutation));
  }
  throw new DropsBotWebhookStorageUnavailableError();
}

export async function listDropsBotWebhookProject(
  ownerIdentity: string,
  projectId: string,
  storageOverride?: BlobStorage,
): Promise<DropsBotWebhookProject | null> {
  validIdentity(ownerIdentity);
  validProjectId(projectId);
  if (storageOverride) {
    const snapshot = await readBlobState(storageOverride);
    const connection = snapshot.state.connections.find((item) =>
      item.ownerIdentity === ownerIdentity && item.projectId === projectId);
    return connection ? publicProject(connection) : null;
  }
  const local = localState();
  if (local) {
    const connection = local.connections.find((item) =>
      item.ownerIdentity === ownerIdentity && item.projectId === projectId);
    return connection ? publicProject(connection) : null;
  }
  const db = await ensureDropsBotTables();
  if (db) {
    const row = await db.prepare(
      `SELECT id, owner_identity, project_id, capability_hash, created_at, consented_at,
      callback_received_at, last_event_received_at, last_event_content_hash
      FROM dropsbot_webhook_connections WHERE owner_identity = ? AND project_id = ? LIMIT 1`,
    ).bind(ownerIdentity, projectId).first<Record<string, unknown>>();
    if (!row) return null;
    const result = await db.prepare(
      `SELECT id, content_hash, received_at, payload_json FROM dropsbot_webhook_events
      WHERE connection_id = ? ORDER BY received_at DESC LIMIT ?`,
    ).bind(String(row.id), MAX_EVENTS_PER_CONNECTION).all<Record<string, unknown>>();
    const connection = connectionFromD1Row(row, (result.results ?? []).map(eventFromD1Row));
    return publicProject(connection);
  }
  if (blobAvailable()) {
    const snapshot = await readBlobState(await blobClient());
    const connection = snapshot.state.connections.find((item) =>
      item.ownerIdentity === ownerIdentity && item.projectId === projectId);
    return connection ? publicProject(connection) : null;
  }
  throw new DropsBotWebhookStorageUnavailableError();
}
