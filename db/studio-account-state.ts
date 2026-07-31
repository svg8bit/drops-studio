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

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

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
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export function studioAccountStateConfigured(): boolean {
  return localStoreEnabled() || durableBlobConfigured();
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
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > 96 * 1_024) {
    throw new StudioAccountStateUnavailableError("Studio account state exceeded its bounded size.");
  }
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

async function mutateState(
  identity: string,
  mutate: (state: StudioAccountState, now: string) => StudioAccountState,
  storageOverride?: BlobStorage,
): Promise<StudioAccountState> {
  validIdentity(identity);
  if (!storageOverride && localStoreEnabled()) {
    const now = new Date().toISOString();
    const current = structuredClone(localStore().get(identity) ?? emptyState());
    const next = mutate(current, now);
    localStore().set(identity, structuredClone(next));
    return structuredClone(next);
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
): Promise<StudioAccountState> {
  validIdentity(identity);
  if (!storageOverride && localStoreEnabled()) {
    return structuredClone(localStore().get(identity) ?? emptyState());
  }
  if (!storageOverride && !durableBlobConfigured()) throw new StudioAccountStateUnavailableError();
  return structuredClone((await readStored(identity, await blobClient(storageOverride))).state);
}

export async function saveStudioAccountProfile(
  identity: string,
  profile: Omit<StudioAccountProfile, "updatedAt">,
  storageOverride?: BlobStorage,
): Promise<StudioAccountState> {
  const checked = parseProfile({ ...profile, updatedAt: new Date().toISOString() });
  if (!checked) throw new Error("Studio account profile is invalid.");
  return mutateState(identity, (state, now) => ({
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
    profile: { ...checked, updatedAt: now },
  }), storageOverride);
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
  }), storageOverride);
}

export async function deleteStudioConnection(
  identity: string,
  provider: StudioConnectionProvider,
  storageOverride?: BlobStorage,
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
  }, storageOverride);
}

export async function readStudioConnectionSecret(
  identity: string,
  provider: StudioConnectionProvider,
  storageOverride?: BlobStorage,
): Promise<{
  credential: string;
  endpoint?: string;
  model?: string;
  endpointHost?: string;
  label?: string;
} | null> {
  const state = await readStudioAccountState(identity, storageOverride);
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
