import type { ProjectV2 } from "../lib/project-v2-types.ts";
import { validateProjectV2 } from "../lib/project-v2-validator.ts";
import {
  durableProjectDataPostgresConfigured,
  neonProjectDataSqlClient,
  type ProjectDataSqlClient,
} from "../lib/project-data/durable-backend.ts";

export const PROJECT_V2_SNAPSHOT_LIMIT_BYTES = 8_000_000;
const PROJECT_V2_POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS drops_project_v2_snapshots (
    actor_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    storage_revision BIGINT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (actor_id, project_id)
  )
`;

interface ProjectV2SnapshotEnvelope {
  schemaVersion: 2;
  storageRevision: number;
  updatedAt: string;
  project: ProjectV2;
}

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put" | "del">;

export type ProjectV2SnapshotWriteResult =
  | { status: "saved"; storageRevision: number; project: ProjectV2 }
  | { status: "conflict"; storageRevision: number; project: ProjectV2 }
  | { status: "too-large" };

declare global {
  var __DROPS_STUDIO_LOCAL_PROJECT_V2__: Map<string, ProjectV2SnapshotEnvelope> | undefined;
}

let projectV2SqlClientPromise: Promise<ProjectDataSqlClient> | null = null;
let projectV2SqlSchemaPromise: Promise<void> | null = null;

export class ProjectV2SnapshotStorageUnavailableError extends Error {
  constructor(message = "Project V2 snapshot storage is temporarily unavailable.") {
    super(message);
    this.name = "ProjectV2SnapshotStorageUnavailableError";
  }
}

function validIdentity(identity: string): void {
  if (!/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error("Project V2 storage requires a signed member identity.");
  }
}

function validProjectId(projectId: string): void {
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(projectId)) {
    throw new Error("Project V2 id is invalid.");
  }
}

function localStoreEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function durableBlobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)),
  );
}

export function projectV2SnapshotStorageConfigured(): boolean {
  return (
    localStoreEnabled()
    || durableProjectDataPostgresConfigured()
    || durableBlobConfigured()
  );
}

function localStore(): Map<string, ProjectV2SnapshotEnvelope> {
  return globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__ ??= new Map();
}

function storageKey(identity: string, projectId: string): string {
  return `${identity}:${projectId}`;
}

function blobPath(identity: string, projectId: string): string {
  return `drops-studio/project-v2/${identity}/${encodeURIComponent(projectId)}.json`;
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function parseEnvelope(value: unknown): Promise<ProjectV2SnapshotEnvelope> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectV2SnapshotStorageUnavailableError("Project V2 storage returned an invalid snapshot.");
  }
  const input = value as Partial<ProjectV2SnapshotEnvelope>;
  if (
    input.schemaVersion !== 2
    || !Number.isSafeInteger(input.storageRevision)
    || Number(input.storageRevision) < 1
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
  ) {
    throw new ProjectV2SnapshotStorageUnavailableError("Project V2 storage returned invalid metadata.");
  }
  try {
    return {
      schemaVersion: 2,
      storageRevision: Number(input.storageRevision),
      updatedAt: input.updatedAt,
      project: await validateProjectV2(input.project),
    };
  } catch (error) {
    if (error instanceof ProjectV2SnapshotStorageUnavailableError) throw error;
    throw new ProjectV2SnapshotStorageUnavailableError("Project V2 storage failed its integrity check.");
  }
}

async function blobClient(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

async function readBlob(
  identity: string,
  projectId: string,
  storage: BlobStorage,
): Promise<{ envelope: ProjectV2SnapshotEnvelope | null; etag: string | null }> {
  const current = await storage.get(blobPath(identity, projectId), {
    access: "private",
    useCache: false,
  });
  if (!current) return { envelope: null, etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
  const raw = await new Response(current.stream).text();
  if (encodedBytes(raw) > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) {
    throw new ProjectV2SnapshotStorageUnavailableError("Project V2 snapshot exceeds the storage limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new ProjectV2SnapshotStorageUnavailableError("Project V2 snapshot is unreadable.");
  }
  return { envelope: await parseEnvelope(value), etag: current.blob.etag };
}

async function projectV2SqlClient(
  override?: ProjectDataSqlClient,
): Promise<ProjectDataSqlClient> {
  if (override) return override;
  projectV2SqlClientPromise ??= neonProjectDataSqlClient();
  return projectV2SqlClientPromise;
}

async function ensureProjectV2SqlSchema(
  client: ProjectDataSqlClient,
  override?: ProjectDataSqlClient,
): Promise<void> {
  if (override) {
    await client.query(PROJECT_V2_POSTGRES_SCHEMA);
    return;
  }
  projectV2SqlSchemaPromise ??= client
    .query(PROJECT_V2_POSTGRES_SCHEMA)
    .then(() => undefined);
  try {
    await projectV2SqlSchemaPromise;
  } catch {
    projectV2SqlSchemaPromise = null;
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
}

async function readPostgres(
  identity: string,
  projectId: string,
  sqlOverride?: ProjectDataSqlClient,
): Promise<ProjectV2SnapshotEnvelope | null> {
  try {
    const client = await projectV2SqlClient(sqlOverride);
    await ensureProjectV2SqlSchema(client, sqlOverride);
    const result = await client.query(
      `SELECT storage_revision, snapshot_json, updated_at
       FROM drops_project_v2_snapshots
       WHERE actor_id = $1 AND project_id = $2`,
      [identity, projectId],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0] as Record<string, unknown>;
    const value =
      typeof row.snapshot_json === "string"
        ? JSON.parse(row.snapshot_json) as unknown
        : row.snapshot_json;
    const envelope = await parseEnvelope(value);
    if (
      envelope.storageRevision !== Number(row.storage_revision)
      || envelope.project.id !== projectId
    ) {
      throw new ProjectV2SnapshotStorageUnavailableError(
        "Project V2 database snapshot failed its integrity check.",
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof ProjectV2SnapshotStorageUnavailableError) throw error;
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
}

async function insertPostgresEnvelope(
  identity: string,
  projectId: string,
  envelope: ProjectV2SnapshotEnvelope,
  sqlOverride?: ProjectDataSqlClient,
): Promise<boolean> {
  const serialized = JSON.stringify(envelope);
  if (encodedBytes(serialized) > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) return false;
  try {
    const client = await projectV2SqlClient(sqlOverride);
    await ensureProjectV2SqlSchema(client, sqlOverride);
    const result = await client.query(
      `INSERT INTO drops_project_v2_snapshots
       (actor_id, project_id, storage_revision, snapshot_json, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (actor_id, project_id) DO NOTHING
       RETURNING storage_revision`,
      [identity, projectId, envelope.storageRevision, serialized],
    );
    return result.rowCount === 1;
  } catch {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
}

async function writePostgres(
  identity: string,
  project: ProjectV2,
  expectedStorageRevision: number,
  sqlOverride?: ProjectDataSqlClient,
): Promise<ProjectV2SnapshotWriteResult> {
  const envelope: ProjectV2SnapshotEnvelope = {
    schemaVersion: 2,
    storageRevision: expectedStorageRevision + 1,
    updatedAt: new Date().toISOString(),
    project,
  };
  const serialized = JSON.stringify(envelope);
  if (encodedBytes(serialized) > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) {
    return { status: "too-large" };
  }
  try {
    const client = await projectV2SqlClient(sqlOverride);
    await ensureProjectV2SqlSchema(client, sqlOverride);
    const result = expectedStorageRevision === 0
      ? await client.query(
        `INSERT INTO drops_project_v2_snapshots
         (actor_id, project_id, storage_revision, snapshot_json, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (actor_id, project_id) DO NOTHING
         RETURNING storage_revision`,
        [identity, project.id, envelope.storageRevision, serialized],
      )
      : await client.query(
        `UPDATE drops_project_v2_snapshots
         SET storage_revision = $3, snapshot_json = $4, updated_at = NOW()
         WHERE actor_id = $1 AND project_id = $2 AND storage_revision = $5
         RETURNING storage_revision`,
        [
          identity,
          project.id,
          envelope.storageRevision,
          serialized,
          expectedStorageRevision,
        ],
      );
    if (result.rowCount === 1) {
      return {
        status: "saved",
        storageRevision: envelope.storageRevision,
        project: structuredClone(project),
      };
    }
    const current = await readPostgres(identity, project.id, sqlOverride);
    return current
      ? {
          status: "conflict",
          storageRevision: current.storageRevision,
          project: structuredClone(current.project),
        }
      : {
          status: "conflict",
          storageRevision: 0,
          project: structuredClone(project),
        };
  } catch (error) {
    if (error instanceof ProjectV2SnapshotStorageUnavailableError) throw error;
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
}

async function deletePostgres(
  identity: string,
  projectId: string,
  sqlOverride?: ProjectDataSqlClient,
): Promise<void> {
  try {
    const client = await projectV2SqlClient(sqlOverride);
    await ensureProjectV2SqlSchema(client, sqlOverride);
    await client.query(
      `DELETE FROM drops_project_v2_snapshots
       WHERE actor_id = $1 AND project_id = $2`,
      [identity, projectId],
    );
  } catch {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
}

async function migrateBlobSnapshotToPostgres(
  identity: string,
  projectId: string,
  storage: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<ProjectV2SnapshotEnvelope | null> {
  const legacy = await readBlob(identity, projectId, storage);
  if (!legacy.envelope) return null;
  const inserted = await insertPostgresEnvelope(
    identity,
    projectId,
    legacy.envelope,
    sqlOverride,
  );
  return inserted
    ? legacy.envelope
    : readPostgres(identity, projectId, sqlOverride);
}

export async function readProjectV2Snapshot(
  identity: string,
  projectId: string,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<{ storageRevision: number; project: ProjectV2 } | null> {
  validIdentity(identity);
  validProjectId(projectId);
  if (!storageOverride && localStoreEnabled()) {
    const value = localStore().get(storageKey(identity, projectId));
    return value
      ? { storageRevision: value.storageRevision, project: structuredClone(value.project) }
      : null;
  }
  if (
    sqlOverride
    || (!storageOverride && durableProjectDataPostgresConfigured())
  ) {
    const current = await readPostgres(identity, projectId, sqlOverride);
    if (current) {
      return {
        storageRevision: current.storageRevision,
        project: structuredClone(current.project),
      };
    }
    if (!storageOverride && durableBlobConfigured()) {
      const migrated = await migrateBlobSnapshotToPostgres(
        identity,
        projectId,
        await blobClient(),
        sqlOverride,
      );
      return migrated
        ? {
            storageRevision: migrated.storageRevision,
            project: structuredClone(migrated.project),
          }
        : null;
    }
    return null;
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
  const current = await readBlob(identity, projectId, await blobClient(storageOverride));
  return current.envelope
    ? {
        storageRevision: current.envelope.storageRevision,
        project: structuredClone(current.envelope.project),
      }
    : null;
}

export async function writeProjectV2Snapshot(
  identity: string,
  value: unknown,
  expectedStorageRevision: number,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<ProjectV2SnapshotWriteResult> {
  validIdentity(identity);
  if (!Number.isSafeInteger(expectedStorageRevision) || expectedStorageRevision < 0) {
    throw new Error("Expected Project V2 storage revision must be non-negative.");
  }
  const project = await validateProjectV2(value);
  validProjectId(project.id);
  const createEnvelope = (storageRevision: number): ProjectV2SnapshotEnvelope => ({
    schemaVersion: 2,
    storageRevision,
    updatedAt: new Date().toISOString(),
    project,
  });

  if (!storageOverride && localStoreEnabled()) {
    const key = storageKey(identity, project.id);
    const current = localStore().get(key);
    const currentRevision = current?.storageRevision ?? 0;
    if (currentRevision !== expectedStorageRevision) {
      return {
        status: "conflict",
        storageRevision: currentRevision,
        project: structuredClone(current?.project ?? project),
      };
    }
    const envelope = createEnvelope(currentRevision + 1);
    const serialized = JSON.stringify(envelope);
    if (encodedBytes(serialized) > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) return { status: "too-large" };
    localStore().set(key, structuredClone(envelope));
    return {
      status: "saved",
      storageRevision: envelope.storageRevision,
      project: structuredClone(project),
    };
  }
  if (
    sqlOverride
    || (!storageOverride && durableProjectDataPostgresConfigured())
  ) {
    if (expectedStorageRevision > 0 && !await readPostgres(identity, project.id, sqlOverride)) {
      if (!storageOverride && durableBlobConfigured()) {
        await migrateBlobSnapshotToPostgres(
          identity,
          project.id,
          await blobClient(),
          sqlOverride,
        );
      }
    }
    return writePostgres(
      identity,
      project,
      expectedStorageRevision,
      sqlOverride,
    );
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }

  const storage = await blobClient(storageOverride);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await readBlob(identity, project.id, storage);
    const currentRevision = current.envelope?.storageRevision ?? 0;
    if (currentRevision !== expectedStorageRevision) {
      return current.envelope
        ? {
            status: "conflict",
            storageRevision: currentRevision,
            project: structuredClone(current.envelope.project),
          }
        : { status: "conflict", storageRevision: 0, project: structuredClone(project) };
    }
    const envelope = createEnvelope(currentRevision + 1);
    const serialized = JSON.stringify(envelope);
    if (encodedBytes(serialized) > PROJECT_V2_SNAPSHOT_LIMIT_BYTES) return { status: "too-large" };
    try {
      await storage.put(blobPath(identity, project.id), serialized, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(current.etag),
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
        ...(current.etag ? { ifMatch: current.etag } : {}),
      });
      return {
        status: "saved",
        storageRevision: envelope.storageRevision,
        project: structuredClone(project),
      };
    } catch {
      if (attempt === 5) throw new ProjectV2SnapshotStorageUnavailableError();
    }
  }
  throw new ProjectV2SnapshotStorageUnavailableError();
}

export async function deleteProjectV2Snapshot(
  identity: string,
  projectId: string,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<void> {
  validIdentity(identity);
  validProjectId(projectId);
  if (!storageOverride && localStoreEnabled()) {
    localStore().delete(storageKey(identity, projectId));
    return;
  }
  if (
    sqlOverride
    || (!storageOverride && durableProjectDataPostgresConfigured())
  ) {
    await deletePostgres(identity, projectId, sqlOverride);
    if (!storageOverride && durableBlobConfigured()) {
      await (await blobClient()).del(blobPath(identity, projectId));
    }
    return;
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
  await (await blobClient(storageOverride)).del(blobPath(identity, projectId));
}
