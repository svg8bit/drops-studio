import { redactContextContent } from "../redaction.ts";
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
import { chunkPermitted, compareContextText, lexicalTerms, sameContextScope } from "../utils.ts";
import { cosineSimilarity } from "../embeddings.ts";

const MAX_INDEX_CHUNKS = 25_000;
const MAX_VECTOR_DIMENSIONS = 8_192;

function publicChunk(chunk: StoredContextChunk): ContextChunk {
  const visible = structuredClone(chunk);
  delete visible.embedding;
  return visible;
}

function requireScope(scope: ContextScope | undefined): ContextScope {
  if (!scope?.tenantId || !scope.workspaceId) throw new Error("A tenant/workspace scope is required for context access.");
  return scope;
}

function compareCandidates(left: ContextCandidate, right: ContextCandidate): number {
  return right.score - left.score || compareContextText(left.chunk.chunkId, right.chunk.chunkId);
}

function sourceTypeAllowed(chunk: ContextChunk, sourceTypes: ContextChunk["sourceType"][] | undefined): boolean {
  return !sourceTypes?.length || sourceTypes.includes(chunk.sourceType);
}

export class InProcessHybridIndexBackend implements ContextIndexBackend {
  readonly #chunks = new Map<string, StoredContextChunk>();
  readonly #inverted = new Map<string, Set<string>>();
  #indexVersion = 0;

  getIndexVersion(): number {
    return this.#indexVersion;
  }

  async upsertChunks(chunks: StoredContextChunk[]): Promise<void> {
    if (this.#chunks.size + chunks.filter((chunk) => !this.#chunks.has(chunk.chunkId)).length > MAX_INDEX_CHUNKS) {
      throw new Error(`Context index exceeds ${MAX_INDEX_CHUNKS} chunks.`);
    }
    for (const chunk of chunks) {
      if (!chunk.tenantId || !chunk.workspaceId || !chunk.chunkId || !chunk.sourceUri || !chunk.contentHash) {
        throw new Error("Context chunk is missing required identity metadata.");
      }
      const redacted = redactContextContent(chunk.content);
      if (redacted.content !== chunk.content) throw new Error(`Context chunk ${chunk.chunkId} contains unredacted secret material.`);
      if (chunk.embedding && (chunk.embedding.length > MAX_VECTOR_DIMENSIONS || chunk.embedding.some((value) => !Number.isFinite(value)))) {
        throw new Error(`Context chunk ${chunk.chunkId} has an invalid embedding.`);
      }
      const prior = this.#chunks.get(chunk.chunkId);
      if (prior) this.#removeTerms(prior);
      const copy = structuredClone(chunk);
      this.#chunks.set(copy.chunkId, copy);
      this.#addTerms(copy);
    }
    if (chunks.length) this.#indexVersion += 1;
  }

  async deleteSource(sourceUri: string, sourceVersion?: string, scope?: ContextScope): Promise<void> {
    const boundedScope = requireScope(scope);
    let changed = false;
    for (const [chunkId, chunk] of this.#chunks) {
      if (!sameContextScope(chunk, boundedScope) || chunk.sourceUri !== sourceUri) continue;
      if (sourceVersion !== undefined && chunk.sourceVersion !== sourceVersion) continue;
      this.#removeTerms(chunk);
      this.#chunks.delete(chunkId);
      changed = true;
    }
    if (changed) this.#indexVersion += 1;
  }

  async lexicalSearch(query: LexicalQuery): Promise<ContextCandidate[]> {
    const terms = query.terms?.length ? [...new Set(query.terms.map((term) => term.toLocaleLowerCase("en-US")))] : lexicalTerms(query.text);
    const ids = new Set<string>();
    for (const term of terms) for (const id of this.#inverted.get(term) ?? []) ids.add(id);
    for (const symbol of query.symbols ?? []) {
      for (const chunk of this.#chunks.values()) if (chunk.symbol === symbol) ids.add(chunk.chunkId);
    }
    const candidates: ContextCandidate[] = [];
    for (const id of ids) {
      const stored = this.#chunks.get(id);
      if (!stored || !sameContextScope(stored, query) || !chunkPermitted(stored, query.permission) || !sourceTypeAllowed(stored, query.sourceTypes)) continue;
      let score = 0;
      const haystackTerms = new Set(stored.lexicalTerms);
      for (const term of terms) {
        if (!haystackTerms.has(term)) continue;
        const documentFrequency = this.#inverted.get(term)?.size ?? 1;
        score += 1 + Math.log(1 + this.#chunks.size / documentFrequency);
      }
      if ((query.symbols ?? []).includes(stored.symbol ?? "")) score += 8;
      if (stored.path && terms.some((term) => stored.path!.toLocaleLowerCase("en-US").includes(term))) score += 2;
      const endpoint = stored.endpoint;
      if (endpoint && terms.some((term) => `${endpoint.method} ${endpoint.path}`.toLocaleLowerCase("en-US").includes(term))) score += 4;
      if (stored.trust === "official") score += 0.75;
      else if (stored.trust === "project-authoritative") score += 0.5;
      if (query.revision !== undefined && stored.revision === query.revision) score += 1;
      candidates.push({ chunk: publicChunk(stored), score, lexicalScore: score, rankSources: ["lexical"] });
    }
    return candidates.sort(compareCandidates).slice(0, query.limit);
  }

  async vectorSearch(query: VectorQuery): Promise<ContextCandidate[]> {
    const candidates: ContextCandidate[] = [];
    for (const stored of this.#chunks.values()) {
      if (!stored.embedding || !sameContextScope(stored, query) || !chunkPermitted(stored, query.permission) || !sourceTypeAllowed(stored, query.sourceTypes)) continue;
      const score = cosineSimilarity(query.vector, stored.embedding);
      candidates.push({ chunk: publicChunk(stored), score, vectorScore: score, rankSources: ["vector"] });
    }
    return candidates.sort(compareCandidates).slice(0, query.limit);
  }

  async getChunks(chunkIds: string[], scope?: ContextScope): Promise<ContextChunk[]> {
    const boundedScope = requireScope(scope);
    return [...new Set(chunkIds)]
      .map((chunkId) => this.#chunks.get(chunkId))
      .filter((chunk): chunk is StoredContextChunk => Boolean(chunk && sameContextScope(chunk, boundedScope)))
      .map(publicChunk);
  }

  async getNeighbors(chunkIds: string[], radius: number, scope?: ContextScope): Promise<ContextChunk[]> {
    const boundedScope = requireScope(scope);
    if (!Number.isSafeInteger(radius) || radius < 0 || radius > 3) throw new Error("Neighbor radius must be between 0 and 3.");
    const seeds = await this.getChunks(chunkIds, boundedScope);
    const result = new Map<string, ContextChunk>();
    for (const seed of seeds) {
      const source = [...this.#chunks.values()]
        .filter((chunk) => sameContextScope(chunk, boundedScope) && chunk.sourceUri === seed.sourceUri && chunk.sourceVersion === seed.sourceVersion)
        .sort((left, right) => left.ordinal - right.ordinal || compareContextText(left.chunkId, right.chunkId));
      for (const chunk of source) if (Math.abs(chunk.ordinal - seed.ordinal) <= radius) result.set(chunk.chunkId, publicChunk(chunk));
    }
    return [...result.values()].sort((left, right) => compareContextText(left.sourceUri, right.sourceUri) || left.ordinal - right.ordinal || compareContextText(left.chunkId, right.chunkId));
  }

  async persistSnapshot(): Promise<ContextIndexSnapshot> {
    const chunks = [...this.#chunks.values()].sort((left, right) => compareContextText(left.chunkId, right.chunkId)).map((chunk) => structuredClone(chunk));
    const createdAt = chunks.reduce((latest, chunk) => chunk.updatedAt > latest ? chunk.updatedAt : latest, "1970-01-01T00:00:00.000Z");
    return { schemaVersion: 1, indexVersion: this.#indexVersion, chunks, createdAt };
  }

  async persistScopeSnapshot(scope: ContextScope): Promise<ContextIndexSnapshot> {
    const chunks = [...this.#chunks.values()].filter((chunk) => sameContextScope(chunk, scope)).sort((left, right) => compareContextText(left.chunkId, right.chunkId)).map((chunk) => structuredClone(chunk));
    const createdAt = chunks.reduce((latest, chunk) => chunk.updatedAt > latest ? chunk.updatedAt : latest, "1970-01-01T00:00:00.000Z");
    return { schemaVersion: 1, indexVersion: this.#indexVersion, chunks, createdAt };
  }

  async loadSnapshot(snapshot: ContextIndexSnapshot): Promise<void> {
    if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.indexVersion) || !Array.isArray(snapshot.chunks)) throw new Error("Context index snapshot is invalid.");
    this.#chunks.clear();
    this.#inverted.clear();
    this.#indexVersion = 0;
    await this.upsertChunks(snapshot.chunks);
    this.#indexVersion = snapshot.indexVersion;
  }

  #addTerms(chunk: StoredContextChunk): void {
    for (const term of chunk.lexicalTerms) {
      const ids = this.#inverted.get(term) ?? new Set<string>();
      ids.add(chunk.chunkId);
      this.#inverted.set(term, ids);
    }
  }

  #removeTerms(chunk: StoredContextChunk): void {
    for (const term of chunk.lexicalTerms) {
      const ids = this.#inverted.get(term);
      if (!ids) continue;
      ids.delete(chunk.chunkId);
      if (!ids.size) this.#inverted.delete(term);
    }
  }
}
