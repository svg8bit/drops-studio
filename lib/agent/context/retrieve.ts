import { embedContextQuery } from "./embeddings.ts";
import { decomposeRetrievalQueries } from "./query-decomposer.ts";
import { applyContextReranker, DeterministicContextReranker } from "./rerank.ts";
import { redactContextContent } from "./redaction.ts";
import type {
  ContextCandidate,
  ContextIndexBackend,
  ContextReranker,
  ContextScope,
  EmbeddingProvider,
  RetrievalPolicy,
  RetrievalResult,
} from "./types.ts";
import { boundedInteger, compareContextText } from "./utils.ts";

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  lexicalCandidates: 40,
  vectorCandidates: 40,
  fusedCandidates: 30,
  rerankCandidates: 20,
  finalChunks: 12,
  neighborRadius: 1,
  rrfK: 60,
  mmrLambda: 0.72,
  policyVersion: "hybrid-retrieval-v1",
};

export interface HybridRetrievalInput extends ContextScope {
  task: string;
  backend: ContextIndexBackend;
  permission: import("./types.ts").ContextPermissionState;
  embeddingProvider?: EmbeddingProvider;
  reranker?: ContextReranker | null;
  policy?: Partial<RetrievalPolicy>;
  exactChunkIds?: string[];
}

function validatePolicy(overrides: Partial<RetrievalPolicy> | undefined): RetrievalPolicy {
  const policy = { ...DEFAULT_RETRIEVAL_POLICY, ...overrides };
  boundedInteger(policy.lexicalCandidates, 1, 100, "Lexical candidate count");
  boundedInteger(policy.vectorCandidates, 1, 100, "Vector candidate count");
  boundedInteger(policy.fusedCandidates, 1, 60, "Fused candidate count");
  boundedInteger(policy.rerankCandidates, 1, 40, "Rerank candidate count");
  boundedInteger(policy.finalChunks, 1, 20, "Final chunk count");
  boundedInteger(policy.neighborRadius, 0, 3, "Neighbor radius");
  boundedInteger(policy.rrfK, 1, 200, "RRF K");
  if (!Number.isFinite(policy.mmrLambda) || policy.mmrLambda < 0.5 || policy.mmrLambda > 1) throw new Error("MMR lambda must be between 0.5 and 1.");
  return policy;
}

function candidateSimilarity(left: ContextCandidate, right: ContextCandidate): number {
  const a = new Set(left.chunk.lexicalTerms);
  const b = new Set(right.chunk.lexicalTerms);
  const intersection = [...a].filter((term) => b.has(term)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function maximalMarginalRelevance(candidates: ContextCandidate[], limit: number, lambda: number): ContextCandidate[] {
  if (!candidates.length) return [];
  const maximum = Math.max(...candidates.map((candidate) => candidate.score), 1e-9);
  const remaining = [...candidates];
  const selected: ContextCandidate[] = [];
  while (remaining.length && selected.length < limit) {
    remaining.sort((left, right) => {
      const leftNovelty = selected.length ? Math.max(...selected.map((item) => candidateSimilarity(left, item))) : 0;
      const rightNovelty = selected.length ? Math.max(...selected.map((item) => candidateSimilarity(right, item))) : 0;
      const leftScore = lambda * (left.score / maximum) - (1 - lambda) * leftNovelty;
      const rightScore = lambda * (right.score / maximum) - (1 - lambda) * rightNovelty;
      return rightScore - leftScore || compareContextText(left.chunk.chunkId, right.chunk.chunkId);
    });
    selected.push(remaining.shift()!);
  }
  return selected;
}

function addRank(
  fused: Map<string, ContextCandidate>,
  candidates: ContextCandidate[],
  source: "lexical" | "vector",
  rrfK: number,
): void {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const existing = fused.get(candidate.chunk.chunkId) ?? { ...candidate, score: 0, rankSources: [] };
    existing.score += 1 / (rrfK + index + 1);
    existing.lexicalScore = Math.max(existing.lexicalScore ?? 0, candidate.lexicalScore ?? 0);
    existing.vectorScore = Math.max(existing.vectorScore ?? -1, candidate.vectorScore ?? -1);
    if (!existing.rankSources.includes(source)) existing.rankSources.push(source);
    fused.set(candidate.chunk.chunkId, existing);
  }
}

export async function retrieveContext(input: HybridRetrievalInput): Promise<RetrievalResult> {
  const policy = validatePolicy(input.policy);
  const safeTask = redactContextContent(input.task).content;
  const queries = await decomposeRetrievalQueries(safeTask);
  const scope: ContextScope = { tenantId: input.tenantId, workspaceId: input.workspaceId, projectId: input.projectId, branch: input.branch, revision: input.revision, includeWorkspaceSources: true };
  const fused = new Map<string, ContextCandidate>();
  for (const query of queries) {
    const lexical = await input.backend.lexicalSearch({
      ...scope,
      text: query.text,
      terms: query.terms,
      symbols: query.symbols,
      sourceTypes: query.sourceTypes,
      permission: input.permission,
      limit: policy.lexicalCandidates,
    });
    addRank(fused, lexical, "lexical", policy.rrfK);
    const vector = await embedContextQuery(query.text, input.embeddingProvider);
    if (vector) {
      const semantic = await input.backend.vectorSearch({ ...scope, vector, sourceTypes: query.sourceTypes, permission: input.permission, limit: policy.vectorCandidates });
      addRank(fused, semantic, "vector", policy.rrfK);
    }
  }
  for (const candidate of fused.values()) {
    if (candidate.chunk.trust === "official") candidate.score += 0.035;
    else if (candidate.chunk.trust === "project-authoritative") candidate.score += 0.025;
    if (candidate.chunk.revision === input.revision) candidate.score += 0.02;
  }
  const exactChunks = input.exactChunkIds?.length ? await input.backend.getChunks(input.exactChunkIds, scope) : [];
  for (const chunk of exactChunks) fused.set(chunk.chunkId, { chunk, score: 10, rankSources: ["exact"] });
  let candidates = [...fused.values()].sort((left, right) => right.score - left.score || compareContextText(left.chunk.chunkId, right.chunk.chunkId)).slice(0, policy.fusedCandidates);
  candidates = await applyContextReranker(candidates.slice(0, policy.rerankCandidates), safeTask, input.reranker === null ? undefined : input.reranker ?? new DeterministicContextReranker());
  let selected = maximalMarginalRelevance(candidates, policy.finalChunks, policy.mmrLambda);
  if (policy.neighborRadius > 0 && selected.length < policy.finalChunks) {
    const neighbors = await input.backend.getNeighbors(selected.map((candidate) => candidate.chunk.chunkId), policy.neighborRadius, scope);
    const existing = new Set(selected.map((candidate) => candidate.chunk.chunkId));
    for (const neighbor of neighbors) {
      if (existing.has(neighbor.chunkId) || selected.length >= policy.finalChunks) continue;
      const parent = selected.find((candidate) => candidate.chunk.sourceUri === neighbor.sourceUri);
      selected.push({ chunk: neighbor, score: (parent?.score ?? 0) * 0.9, rankSources: parent?.rankSources ?? ["lexical"] });
      existing.add(neighbor.chunkId);
    }
  }
  selected = selected.sort((left, right) => Number(right.rankSources.includes("exact")) - Number(left.rankSources.includes("exact")) || right.score - left.score || compareContextText(left.chunk.chunkId, right.chunk.chunkId));
  return {
    mode: input.embeddingProvider ? "hybrid" : exactChunks.length && !fused.size ? "exact-files-only" : "lexical-only",
    queries,
    candidates,
    selected,
    omitted: [],
    indexVersion: input.backend.getIndexVersion(),
    embeddingPolicy: input.embeddingProvider?.policy,
  };
}
