import type {
  ContextCandidate,
  ContextChunk,
  ContextIndexBackend,
  ContextIndexSnapshot,
  ContextScope,
  LexicalQuery,
  StoredContextChunk,
  VectorQuery,
} from "../types.ts";
import { stableContextJson } from "../utils.ts";
import { InProcessHybridIndexBackend } from "./in-process.ts";

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;
type SnapshotCompression = "gzip" | "identity";

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export interface BlobSnapshotClient {
  put(
    pathname: string,
    body: Uint8Array,
    options: { access: "private"; addRandomSuffix: false; allowOverwrite: true; contentType: string; signal?: AbortSignal },
  ): Promise<unknown>;
  get(pathname: string, options?: { signal?: AbortSignal }): Promise<null | { statusCode: 200 | 304; stream: ReadableStream<Uint8Array> | null }>;
}

export interface BlobSnapshotBackendOptions {
  client: BlobSnapshotClient;
  scope: ContextScope;
  backend?: InProcessHybridIndexBackend;
  pathPrefix?: string;
  compression?: "auto" | SnapshotCompression;
  operationTimeoutMs?: number;
}

function safeSegment(value: string | undefined): string {
  if (value === undefined) return "~none";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Blob snapshot scope contains an invalid identifier.");
  return value.replace(/:/g, "~3a");
}

async function encodeSnapshot(snapshot: ContextIndexSnapshot, compression: SnapshotCompression): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(stableContextJson(snapshot));
  if (raw.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Context index snapshot exceeds the persistence limit.");
  if (compression === "identity") return raw;
  if (typeof CompressionStream === "undefined") throw new Error("Gzip compression is unavailable in this runtime.");
  const stream = new Blob([exactArrayBuffer(raw)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeSnapshot(bytes: Uint8Array, compression: SnapshotCompression): Promise<ContextIndexSnapshot> {
  let raw = bytes;
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if ((compression === "gzip") !== gzip) throw new Error("Context index snapshot compression does not match its storage metadata.");
  if (gzip) {
    if (typeof DecompressionStream === "undefined") throw new Error("Gzip decompression is unavailable in this runtime.");
    const stream = new Blob([exactArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
    raw = await readBoundedStream(stream);
  }
  if (raw.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Context index snapshot exceeds the load limit.");
  return JSON.parse(new TextDecoder().decode(raw)) as ContextIndexSnapshot;
}

function exactScope(scope: ContextScope | undefined, configured: ContextScope): ContextScope {
  if (!scope?.tenantId || !scope.workspaceId) throw new Error("An explicit context scope is required for Blob snapshot access.");
  for (const key of ["tenantId", "workspaceId", "projectId", "branch", "revision"] as const) {
    if (scope[key] !== configured[key]) throw new Error("Blob context backend rejected access outside its configured scope.");
  }
  return scope;
}

async function withOperationTimeout<T>(label: string, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_SNAPSHOT_BYTES) {
      await reader.cancel();
      throw new Error("Context index snapshot exceeds the load limit.");
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class BlobSnapshotHybridIndexBackend implements ContextIndexBackend {
  readonly #client: BlobSnapshotClient;
  readonly #scope: ContextScope;
  readonly #backend: InProcessHybridIndexBackend;
  readonly #pathname: string;
  readonly #compression: SnapshotCompression;
  readonly #operationTimeoutMs: number;

  constructor(options: BlobSnapshotBackendOptions) {
    this.#client = options.client;
    this.#scope = structuredClone(options.scope);
    this.#backend = options.backend ?? new InProcessHybridIndexBackend();
    this.#compression = options.compression === "identity" || options.compression === "gzip"
      ? options.compression
      : typeof CompressionStream === "undefined" ? "identity" : "gzip";
    this.#operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#operationTimeoutMs) || this.#operationTimeoutMs < 1 || this.#operationTimeoutMs > 60_000) {
      throw new Error("Blob snapshot operation timeout must be between 1 and 60000ms.");
    }
    const prefix = (options.pathPrefix ?? "private/context-index/v1").replace(/^\/+|\/+$/g, "");
    if (!prefix || prefix.split("/").some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) throw new Error("Blob context snapshot prefix is invalid.");
    this.#pathname = [
      prefix,
      safeSegment(options.scope.tenantId),
      safeSegment(options.scope.workspaceId),
      safeSegment(options.scope.projectId),
      `branch-${safeSegment(options.scope.branch)}`,
      `revision-${safeSegment(options.scope.revision)}`,
      `snapshot.json${this.#compression === "gzip" ? ".gz" : ""}`,
    ].join("/");
  }

  get pathname(): string {
    return this.#pathname;
  }

  getIndexVersion(): number {
    return this.#backend.getIndexVersion();
  }

  async upsertChunks(chunks: StoredContextChunk[]): Promise<void> {
    for (const chunk of chunks) {
      exactScope(chunk, this.#scope);
    }
    await this.#backend.upsertChunks(chunks);
  }

  async deleteSource(sourceUri: string, sourceVersion: string | undefined, scope: ContextScope): Promise<void> {
    await this.#backend.deleteSource(sourceUri, sourceVersion, exactScope(scope, this.#scope));
  }

  async lexicalSearch(query: LexicalQuery): Promise<ContextCandidate[]> {
    exactScope(query, this.#scope);
    return this.#backend.lexicalSearch(query);
  }

  async vectorSearch(query: VectorQuery): Promise<ContextCandidate[]> {
    exactScope(query, this.#scope);
    return this.#backend.vectorSearch(query);
  }

  async getChunks(chunkIds: string[], scope: ContextScope): Promise<ContextChunk[]> {
    return this.#backend.getChunks(chunkIds, exactScope(scope, this.#scope));
  }

  async getNeighbors(chunkIds: string[], radius: number, scope: ContextScope): Promise<ContextChunk[]> {
    return this.#backend.getNeighbors(chunkIds, radius, exactScope(scope, this.#scope));
  }

  async persistSnapshot(): Promise<ContextIndexSnapshot> {
    const snapshot = await this.#backend.persistScopeSnapshot(this.#scope);
    const encoded = await encodeSnapshot(snapshot, this.#compression);
    await withOperationTimeout("Blob context snapshot write", this.#operationTimeoutMs, (signal) => this.#client.put(this.#pathname, encoded, {
      access: "private", addRandomSuffix: false, allowOverwrite: true,
      contentType: this.#compression === "gzip" ? "application/gzip" : "application/json",
      signal,
    }));
    return snapshot;
  }

  loadSnapshot(snapshot: ContextIndexSnapshot): Promise<void> {
    if (!snapshot || !Array.isArray(snapshot.chunks)) throw new Error("Context index snapshot is invalid.");
    for (const chunk of snapshot.chunks) {
      exactScope(chunk, this.#scope);
    }
    return this.#backend.loadSnapshot(snapshot);
  }

  async loadPersistedSnapshot(): Promise<boolean> {
    const result = await withOperationTimeout("Blob context snapshot read", this.#operationTimeoutMs, (signal) => this.#client.get(this.#pathname, { signal }));
    if (!result || result.statusCode !== 200 || !result.stream) return false;
    const snapshot = await decodeSnapshot(await readBoundedStream(result.stream), this.#compression);
    await this.loadSnapshot(snapshot);
    return true;
  }
}
