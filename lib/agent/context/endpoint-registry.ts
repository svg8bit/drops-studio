import type { ContextChunk, EndpointKnowledge } from "./types.ts";
import { compareContextText } from "./utils.ts";

function keyOf(endpoint: Pick<EndpointKnowledge, "provider" | "version" | "method" | "path">): string {
  return `${endpoint.provider.toLocaleLowerCase("en-US")}\u0000${endpoint.version}\u0000${endpoint.method.toUpperCase()}\u0000${endpoint.path}`;
}

export class EndpointKnowledgeRegistry {
  readonly #endpoints = new Map<string, EndpointKnowledge>();

  registerFromChunks(chunks: ContextChunk[]): EndpointKnowledge[] {
    const added: EndpointKnowledge[] = [];
    for (const chunk of chunks) {
      if (!chunk.endpoint) continue;
      const documented = chunk.sourceType === "openapi" && chunk.trust === "official";
      const endpoint: EndpointKnowledge = {
        provider: chunk.endpoint.provider,
        version: chunk.sourceVersion,
        method: chunk.endpoint.method.toUpperCase(),
        path: chunk.endpoint.path,
        operationId: chunk.endpoint.operationId,
        documented,
        authMode: chunk.endpoint.authMode ?? "unknown",
        capabilityTags: [...(chunk.endpoint.capabilityTags ?? [])].sort(compareContextText),
        limitations: [...(chunk.endpoint.limitations ?? [])],
        sourceChunkIds: [chunk.chunkId],
      };
      const key = keyOf(endpoint);
      const prior = this.#endpoints.get(key);
      if (prior) endpoint.sourceChunkIds = [...new Set([...prior.sourceChunkIds, chunk.chunkId])].sort(compareContextText);
      this.#endpoints.set(key, endpoint);
      added.push(structuredClone(endpoint));
    }
    return added;
  }

  find(provider: string, method: string, path: string, version?: string): EndpointKnowledge | null {
    const matches = [...this.#endpoints.values()]
      .filter((endpoint) => endpoint.provider === provider && endpoint.method === method.toUpperCase() && endpoint.path === path && (version === undefined || endpoint.version === version))
      .sort((left, right) => Number(right.documented) - Number(left.documented) || compareContextText(right.version, left.version));
    return matches[0] ? structuredClone(matches[0]) : null;
  }

  list(): EndpointKnowledge[] {
    return [...this.#endpoints.values()].sort((left, right) => compareContextText(keyOf(left), keyOf(right))).map((endpoint) => structuredClone(endpoint));
  }
}
