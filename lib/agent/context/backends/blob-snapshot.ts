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

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export interface BlobSnapshotClient {
  put(
    pathname: string,
    body: Uint8Array,
    options: { access: "private"; addRandomSuffix: false; allowOverwrite: true; contentType: string },
  ): Promise<unknown>;
  get(pathname: string): Promise<null | { statusCode: 200 | 304; stream: ReadableStream<Uint8Array> | null }>;
}

export interface BlobSnapshotBackendOptions {
  client: BlobSnapshotClient;
  scope: ContextScope;
  backend?: InProcessHybridIndexBackend;
  pathPrefix?: string;
}

function safeSegment(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Blob snapshot scope contains an invalid identifier.");
  return value.replace(/:/g, "-");
}

async function encodeSnapshot(snapshot: ContextIndexSnapshot): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(stableContextJson(snapshot));
  if (raw.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Context index snapshot exceeds the persistence limit.");
  if (typeof CompressionStream === "undefined") return raw;
  const stream = new Blob([exactArrayBuffer(raw)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeSnapshot(bytes: Uint8Array): Promise<ContextIndexSnapshot> {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("Gzip decompression is unavailable in this runtime.");
    const stream = new Blob([exactArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
    raw = await readBoundedStream(stream);
  }
  if (raw.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Context index snapshot exceeds the load limit.");
  return JSON.parse(new TextDecoder().decode(raw)) as ContextIndexSnapshot;
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

  constructor(options: BlobSnapshotBackendOptions) {
    this.#client = options.client;
    this.#scope = structuredClone(options.scope);
    this.#backend = options.backend ?? new InProcessHybridIndexBackend();
    const prefix = (options.pathPrefix ?? "private/context-index/v1").replace(/^\/+|\/+$/g, "");
    if (!prefix || prefix.split("/").some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) throw new Error("Blob context snapshot prefix is invalid.");
    this.#pathname = [
      prefix,
      safeSegment(options.scope.tenantId, "tenant"),
      safeSegment(options.scope.workspaceId, "workspace"),
      safeSegment(options.scope.projectId, "platform"),
      `${safeSegment(options.scope.branch, "default")}-${safeSegment(options.scope.revision, "current")}.json.gz`,
    ].join("/");
  }

  get pathname(): string {
    return this.#pathname;
  }

  getIndexVersion(): number {
    return this.#backend.getIndexVersion();
  }

  upsertChunks(chunks: StoredContextChunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.tenantId !== this.#scope.tenantId || chunk.workspaceId !== this.#scope.workspaceId || (this.#scope.projectId !== undefined && chunk.projectId !== this.#scope.projectId)) {
        throw new Error("Blob context backend rejected a chunk outside its scope.");
      }
    }
    return this.#backend.upsertChunks(chunks);
  }

  deleteSource(sourceUri: string, sourceVersion?: string, scope: ContextScope = this.#scope): Promise<void> {
    return this.#backend.deleteSource(sourceUri, sourceVersion, scope);
  }

  lexicalSearch(query: LexicalQuery): Promise<ContextCandidate[]> {
    return this.#backend.lexicalSearch(query);
  }

  vectorSearch(query: VectorQuery): Promise<ContextCandidate[]> {
    return this.#backend.vectorSearch(query);
  }

  getChunks(chunkIds: string[], scope: ContextScope = this.#scope): Promise<ContextChunk[]> {
    return this.#backend.getChunks(chunkIds, scope);
  }

  getNeighbors(chunkIds: string[], radius: number, scope: ContextScope = this.#scope): Promise<ContextChunk[]> {
    return this.#backend.getNeighbors(chunkIds, radius, scope);
  }

  async persistSnapshot(): Promise<ContextIndexSnapshot> {
    const snapshot = await this.#backend.persistScopeSnapshot(this.#scope);
    const encoded = await encodeSnapshot(snapshot);
    await this.#client.put(this.#pathname, encoded, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/gzip",
    });
    return snapshot;
  }

  loadSnapshot(snapshot: ContextIndexSnapshot): Promise<void> {
    for (const chunk of snapshot.chunks) {
      if (chunk.tenantId !== this.#scope.tenantId || chunk.workspaceId !== this.#scope.workspaceId || (this.#scope.projectId !== undefined && chunk.projectId !== this.#scope.projectId)) {
        throw new Error("Blob context snapshot contains data outside its scope.");
      }
    }
    return this.#backend.loadSnapshot(snapshot);
  }

  async loadPersistedSnapshot(): Promise<boolean> {
    const result = await this.#client.get(this.#pathname);
    if (!result || result.statusCode !== 200 || !result.stream) return false;
    const snapshot = await decodeSnapshot(await readBoundedStream(result.stream));
    await this.loadSnapshot(snapshot);
    return true;
  }
}
