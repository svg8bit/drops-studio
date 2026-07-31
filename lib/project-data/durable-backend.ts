import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";
import { createHash } from "node:crypto";

import {
  ProjectDataError,
  type ProjectDataBackend,
  type ProjectDataProjectSnapshot,
} from "./types.ts";
import { validateProjectDataProjectId } from "./validation.ts";

const BLOB_PREFIX = "drops-studio/project-data/v2";
const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS drops_project_data_snapshots (
    project_key TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    store_revision BIGINT NOT NULL,
    snapshot_json TEXT,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const POSTGRES_SCHEMA_MIGRATION = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'drops_project_data_snapshots'
        AND column_name = 'snapshot_json'
        AND data_type = 'jsonb'
    ) THEN
      ALTER TABLE drops_project_data_snapshots
        ALTER COLUMN snapshot_json TYPE TEXT
        USING snapshot_json::text;
    END IF;
  END
  $$
`;

interface StoredEnvelope {
  schemaVersion: 1;
  projectId: string;
  storeRevision: number;
  deleted: boolean;
  snapshot: ProjectDataProjectSnapshot | null;
  updatedAt: string;
}

interface VersionedEnvelope {
  envelope: StoredEnvelope | null;
  etag: string | null;
}

type BlobStorage = Pick<typeof import("@vercel/blob"), "del" | "get" | "put">;

export interface ProjectDataSqlResult {
  rows: unknown[];
  rowCount: number;
}

export interface ProjectDataSqlClient {
  query(statement: string, parameters?: readonly unknown[]): Promise<ProjectDataSqlResult>;
}

function projectKey(projectId: string): string {
  return createHash("sha256").update(projectId, "utf8").digest("hex");
}

function currentRevision(envelope: StoredEnvelope | null): number {
  return envelope?.storeRevision ?? 0;
}

function conflict(revision: number): ProjectDataError {
  return new ProjectDataError(
    "conflict",
    "Project data changed concurrently. Refresh and retry.",
    { currentRevision: revision },
  );
}

function storageFailure(): ProjectDataError {
  return new ProjectDataError(
    "storage_unavailable",
    "Durable project data storage is temporarily unavailable.",
  );
}

function isBlobCompareAndSwapConflict(
  error: unknown,
  hadCurrentEtag: boolean,
): boolean {
  return error instanceof BlobPreconditionFailedError
    || (
      !hadCurrentEtag
      && error instanceof BlobError
      && /\bblob\b.*\balready exists\b/i.test(error.message)
    );
}

function snapshotShape(
  value: unknown,
  expectedProjectId: string,
): ProjectDataProjectSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storageFailure();
  }
  const snapshot = value as Partial<ProjectDataProjectSnapshot>;
  if (
    snapshot.schemaVersion !== 1
    || snapshot.projectId !== expectedProjectId
    || !Number.isSafeInteger(snapshot.storeRevision)
    || Number(snapshot.storeRevision) < 1
    || !snapshot.documents
    || typeof snapshot.documents !== "object"
    || Array.isArray(snapshot.documents)
  ) {
    throw storageFailure();
  }
  return structuredClone(snapshot as ProjectDataProjectSnapshot);
}

function envelopeShape(value: unknown, expectedProjectId: string): StoredEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storageFailure();
  }
  const envelope = value as Partial<StoredEnvelope>;
  if (
    envelope.schemaVersion !== 1
    || envelope.projectId !== expectedProjectId
    || !Number.isSafeInteger(envelope.storeRevision)
    || Number(envelope.storeRevision) < 1
    || typeof envelope.deleted !== "boolean"
    || typeof envelope.updatedAt !== "string"
  ) {
    throw storageFailure();
  }
  if (envelope.deleted) {
    if (envelope.snapshot !== null) throw storageFailure();
  } else {
    const snapshot = snapshotShape(envelope.snapshot, expectedProjectId);
    if (snapshot.storeRevision !== envelope.storeRevision) throw storageFailure();
  }
  return structuredClone(envelope as StoredEnvelope);
}

function nextEnvelope(
  projectId: string,
  snapshot: ProjectDataProjectSnapshot | null,
  storeRevision: number,
): StoredEnvelope {
  return {
    schemaVersion: 1,
    projectId,
    storeRevision,
    deleted: snapshot === null,
    snapshot: snapshot ? structuredClone(snapshot) : null,
    updatedAt: new Date().toISOString(),
  };
}

function validateWrite(
  projectIdInput: string,
  expectedStoreRevision: number,
  next: ProjectDataProjectSnapshot,
): string {
  const projectId = validateProjectDataProjectId(projectIdInput);
  if (
    !Number.isSafeInteger(expectedStoreRevision)
    || expectedStoreRevision < 0
    || next.projectId !== projectId
    || next.schemaVersion !== 1
    || next.storeRevision !== expectedStoreRevision + 1
  ) {
    throw new ProjectDataError(
      "invalid_request",
      "Project data durable write revision is invalid.",
    );
  }
  snapshotShape(next, projectId);
  return projectId;
}

export function durableProjectDataBlobConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    environment.BLOB_READ_WRITE_TOKEN?.trim()
      || (
        environment.BLOB_STORE_ID?.trim()
        && (environment.VERCEL_OIDC_TOKEN?.trim() || environment.VERCEL)
      ),
  );
}

export function durableProjectDataPostgresConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.DROPS_MANAGED_DATA_PROVIDER === "postgres"
    && Boolean(
      environment.DROPS_MANAGED_DATABASE_URL?.trim()
        || environment.DROPS_MANAGED_POSTGRES_URL?.trim(),
    );
}

export class VercelBlobProjectDataBackend implements ProjectDataBackend {
  readonly kind = "vercel-blob-private" as const;
  readonly #storage?: BlobStorage;

  constructor(storage?: BlobStorage) {
    this.#storage = storage;
  }

  async #client(): Promise<BlobStorage> {
    return this.#storage || await import("@vercel/blob");
  }

  #path(projectId: string): string {
    return `${BLOB_PREFIX}/${projectKey(projectId)}.json`;
  }

  async #readEnvelope(projectIdInput: string): Promise<VersionedEnvelope> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    try {
      const current = await (await this.#client()).get(this.#path(projectId), {
        access: "private",
        useCache: false,
      });
      if (!current) return { envelope: null, etag: null };
      if (current.statusCode !== 200) throw storageFailure();
      const parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
      return {
        envelope: envelopeShape(parsed, projectId),
        etag: current.blob.etag,
      };
    } catch (error) {
      if (error instanceof ProjectDataError) throw error;
      throw storageFailure();
    }
  }

  async read(projectId: string): Promise<ProjectDataProjectSnapshot | null> {
    const current = await this.#readEnvelope(projectId);
    return current.envelope?.deleted
      ? null
      : structuredClone(current.envelope?.snapshot ?? null);
  }

  async compareAndSwap(
    projectIdInput: string,
    expectedStoreRevision: number,
    next: ProjectDataProjectSnapshot,
  ): Promise<void> {
    const projectId = validateWrite(projectIdInput, expectedStoreRevision, next);
    const current = await this.#readEnvelope(projectId);
    if (currentRevision(current.envelope) !== expectedStoreRevision) {
      throw conflict(currentRevision(current.envelope));
    }
    try {
      await (await this.#client()).put(
        this.#path(projectId),
        JSON.stringify(nextEnvelope(projectId, next, next.storeRevision)),
        {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: Boolean(current.etag),
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ...(current.etag ? { ifMatch: current.etag } : {}),
        },
      );
    } catch (error) {
      if (isBlobCompareAndSwapConflict(error, Boolean(current.etag))) {
        const latest = await this.#readEnvelope(projectId).catch(() => ({ envelope: null }));
        throw conflict(currentRevision(latest.envelope));
      }
      throw storageFailure();
    }
  }

  async deleteProject(
    projectIdInput: string,
    expectedStoreRevision: number,
  ): Promise<void> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    const current = await this.#readEnvelope(projectId);
    if (currentRevision(current.envelope) !== expectedStoreRevision) {
      throw conflict(currentRevision(current.envelope));
    }
    if (!current.envelope || current.envelope.deleted) return;
    try {
      await (await this.#client()).put(
        this.#path(projectId),
        JSON.stringify(nextEnvelope(projectId, null, expectedStoreRevision + 1)),
        {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ...(current.etag ? { ifMatch: current.etag } : {}),
        },
      );
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        const latest = await this.#readEnvelope(projectId).catch(() => ({ envelope: null }));
        throw conflict(currentRevision(latest.envelope));
      }
      throw storageFailure();
    }
  }
}

export class PostgresProjectDataBackend implements ProjectDataBackend {
  readonly kind = "neon-postgres" as const;
  readonly #sql: ProjectDataSqlClient;
  #ready: Promise<void> | null = null;

  constructor(sql: ProjectDataSqlClient) {
    this.#sql = sql;
  }

  async #ensureSchema(): Promise<void> {
    this.#ready ??= (async () => {
      await this.#sql.query(POSTGRES_SCHEMA);
      await this.#sql.query(POSTGRES_SCHEMA_MIGRATION);
    })();
    try {
      await this.#ready;
    } catch {
      this.#ready = null;
      throw storageFailure();
    }
  }

  async #row(projectIdInput: string): Promise<StoredEnvelope | null> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    await this.#ensureSchema();
    try {
      const result = await this.#sql.query(
        `SELECT project_id, store_revision, snapshot_json, deleted, updated_at
         FROM drops_project_data_snapshots
         WHERE project_key = $1`,
        [projectKey(projectId)],
      );
      if (!result.rows.length) return null;
      const row = result.rows[0] as Record<string, unknown>;
      const storedSnapshot = typeof row.snapshot_json === "string"
        ? JSON.parse(row.snapshot_json) as unknown
        : row.snapshot_json;
      return envelopeShape({
        schemaVersion: 1,
        projectId: row.project_id,
        storeRevision: Number(row.store_revision),
        deleted: row.deleted,
        snapshot: storedSnapshot,
        updatedAt: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
      }, projectId);
    } catch (error) {
      if (error instanceof ProjectDataError) throw error;
      throw storageFailure();
    }
  }

  async read(projectId: string): Promise<ProjectDataProjectSnapshot | null> {
    const current = await this.#row(projectId);
    return current?.deleted ? null : structuredClone(current?.snapshot ?? null);
  }

  async compareAndSwap(
    projectIdInput: string,
    expectedStoreRevision: number,
    next: ProjectDataProjectSnapshot,
  ): Promise<void> {
    const projectId = validateWrite(projectIdInput, expectedStoreRevision, next);
    await this.#ensureSchema();
    try {
      const result = expectedStoreRevision === 0
        ? await this.#sql.query(
          `INSERT INTO drops_project_data_snapshots
           (project_key, project_id, store_revision, snapshot_json, deleted, updated_at)
           VALUES ($1, $2, $3, $4, FALSE, NOW())
           ON CONFLICT (project_key) DO NOTHING
           RETURNING store_revision`,
          [projectKey(projectId), projectId, next.storeRevision, JSON.stringify(next)],
        )
        : await this.#sql.query(
          `UPDATE drops_project_data_snapshots
           SET store_revision = $3, snapshot_json = $4, deleted = FALSE, updated_at = NOW()
           WHERE project_key = $1 AND project_id = $2 AND store_revision = $5
           RETURNING store_revision`,
          [
            projectKey(projectId),
            projectId,
            next.storeRevision,
            JSON.stringify(next),
            expectedStoreRevision,
          ],
        );
      if (result.rowCount !== 1) {
        throw conflict(currentRevision(await this.#row(projectId)));
      }
    } catch (error) {
      if (error instanceof ProjectDataError) throw error;
      throw storageFailure();
    }
  }

  async deleteProject(
    projectIdInput: string,
    expectedStoreRevision: number,
  ): Promise<void> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    await this.#ensureSchema();
    try {
      const result = await this.#sql.query(
        `UPDATE drops_project_data_snapshots
         SET store_revision = $3, snapshot_json = NULL, deleted = TRUE, updated_at = NOW()
         WHERE project_key = $1 AND project_id = $2 AND store_revision = $4 AND deleted = FALSE
         RETURNING store_revision`,
        [
          projectKey(projectId),
          projectId,
          expectedStoreRevision + 1,
          expectedStoreRevision,
        ],
      );
      if (result.rowCount !== 1) {
        const current = await this.#row(projectId);
        if (!current && expectedStoreRevision === 0) return;
        if (current?.deleted && current.storeRevision === expectedStoreRevision) return;
        throw conflict(currentRevision(current));
      }
    } catch (error) {
      if (error instanceof ProjectDataError) throw error;
      throw storageFailure();
    }
  }
}

export async function neonProjectDataSqlClient(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProjectDataSqlClient> {
  const connectionString = environment.DROPS_MANAGED_DATABASE_URL?.trim()
    || environment.DROPS_MANAGED_POSTGRES_URL?.trim();
  if (!connectionString) throw storageFailure();
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connectionString, { fullResults: true });
  return {
    async query(statement, parameters = []) {
      const result = await sql.query(statement, [...parameters]);
      return {
        rows: result.rows as unknown[],
        rowCount: result.rowCount ?? 0,
      };
    },
  };
}

export async function createDurableProjectDataBackend(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProjectDataBackend | null> {
  if (durableProjectDataPostgresConfigured(environment)) {
    return new PostgresProjectDataBackend(await neonProjectDataSqlClient(environment));
  }
  if (durableProjectDataBlobConfigured(environment)) {
    return new VercelBlobProjectDataBackend();
  }
  return null;
}
