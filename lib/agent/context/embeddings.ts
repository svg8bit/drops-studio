import type { EmbeddingProvider, StoredContextChunk } from "./types.ts";

const MAX_EMBEDDING_BATCH = 64;

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function validateVector(vector: number[], dimensions: number): number[] {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding provider returned an invalid ${vector.length}-dimension vector; expected ${dimensions}.`);
  }
  return vector;
}

function unitNormalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value ** 2, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

export async function embedContextChunks(chunks: StoredContextChunk[], provider?: EmbeddingProvider): Promise<StoredContextChunk[]> {
  if (!provider || !chunks.length) return chunks.map((chunk) => ({ ...chunk, embedding: undefined, embeddingRef: undefined }));
  const output = chunks.map((chunk) => structuredClone(chunk));
  for (let start = 0; start < chunks.length; start += MAX_EMBEDDING_BATCH) {
    const batch = chunks.slice(start, start + MAX_EMBEDDING_BATCH);
    const vectors = await provider.embed(batch.map((chunk) => chunk.content));
    if (vectors.length !== batch.length) throw new Error("Embedding provider returned the wrong number of vectors.");
    for (let offset = 0; offset < batch.length; offset += 1) {
      const raw = validateVector(vectors[offset], provider.policy.dimensions);
      output[start + offset].embedding = provider.policy.normalization === "unit" ? unitNormalize(raw) : raw;
      output[start + offset].embeddingRef = `${provider.policy.provider}:${provider.policy.model}:${batch[offset].contentHash}`;
    }
  }
  return output;
}

export async function embedContextQuery(query: string, provider?: EmbeddingProvider): Promise<number[] | null> {
  if (!provider) return null;
  const vectors = await provider.embed([query]);
  if (vectors.length !== 1) throw new Error("Embedding provider returned the wrong number of query vectors.");
  const raw = validateVector(vectors[0], provider.policy.dimensions);
  return provider.policy.normalization === "unit" ? unitNormalize(raw) : raw;
}
