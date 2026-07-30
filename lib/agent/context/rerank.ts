import type { ContextCandidate, ContextReranker, RerankInput } from "./types.ts";
import { compareContextText, lexicalTerms } from "./utils.ts";

export class DeterministicContextReranker implements ContextReranker {
  readonly id = "deterministic-context-reranker-v1";

  async rerank(input: RerankInput): Promise<Array<{ chunkId: string; score: number }>> {
    const queryTerms = new Set(lexicalTerms(input.query));
    return input.candidates
      .map((candidate) => {
        const terms = new Set(candidate.chunk.lexicalTerms);
        const exact = [...queryTerms].filter((term) => terms.has(term)).length;
        const symbol = candidate.chunk.symbol && queryTerms.has(candidate.chunk.symbol.toLocaleLowerCase("en-US")) ? 4 : 0;
        const endpoint = candidate.chunk.endpoint && [...queryTerms].some((term) => `${candidate.chunk.endpoint!.method} ${candidate.chunk.endpoint!.path}`.toLocaleLowerCase("en-US").includes(term)) ? 3 : 0;
        const authority = candidate.chunk.trust === "official" ? 1.5 : candidate.chunk.trust === "project-authoritative" ? 1.25 : 0;
        return { chunkId: candidate.chunk.chunkId, score: exact + symbol + endpoint + authority };
      })
      .sort((left, right) => right.score - left.score || compareContextText(left.chunkId, right.chunkId));
  }
}

export async function applyContextReranker(candidates: ContextCandidate[], query: string, reranker?: ContextReranker): Promise<ContextCandidate[]> {
  if (!reranker || !candidates.length) return candidates;
  const ranks = await reranker.rerank({ query, candidates: candidates.map((candidate) => structuredClone(candidate)) });
  const valid = new Map(candidates.map((candidate) => [candidate.chunk.chunkId, candidate]));
  const scores = new Map<string, number>();
  for (const result of ranks) {
    if (!valid.has(result.chunkId) || !Number.isFinite(result.score)) continue;
    scores.set(result.chunkId, result.score);
  }
  const maximum = Math.max(1, ...scores.values());
  return candidates
    .map((candidate) => ({ ...candidate, score: candidate.score + (scores.get(candidate.chunk.chunkId) ?? 0) / maximum }))
    .sort((left, right) => right.score - left.score || compareContextText(left.chunk.chunkId, right.chunk.chunkId));
}
