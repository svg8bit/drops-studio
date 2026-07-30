import type { ProjectV2 } from "../lib/project-v2-types.ts";
import { validateProjectV2 } from "../lib/project-v2-validator.ts";

export const PROJECT_V2_SNAPSHOT_LIMIT_BYTES = 8_000_000;

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
  return localStoreEnabled() || durableBlobConfigured();
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

export async function readProjectV2Snapshot(
  identity: string,
  projectId: string,
  storageOverride?: BlobStorage,
): Promise<{ storageRevision: number; project: ProjectV2 } | null> {
  validIdentity(identity);
  validProjectId(projectId);
  if (!storageOverride && localStoreEnabled()) {
    const value = localStore().get(storageKey(identity, projectId));
    return value
      ? { storageRevision: value.storageRevision, project: structuredClone(value.project) }
      : null;
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
): Promise<void> {
  validIdentity(identity);
  validProjectId(projectId);
  if (!storageOverride && localStoreEnabled()) {
    localStore().delete(storageKey(identity, projectId));
    return;
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2SnapshotStorageUnavailableError();
  }
  await (await blobClient(storageOverride)).del(blobPath(identity, projectId));
}
