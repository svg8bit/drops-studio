import { createHash } from "node:crypto";

export interface ProjectV2ReleaseReceiptDescriptor {
  actorId: string;
  projectId: string;
  revision: number;
  contentHash: string;
  checkpointId: string;
  snapshotHash: string;
}

export interface ProjectV2ReleaseReceipt
  extends ProjectV2ReleaseReceiptDescriptor {
  schemaVersion: 1;
  verification: "sandbox-release-gate";
  verifiedAt: string;
}

type ReleaseBlobStorage = Pick<
  typeof import("@vercel/blob"),
  "get" | "put" | "list" | "del"
>;

declare global {
  var __DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__:
    | Map<string, ProjectV2ReleaseReceipt>
    | undefined;
}

export class ProjectV2ReleaseReceiptStorageUnavailableError extends Error {
  constructor(message = "Project V2 release receipt storage is temporarily unavailable.") {
    super(message);
    this.name = "ProjectV2ReleaseReceiptStorageUnavailableError";
  }
}

function validDescriptor(
  value: ProjectV2ReleaseReceiptDescriptor,
): ProjectV2ReleaseReceiptDescriptor {
  if (!/^[a-f0-9]{64}$/.test(value.actorId)) {
    throw new Error("Project V2 release receipt requires a signed actor identity.");
  }
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value.projectId)) {
    throw new Error("Project V2 release receipt project id is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error("Project V2 release receipt revision is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error("Project V2 release receipt content hash is invalid.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.checkpointId)) {
    throw new Error("Project V2 release receipt checkpoint id is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(value.snapshotHash)) {
    throw new Error("Project V2 release receipt snapshot hash is invalid.");
  }
  return { ...value };
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

function localStore(): Map<string, ProjectV2ReleaseReceipt> {
  return globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__ ??= new Map();
}

function receiptPrefix(actorId: string, projectId: string): string {
  validDescriptor({
    actorId,
    projectId,
    revision: 1,
    contentHash: "0".repeat(64),
    checkpointId: "receipt-prefix",
    snapshotHash: "0".repeat(64),
  });
  return `drops-studio/project-v2-release/${actorId}/${encodeURIComponent(projectId)}/`;
}

function receiptPath(descriptor: ProjectV2ReleaseReceiptDescriptor): string {
  const safe = validDescriptor(descriptor);
  const digest = createHash("sha256")
    .update(JSON.stringify([
      safe.actorId,
      safe.projectId,
      safe.revision,
      safe.contentHash,
      safe.checkpointId,
      safe.snapshotHash,
    ]))
    .digest("hex");
  return `${receiptPrefix(safe.actorId, safe.projectId)}${digest}.json`;
}

function matchesDescriptor(
  receipt: ProjectV2ReleaseReceipt,
  descriptor: ProjectV2ReleaseReceiptDescriptor,
): boolean {
  return receipt.actorId === descriptor.actorId
    && receipt.projectId === descriptor.projectId
    && receipt.revision === descriptor.revision
    && receipt.contentHash === descriptor.contentHash
    && receipt.checkpointId === descriptor.checkpointId
    && receipt.snapshotHash === descriptor.snapshotHash;
}

function parseReceipt(
  value: unknown,
  descriptor: ProjectV2ReleaseReceiptDescriptor,
): ProjectV2ReleaseReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as ProjectV2ReleaseReceipt;
  if (
    receipt.schemaVersion !== 1
    || receipt.verification !== "sandbox-release-gate"
    || !Number.isFinite(Date.parse(receipt.verifiedAt))
    || !matchesDescriptor(receipt, descriptor)
  ) {
    return null;
  }
  return { ...receipt };
}

async function blobClient(override?: ReleaseBlobStorage): Promise<ReleaseBlobStorage> {
  return override ?? import("@vercel/blob");
}

export function projectV2ReleaseReceiptStorageConfigured(): boolean {
  return localStoreEnabled() || durableBlobConfigured();
}

export async function writeProjectV2ReleaseReceipt(
  descriptor: ProjectV2ReleaseReceiptDescriptor,
  options: {
    verifiedAt?: string;
    storage?: ReleaseBlobStorage;
  } = {},
): Promise<ProjectV2ReleaseReceipt> {
  const safe = validDescriptor(descriptor);
  const verifiedAt = new Date(options.verifiedAt ?? Date.now()).toISOString();
  const receipt: ProjectV2ReleaseReceipt = {
    schemaVersion: 1,
    verification: "sandbox-release-gate",
    ...safe,
    verifiedAt,
  };
  const path = receiptPath(safe);
  if (!options.storage && localStoreEnabled()) {
    localStore().set(path, structuredClone(receipt));
    return receipt;
  }
  if (!options.storage && !durableBlobConfigured()) {
    throw new ProjectV2ReleaseReceiptStorageUnavailableError();
  }
  try {
    await (await blobClient(options.storage)).put(path, JSON.stringify(receipt), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
    });
    return receipt;
  } catch {
    throw new ProjectV2ReleaseReceiptStorageUnavailableError();
  }
}

export async function hasProjectV2ReleaseReceipt(
  descriptor: ProjectV2ReleaseReceiptDescriptor,
  storageOverride?: ReleaseBlobStorage,
): Promise<boolean> {
  const safe = validDescriptor(descriptor);
  const path = receiptPath(safe);
  if (!storageOverride && localStoreEnabled()) {
    const receipt = localStore().get(path);
    return Boolean(receipt && matchesDescriptor(receipt, safe));
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2ReleaseReceiptStorageUnavailableError();
  }
  try {
    const result = await (await blobClient(storageOverride)).get(path, {
      access: "private",
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return false;
    if (Number(result.blob.size ?? 0) > 4_096) return false;
    const raw = await new Response(result.stream).text();
    if (new TextEncoder().encode(raw).byteLength > 4_096) return false;
    return Boolean(parseReceipt(JSON.parse(raw) as unknown, safe));
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw new ProjectV2ReleaseReceiptStorageUnavailableError();
  }
}

export async function deleteProjectV2ReleaseReceipts(
  actorId: string,
  projectId: string,
  storageOverride?: ReleaseBlobStorage,
): Promise<void> {
  const prefix = receiptPrefix(actorId, projectId);
  if (!storageOverride && localStoreEnabled()) {
    for (const key of localStore().keys()) {
      if (key.startsWith(prefix)) localStore().delete(key);
    }
    return;
  }
  if (!storageOverride && !durableBlobConfigured()) {
    throw new ProjectV2ReleaseReceiptStorageUnavailableError();
  }
  try {
    const storage = await blobClient(storageOverride);
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = await storage.list({ prefix, limit: 1_000, cursor });
      if (page.blobs.length) {
        await storage.del(page.blobs.map((blob) => blob.pathname));
      }
      if (!page.hasMore) return;
      if (!page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    throw new Error("Project release receipt cleanup did not reach the final page.");
  } catch {
    throw new ProjectV2ReleaseReceiptStorageUnavailableError(
      "Project V2 release receipt cleanup could not be confirmed.",
    );
  }
}
