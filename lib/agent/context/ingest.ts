import { chunkContextSource } from "./chunkers/index.ts";
import { embedContextChunks } from "./embeddings.ts";
import { contextRedactionVersion, redactContextContent } from "./redaction.ts";
import type { ContextIndexBackend, ContextScope, ContextSource, EmbeddingProvider, StoredContextChunk } from "./types.ts";
import { boundedInteger, canonicalizeSourceUri, contextSha256, estimateContextTokens, isEnvironmentContextSource, lexicalTerms, normalizeContextText, stableContextJson } from "./utils.ts";

export const CONTEXT_CHUNKER_VERSION = "context-chunker-v1";

export interface ContextIngestionResult {
  sourceUri: string;
  sourceVersion: string;
  sourceHash: string;
  chunkIds: string[];
  redactionCount: number;
  embedded: boolean;
  cacheHit: boolean;
}

export interface ContextIngestorOptions {
  maxCacheEntries?: number;
}

export class ContextIngestor {
  readonly #backend: ContextIndexBackend;
  readonly #embeddingProvider?: EmbeddingProvider;
  readonly #cache = new Map<string, ContextIngestionResult>();
  readonly #maxCacheEntries: number;

  constructor(backend: ContextIndexBackend, embeddingProvider?: EmbeddingProvider, options: ContextIngestorOptions = {}) {
    this.#backend = backend;
    this.#embeddingProvider = embeddingProvider;
    this.#maxCacheEntries = boundedInteger(options.maxCacheEntries ?? 1_024, 1, 10_000, "Context ingestion cache capacity");
  }

  get cacheSize(): number {
    return this.#cache.size;
  }

  async ingest(source: ContextSource): Promise<ContextIngestionResult> {
    if (source.sensitivity === "prohibited" || source.sensitivity === "secret-like" || source.noIndex) {
      return { sourceUri: source.sourceUri, sourceVersion: source.sourceVersion, sourceHash: "", chunkIds: [], redactionCount: 0, embedded: false, cacheHit: false };
    }
    const sourceUri = canonicalizeSourceUri(source.sourceUri);
    const environmentFile = isEnvironmentContextSource(source.path, sourceUri);
    const redacted = redactContextContent(source.content, { environmentFile });
    const content = normalizeContextText(redacted.content);
    const sourceHash = await contextSha256(content);
    const embeddingVersion = this.#embeddingProvider ? stableContextJson(this.#embeddingProvider.policy) : "lexical-only";
    const cacheKey = await contextSha256(stableContextJson({
      scope: { tenantId: source.tenantId, workspaceId: source.workspaceId, projectId: source.projectId, branch: source.branch, revision: source.revision },
      sourceUri,
      sourceVersion: source.sourceVersion,
      sourceHash,
      chunkerVersion: CONTEXT_CHUNKER_VERSION,
      redactionVersion: contextRedactionVersion(),
      embeddingVersion,
    }));
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      this.#cache.delete(cacheKey);
      this.#cache.set(cacheKey, cached);
      return { ...cached, chunkIds: [...cached.chunkIds], cacheHit: true };
    }

    const safeSource: ContextSource = { ...source, sourceUri, content };
    const drafts = chunkContextSource(safeSource);
    const chunks: StoredContextChunk[] = [];
    for (const draft of drafts) {
      const chunkContent = normalizeContextText(draft.content);
      if (!chunkContent) continue;
      const contentHash = await contextSha256(chunkContent);
      const chunkId = await contextSha256(stableContextJson({
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        branch: source.branch,
        revision: source.revision,
        sourceUri,
        sourceVersion: source.sourceVersion,
        ordinal: draft.ordinal,
        contentHash,
        chunkerVersion: CONTEXT_CHUNKER_VERSION,
      }));
      const injectionFlags = redactContextContent(chunkContent).injectionFlags;
      chunks.push({
        chunkId,
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        branch: source.branch,
        revision: source.revision,
        sourceType: source.sourceType,
        sourceUri,
        sourceVersion: source.sourceVersion,
        path: draft.path ?? source.path,
        language: draft.language ?? source.language,
        symbol: draft.symbol,
        headingPath: draft.headingPath,
        endpoint: draft.endpoint,
        lineStart: draft.lineStart,
        lineEnd: draft.lineEnd,
        ordinal: chunks.length,
        content: chunkContent,
        contentHash,
        tokenCount: estimateContextTokens(chunkContent),
        trust: source.trust,
        sensitivity: source.sensitivity,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        expiresAt: source.expiresAt,
        lexicalTerms: lexicalTerms([
          chunkContent,
          draft.symbol ?? "",
          draft.path ?? source.path ?? "",
          draft.endpoint ? `${draft.endpoint.provider} ${draft.endpoint.method} ${draft.endpoint.path} ${draft.endpoint.operationId ?? ""}` : "",
        ].join("\n")),
        neighborChunkIds: [],
        injectionFlags,
      });
    }
    for (let index = 0; index < chunks.length; index += 1) {
      chunks[index].neighborChunkIds = [chunks[index - 1]?.chunkId, chunks[index + 1]?.chunkId].filter((value): value is string => Boolean(value));
    }
    const embeddedChunks = await embedContextChunks(chunks, this.#embeddingProvider);
    await this.#backend.deleteSource(sourceUri, source.sourceVersion, source);
    await this.#backend.upsertChunks(embeddedChunks);
    const result: ContextIngestionResult = {
      sourceUri,
      sourceVersion: source.sourceVersion,
      sourceHash,
      chunkIds: embeddedChunks.map((chunk) => chunk.chunkId),
      redactionCount: redacted.findings.reduce((total, finding) => total + finding.count, 0),
      embedded: Boolean(this.#embeddingProvider),
      cacheHit: false,
    };
    this.#cache.set(cacheKey, structuredClone(result));
    while (this.#cache.size > this.#maxCacheEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    return result;
  }

  async ingestMany(sources: ContextSource[]): Promise<ContextIngestionResult[]> {
    const results: ContextIngestionResult[] = [];
    for (const source of sources) results.push(await this.ingest(source));
    return results;
  }

  async invalidateSource(scope: ContextScope, sourceUri: string, sourceVersion?: string): Promise<void> {
    const canonicalUri = canonicalizeSourceUri(sourceUri);
    await this.#backend.deleteSource(canonicalUri, sourceVersion, scope);
    for (const [key, result] of this.#cache) {
      if (result.sourceUri === canonicalUri && (sourceVersion === undefined || result.sourceVersion === sourceVersion)) this.#cache.delete(key);
    }
  }
}
