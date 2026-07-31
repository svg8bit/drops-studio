import type {
  EncryptedStudioConnection,
  StudioAccountProfile,
  StudioAccountState,
  StudioConnectionProvider,
} from "../lib/studio-account-state.ts";
import {
  decryptStudioConnection,
  encryptStudioConnection,
  isStudioConnectionProvider,
} from "../lib/studio-account-state.ts";
import {
  durableProjectDataPostgresConfigured,
  neonProjectDataSqlClient,
  type ProjectDataSqlClient,
} from "../lib/project-data/durable-backend.ts";

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

const ACCOUNT_STATE_POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS drops_studio_account_states (
    account_identity TEXT PRIMARY KEY,
    state_revision BIGINT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT drops_studio_account_identity_shape
      CHECK (account_identity ~ '^[a-f0-9]{64}$'),
    CONSTRAINT drops_studio_account_state_size
      CHECK (octet_length(state_json) <= 98304)
  )
`;
const ACCOUNT_STATE_LIMIT_BYTES = 96 * 1_024;

let accountStateSqlClientPromise: Promise<ProjectDataSqlClient> | null = null;
let accountStateSqlSchemaPromise: Promise<void> | null = null;

interface StoredState {
  state: StudioAccountState;
  etag: string | null;
}

declare global {
  var __DROPS_STUDIO_LOCAL_ACCOUNT_STATE__: Map<string, StudioAccountState> | undefined;
}

export class StudioAccountStateUnavailableError extends Error {
  constructor(message = "Studio account storage is temporarily unavailable.") {
    super(message);
    this.name = "StudioAccountStateUnavailableError";
  }
}

function validIdentity(identity: string): void {
  if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error("A signed Studio account is required.");
}

function localStoreEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function durableBlobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (
        process.env.BLOB_STORE_ID
        && (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)
      ),
  );
}

export function studioAccountStateConfigured(): boolean {
  return (
    localStoreEnabled()
    || durableProjectDataPostgresConfigured()
    || durableBlobConfigured()
  );
}

function emptyState(): StudioAccountState {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    connections: {},
  };
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n\0]/.test(normalized)) return undefined;
  return normalized;
}

function parseProfile(value: unknown): StudioAccountProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Partial<StudioAccountProfile>;
  if (
    (input.provider !== "google" && input.provider !== "openrouter")
    || typeof input.subject !== "string"
    || !/^[a-z0-9][a-z0-9:_-]{5,199}$/i.test(input.subject)
    || !safeText(input.name, 160)
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
  ) return undefined;
  return {
    provider: input.provider,
    subject: input.subject,
    name: safeText(input.name, 160)!,
    ...(safeText(input.email, 320) ? { email: safeText(input.email, 320) } : {}),
    ...(safeUrl(input.picture) ? { picture: safeUrl(input.picture) } : {}),
    updatedAt: input.updatedAt,
  };
}

function parseConnection(value: unknown, provider: StudioConnectionProvider): EncryptedStudioConnection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Partial<EncryptedStudioConnection>;
  if (
    input.provider !== provider
    || input.algorithm !== "aes-256-gcm"
    || typeof input.iv !== "string"
    || !/^[A-Za-z0-9_-]{16,32}$/.test(input.iv)
    || typeof input.authTag !== "string"
    || !/^[A-Za-z0-9_-]{16,32}$/.test(input.authTag)
    || typeof input.ciphertext !== "string"
    || input.ciphertext.length < 2
    || input.ciphertext.length > 48_000
    || !/^[A-Za-z0-9_-]+$/.test(input.ciphertext)
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
  ) return undefined;
  return {
    provider,
    algorithm: "aes-256-gcm",
    iv: input.iv,
    ciphertext: input.ciphertext,
    authTag: input.authTag,
    ...(safeText(input.model, 240) ? { model: safeText(input.model, 240) } : {}),
    ...(safeText(input.endpointHost, 320) ? { endpointHost: safeText(input.endpointHost, 320) } : {}),
    ...(safeText(input.label, 160) ? { label: safeText(input.label, 160) } : {}),
    updatedAt: input.updatedAt,
  };
}

function parseState(value: unknown): StudioAccountState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioAccountStateUnavailableError("Studio account storage returned invalid data.");
  }
  const input = value as Partial<StudioAccountState>;
  if (
    input.schemaVersion !== 1
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 0
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
    || !input.connections
    || typeof input.connections !== "object"
    || Array.isArray(input.connections)
  ) throw new StudioAccountStateUnavailableError("Studio account storage returned invalid data.");
  const connections: StudioAccountState["connections"] = {};
  for (const [provider, connection] of Object.entries(input.connections)) {
    if (!isStudioConnectionProvider(provider)) continue;
    const parsed = parseConnection(connection, provider);
    if (parsed) connections[provider] = parsed;
  }
  return {
    schemaVersion: 1,
    revision: Number(input.revision),
    updatedAt: input.updatedAt,
    ...(parseProfile(input.profile) ? { profile: parseProfile(input.profile) } : {}),
    connections,
  };
}

function localStore(): Map<string, StudioAccountState> {
  return globalThis.__DROPS_STUDIO_LOCAL_ACCOUNT_STATE__ ??= new Map();
}

function blobPath(identity: string): string {
  return `drops-studio/accounts/${identity}.json`;
}

async function blobClient(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

async function postgresClient(
  override?: ProjectDataSqlClient,
): Promise<ProjectDataSqlClient> {
  if (override) return override;
  accountStateSqlClientPromise ??= neonProjectDataSqlClient().catch((error) => {
    accountStateSqlClientPromise = null;
    throw error;
  });
  return accountStateSqlClientPromise;
}

async function ensurePostgresSchema(
  client: ProjectDataSqlClient,
  override?: ProjectDataSqlClient,
): Promise<void> {
  if (override) {
    await client.query(ACCOUNT_STATE_POSTGRES_SCHEMA);
    return;
  }
  accountStateSqlSchemaPromise ??= client
    .query(ACCOUNT_STATE_POSTGRES_SCHEMA)
    .then(() => undefined);
  try {
    await accountStateSqlSchemaPromise;
  } catch {
    accountStateSqlSchemaPromise = null;
    throw new StudioAccountStateUnavailableError();
  }
}

function serializedState(state: StudioAccountState): string {
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > ACCOUNT_STATE_LIMIT_BYTES) {
    throw new StudioAccountStateUnavailableError(
      "Studio account state exceeded its bounded size.",
    );
  }
  return serialized;
}

async function readPostgres(
  identity: string,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState | null> {
  try {
    const client = await postgresClient(sqlOverride);
    await ensurePostgresSchema(client, sqlOverride);
    const result = await client.query(
      `SELECT state_revision, state_json
       FROM drops_studio_account_states
       WHERE account_identity = $1`,
      [identity],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0] as Record<string, unknown>;
    const value = typeof row.state_json === "string"
      ? JSON.parse(row.state_json) as unknown
      : row.state_json;
    const state = parseState(value);
    if (state.revision !== Number(row.state_revision)) {
      throw new StudioAccountStateUnavailableError(
        "Studio account database state failed its integrity check.",
      );
    }
    return state;
  } catch (error) {
    if (error instanceof StudioAccountStateUnavailableError) throw error;
    throw new StudioAccountStateUnavailableError();
  }
}

async function writePostgres(
  identity: string,
  expectedRevision: number,
  state: StudioAccountState,
  sqlOverride?: ProjectDataSqlClient,
): Promise<boolean> {
  const serialized = serializedState(state);
  try {
    const client = await postgresClient(sqlOverride);
    await ensurePostgresSchema(client, sqlOverride);
    const result = expectedRevision === 0
      ? await client.query(
        `INSERT INTO drops_studio_account_states
         (account_identity, state_revision, state_json, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (account_identity) DO NOTHING
         RETURNING state_revision`,
        [identity, state.revision, serialized],
      )
      : await client.query(
        `UPDATE drops_studio_account_states
         SET state_revision = $2, state_json = $3, updated_at = NOW()
         WHERE account_identity = $1 AND state_revision = $4
         RETURNING state_revision`,
        [identity, state.revision, serialized, expectedRevision],
      );
    return result.rowCount === 1;
  } catch (error) {
    if (error instanceof StudioAccountStateUnavailableError) throw error;
    throw new StudioAccountStateUnavailableError();
  }
}

async function readStored(identity: string, storage: BlobStorage): Promise<StoredState> {
  const current = await storage.get(blobPath(identity), {
    access: "private",
    useCache: false,
  });
  if (!current) return { state: emptyState(), etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) {
    throw new StudioAccountStateUnavailableError();
  }
  try {
    return {
      state: parseState(JSON.parse(await new Response(current.stream).text()) as unknown),
      etag: current.blob.etag,
    };
  } catch (error) {
    if (error instanceof StudioAccountStateUnavailableError) throw error;
    throw new StudioAccountStateUnavailableError("Studio account storage returned unreadable data.");
  }
}

async function writeStored(
  identity: string,
  stored: StoredState,
  state: StudioAccountState,
  storage: BlobStorage,
): Promise<boolean> {
  const serialized = serializedState(state);
  try {
    await storage.put(blobPath(identity), serialized, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: Boolean(stored.etag),
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
      ...(stored.etag ? { ifMatch: stored.etag } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

async function migrateBlobStateToPostgres(
  identity: string,
  storage: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState | null> {
  // A failed legacy read cannot be treated as an empty account. Doing so would
  // create a new Postgres row and permanently block migration of the existing
  // encrypted provider envelope after Blob recovers.
  const legacy = await readStored(identity, storage);
  if (legacy.state.revision === 0) return null;
  if (await writePostgres(identity, 0, legacy.state, sqlOverride)) {
    return legacy.state;
  }
  return readPostgres(identity, sqlOverride);
}

async function readPostgresWithBlobMigration(
  identity: string,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  const current = await readPostgres(identity, sqlOverride);
  if (current) return current;
  const legacyStorage = storageOverride
    ? storageOverride
    : durableBlobConfigured()
      ? await blobClient()
      : null;
  if (!legacyStorage) return emptyState();
  return (await migrateBlobStateToPostgres(identity, legacyStorage, sqlOverride))
    ?? emptyState();
}

async function mutateState(
  identity: string,
  mutate: (state: StudioAccountState, now: string) => StudioAccountState,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  validIdentity(identity);
  if (!storageOverride && !sqlOverride && localStoreEnabled()) {
    const now = new Date().toISOString();
    const current = structuredClone(localStore().get(identity) ?? emptyState());
    const next = mutate(current, now);
    localStore().set(identity, structuredClone(next));
    return structuredClone(next);
  }
  if (
    sqlOverride
    || (!storageOverride && durableProjectDataPostgresConfigured())
  ) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = await readPostgresWithBlobMigration(
        identity,
        storageOverride,
        sqlOverride,
      );
      const next = mutate(current, new Date().toISOString());
      if (await writePostgres(identity, current.revision, next, sqlOverride)) {
        return structuredClone(next);
      }
    }
    throw new StudioAccountStateUnavailableError(
      "Studio account database stayed busy after safe retries.",
    );
  }
  if (!storageOverride && !durableBlobConfigured()) throw new StudioAccountStateUnavailableError();
  const storage = await blobClient(storageOverride);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const stored = await readStored(identity, storage);
    const next = mutate(stored.state, new Date().toISOString());
    if (await writeStored(identity, stored, next, storage)) return structuredClone(next);
  }
  throw new StudioAccountStateUnavailableError("Studio account storage stayed busy after safe retries.");
}

export async function readStudioAccountState(
  identity: string,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  validIdentity(identity);
  if (!storageOverride && !sqlOverride && localStoreEnabled()) {
    return structuredClone(localStore().get(identity) ?? emptyState());
  }
  if (
    sqlOverride
    || (!storageOverride && durableProjectDataPostgresConfigured())
  ) {
    return structuredClone(await readPostgresWithBlobMigration(
      identity,
      storageOverride,
      sqlOverride,
    ));
  }
  if (!storageOverride && !durableBlobConfigured()) throw new StudioAccountStateUnavailableError();
  return structuredClone((await readStored(identity, await blobClient(storageOverride))).state);
}

export async function saveStudioAccountProfile(
  identity: string,
  profile: Omit<StudioAccountProfile, "updatedAt">,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  const checked = parseProfile({ ...profile, updatedAt: new Date().toISOString() });
  if (!checked) throw new Error("Studio account profile is invalid.");
  return mutateState(identity, (state, now) => ({
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
    profile: { ...checked, updatedAt: now },
  }), storageOverride, sqlOverride);
}

export async function saveStudioConnection(
  identity: string,
  input: {
    provider: StudioConnectionProvider;
    credential: string;
    model?: string;
    endpoint?: string;
    label?: string;
  },
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  const endpoint = input.endpoint ? safeUrl(input.endpoint) : undefined;
  if (input.endpoint && !endpoint) {
    throw new Error("Connection endpoint must be a credential-free HTTPS URL.");
  }
  const encryptedPayload = JSON.stringify({
    version: 1,
    credential: input.credential,
    ...(endpoint ? { endpoint } : {}),
  });
  return mutateState(identity, (state, now) => ({
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
    connections: {
      ...state.connections,
      [input.provider]: encryptStudioConnection({
        identity,
        provider: input.provider,
        credential: encryptedPayload,
        model: input.model,
        endpoint,
        label: input.label,
        now,
      }),
    },
  }), storageOverride, sqlOverride);
}

export async function deleteStudioConnection(
  identity: string,
  provider: StudioConnectionProvider,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<StudioAccountState> {
  return mutateState(identity, (state, now) => {
    const connections = { ...state.connections };
    delete connections[provider];
    return {
      ...state,
      revision: state.revision + 1,
      updatedAt: now,
      connections,
    };
  }, storageOverride, sqlOverride);
}

export async function readStudioConnectionSecret(
  identity: string,
  provider: StudioConnectionProvider,
  storageOverride?: BlobStorage,
  sqlOverride?: ProjectDataSqlClient,
): Promise<{
  credential: string;
  endpoint?: string;
  model?: string;
  endpointHost?: string;
  label?: string;
} | null> {
  const state = await readStudioAccountState(identity, storageOverride, sqlOverride);
  const connection = state.connections[provider];
  if (!connection) return null;
  const decrypted = decryptStudioConnection({ identity, connection });
  let credential = decrypted;
  let endpoint: string | undefined;
  try {
    const payload = JSON.parse(decrypted) as {
      version?: unknown;
      credential?: unknown;
      endpoint?: unknown;
    };
    if (payload.version === 1 && typeof payload.credential === "string") {
      credential = payload.credential;
      endpoint = safeUrl(payload.endpoint);
    }
  } catch {
    // Backward compatibility for credentials encrypted before the v1 envelope.
  }
  return {
    credential,
    ...(endpoint ? { endpoint } : {}),
    ...(connection.model ? { model: connection.model } : {}),
    ...(connection.endpointHost ? { endpointHost: connection.endpointHost } : {}),
    ...(connection.label ? { label: connection.label } : {}),
  };
}
