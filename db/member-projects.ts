import {
  MEMBER_PROJECT_STORE_LIMIT_BYTES,
  sanitizeMemberProjectRecord,
  type MemberProjectDraft,
  type MemberProjectRecord,
  sanitizeMemberProjectDraft,
} from "../lib/member-project-cloud.ts";
import {
  MEMBER_PRIVATE_PROJECT_LIMIT,
  PRO_PRIVATE_PROJECT_LIMIT,
} from "../lib/billing.ts";

export const MEMBER_PROJECT_LIMIT = MEMBER_PRIVATE_PROJECT_LIMIT;
export const MEMBER_PROJECT_STORAGE_LIMIT = PRO_PRIVATE_PROJECT_LIMIT;

interface MemberProjectEnvelope {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  projects: MemberProjectRecord[];
}

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

interface StoredEnvelope {
  envelope: MemberProjectEnvelope;
  etag: string | null;
}

export type MemberProjectWriteResult =
  | { status: "saved"; project: MemberProjectRecord }
  | { status: "conflict"; current?: MemberProjectRecord }
  | { status: "limit" }
  | { status: "too-large" };

export type MemberProjectDeleteResult =
  | { status: "deleted" }
  | { status: "not-found" }
  | { status: "conflict"; current: MemberProjectRecord };

declare global {
  var __DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__: Map<string, MemberProjectEnvelope> | undefined;
}

export class MemberProjectStorageUnavailableError extends Error {
  constructor(message = "Member project storage is temporarily unavailable.") {
    super(message);
    this.name = "MemberProjectStorageUnavailableError";
  }
}

function validIdentity(identity: string): void {
  if (!/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error("Member project storage requires a signed account identity.");
  }
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

export function memberProjectStorageConfigured(): boolean {
  return localStoreEnabled() || durableBlobConfigured();
}

function emptyEnvelope(): MemberProjectEnvelope {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    projects: [],
  };
}

function parseEnvelope(value: unknown): MemberProjectEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemberProjectStorageUnavailableError("Member project storage returned an invalid envelope.");
  }
  const input = value as Partial<MemberProjectEnvelope>;
  if (
    input.schemaVersion !== 1
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 0
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
    || !Array.isArray(input.projects)
    || input.projects.length > MEMBER_PROJECT_STORAGE_LIMIT
  ) {
    throw new MemberProjectStorageUnavailableError("Member project storage returned an invalid envelope.");
  }
  try {
    return {
      schemaVersion: 1,
      revision: Number(input.revision),
      updatedAt: input.updatedAt,
      projects: input.projects.map(sanitizeMemberProjectRecord),
    };
  } catch {
    throw new MemberProjectStorageUnavailableError("Member project storage returned an invalid envelope.");
  }
}

function localStore(): Map<string, MemberProjectEnvelope> {
  return globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ ??= new Map();
}

function blobPath(identity: string): string {
  return `drops-studio/member-projects/${identity}.json`;
}

async function blobClient(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

async function readBlobEnvelope(
  identity: string,
  storage: BlobStorage,
): Promise<StoredEnvelope> {
  const current = await storage.get(blobPath(identity), {
    access: "private",
    useCache: false,
  });
  if (!current) return { envelope: emptyEnvelope(), etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) {
    throw new MemberProjectStorageUnavailableError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
  } catch {
    throw new MemberProjectStorageUnavailableError("Member project storage returned unreadable data.");
  }
  return { envelope: parseEnvelope(parsed), etag: current.blob.etag };
}

async function readBlobEnvelopeWithRetry(
  identity: string,
  storage: BlobStorage,
  attempts = 3,
): Promise<StoredEnvelope> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readBlobEnvelope(identity, storage);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof MemberProjectStorageUnavailableError
    ? lastError
    : new MemberProjectStorageUnavailableError();
}

function serializedEnvelope(envelope: MemberProjectEnvelope): string | null {
  const serialized = JSON.stringify(envelope);
  return new TextEncoder().encode(serialized).byteLength <= MEMBER_PROJECT_STORE_LIMIT_BYTES
    ? serialized
    : null;
}

async function writeBlobEnvelope(
  identity: string,
  stored: StoredEnvelope,
  envelope: MemberProjectEnvelope,
  storage: BlobStorage,
): Promise<"saved" | "retry" | "too-large"> {
  const serialized = serializedEnvelope(envelope);
  if (!serialized) return "too-large";
  try {
    await storage.put(blobPath(identity), serialized, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: Boolean(stored.etag),
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
      ...(stored.etag ? { ifMatch: stored.etag } : {}),
    });
    return "saved";
  } catch {
    return "retry";
  }
}

function nextEnvelope(
  current: MemberProjectEnvelope,
  projects: MemberProjectRecord[],
  now: string,
): MemberProjectEnvelope {
  return {
    schemaVersion: 1,
    revision: current.revision + 1,
    updatedAt: now,
    projects: [...projects].sort((left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
  };
}

function updatedRecord(
  draft: MemberProjectDraft,
  current: MemberProjectRecord | undefined,
  now: string,
): MemberProjectRecord {
  return {
    schemaVersion: 1,
    ...structuredClone(draft),
    revision: (current?.revision ?? 0) + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
}

function planUpsert(
  envelope: MemberProjectEnvelope,
  draft: MemberProjectDraft,
  expectedRevision: number,
  now: string,
  projectLimit: number,
): MemberProjectWriteResult | { status: "write"; envelope: MemberProjectEnvelope; project: MemberProjectRecord } {
  const current = envelope.projects.find((project) => project.id === draft.id);
  if (current && current.revision !== expectedRevision) {
    return { status: "conflict", current: structuredClone(current) };
  }
  if (!current && expectedRevision !== 0) {
    return { status: "conflict" };
  }
  if (!current && envelope.projects.length >= projectLimit) {
    return { status: "limit" };
  }
  const project = updatedRecord(draft, current, now);
  const projects = [project, ...envelope.projects.filter((item) => item.id !== draft.id)];
  return {
    status: "write",
    project,
    envelope: nextEnvelope(envelope, projects, now),
  };
}

export async function listMemberProjects(
  identity: string,
  storageOverride?: BlobStorage,
): Promise<MemberProjectRecord[]> {
  validIdentity(identity);
  if (!storageOverride && localStoreEnabled()) {
    return structuredClone(localStore().get(identity)?.projects ?? []);
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new MemberProjectStorageUnavailableError();
  }
  const storage = await blobClient(storageOverride);
  return structuredClone((await readBlobEnvelopeWithRetry(identity, storage)).envelope.projects);
}

export async function upsertMemberProject(
  identity: string,
  value: unknown,
  expectedRevision: number,
  storageOverride?: BlobStorage,
  projectLimit = MEMBER_PROJECT_LIMIT,
): Promise<MemberProjectWriteResult> {
  validIdentity(identity);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Expected project revision must be a non-negative integer.");
  }
  if (
    !Number.isSafeInteger(projectLimit)
    || (projectLimit !== MEMBER_PROJECT_LIMIT
      && projectLimit !== MEMBER_PROJECT_STORAGE_LIMIT)
  ) {
    throw new Error("Member project limit is outside the supported billing entitlement range.");
  }
  const draft = sanitizeMemberProjectDraft(value);

  if (!storageOverride && localStoreEnabled()) {
    const store = localStore();
    const current = store.get(identity) ?? emptyEnvelope();
    const planned = planUpsert(
      current,
      draft,
      expectedRevision,
      new Date().toISOString(),
      projectLimit,
    );
    if (planned.status !== "write") return planned;
    if (!serializedEnvelope(planned.envelope)) return { status: "too-large" };
    store.set(identity, structuredClone(planned.envelope));
    return { status: "saved", project: structuredClone(planned.project) };
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new MemberProjectStorageUnavailableError();
  }

  const storage = await blobClient(storageOverride);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let current: StoredEnvelope;
    try {
      current = await readBlobEnvelope(identity, storage);
    } catch {
      continue;
    }
    const planned = planUpsert(
      current.envelope,
      draft,
      expectedRevision,
      new Date().toISOString(),
      projectLimit,
    );
    if (planned.status !== "write") return planned;
    const written = await writeBlobEnvelope(identity, current, planned.envelope, storage);
    if (written === "saved") {
      return { status: "saved", project: structuredClone(planned.project) };
    }
    if (written === "too-large") return { status: "too-large" };
  }
  throw new MemberProjectStorageUnavailableError("Member project storage stayed busy after several safe retries.");
}

function planDelete(
  envelope: MemberProjectEnvelope,
  id: string,
  expectedRevision: number,
  now: string,
): MemberProjectDeleteResult | { status: "write"; envelope: MemberProjectEnvelope } {
  const current = envelope.projects.find((project) => project.id === id);
  if (!current) return { status: "not-found" };
  if (current.revision !== expectedRevision) {
    return { status: "conflict", current: structuredClone(current) };
  }
  return {
    status: "write",
    envelope: nextEnvelope(
      envelope,
      envelope.projects.filter((project) => project.id !== id),
      now,
    ),
  };
}

export async function deleteMemberProject(
  identity: string,
  id: string,
  expectedRevision: number,
  storageOverride?: BlobStorage,
): Promise<MemberProjectDeleteResult> {
  validIdentity(identity);
  if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(id)) {
    throw new Error("Project id is invalid.");
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error("Expected project revision must be a positive integer.");
  }

  if (!storageOverride && localStoreEnabled()) {
    const store = localStore();
    const current = store.get(identity) ?? emptyEnvelope();
    const planned = planDelete(current, id, expectedRevision, new Date().toISOString());
    if (planned.status !== "write") return planned;
    store.set(identity, structuredClone(planned.envelope));
    return { status: "deleted" };
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new MemberProjectStorageUnavailableError();
  }

  const storage = await blobClient(storageOverride);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let current: StoredEnvelope;
    try {
      current = await readBlobEnvelope(identity, storage);
    } catch {
      continue;
    }
    const planned = planDelete(
      current.envelope,
      id,
      expectedRevision,
      new Date().toISOString(),
    );
    if (planned.status !== "write") return planned;
    const written = await writeBlobEnvelope(identity, current, planned.envelope, storage);
    if (written === "saved") return { status: "deleted" };
    if (written === "too-large") throw new MemberProjectStorageUnavailableError();
  }
  throw new MemberProjectStorageUnavailableError("Member project storage stayed busy after several safe retries.");
}
