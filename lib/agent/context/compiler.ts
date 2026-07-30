import { contextItemFromCandidate } from "./provenance.ts";
import { retrieveContext } from "./retrieve.ts";
import type {
  CompileContextInput,
  CompiledContextPackage,
  ContextCandidate,
  ContextChunk,
  ContextCompilationResult,
  ContextIndexBackend,
  ContextItem,
  ContextReranker,
  ContextScope,
  EmbeddingProvider,
  RetrievalPolicy,
} from "./types.ts";
import { boundedInteger, chunkPermitted, compareContextText, contextSha256, estimateContextTokens, stableContextJson } from "./utils.ts";

export interface ContextCompilerOptions {
  backend: ContextIndexBackend;
  embeddingProvider?: EmbeddingProvider;
  reranker?: ContextReranker | null;
  retrievalPolicy?: Partial<RetrievalPolicy>;
}

function asCandidate(chunk: ContextChunk, score: number, exact = false): ContextCandidate {
  return { chunk, score, rankSources: [exact ? "exact" : "lexical"] };
}

function itemTokens(item: ContextItem): number {
  return estimateContextTokens(item.content);
}

function deterministicItems(items: ContextItem[]): ContextItem[] {
  return items.sort((left, right) => right.relevanceScore - left.relevanceScore || compareContextText(left.chunkId, right.chunkId));
}

export class ContextCompiler {
  readonly #backend: ContextIndexBackend;
  readonly #embeddingProvider?: EmbeddingProvider;
  readonly #reranker?: ContextReranker | null;
  readonly #retrievalPolicy?: Partial<RetrievalPolicy>;

  constructor(options: ContextCompilerOptions) {
    this.#backend = options.backend;
    this.#embeddingProvider = options.embeddingProvider;
    this.#reranker = options.reranker;
    this.#retrievalPolicy = options.retrievalPolicy;
  }

  async compile(input: CompileContextInput): Promise<CompiledContextPackage> {
    return (await this.compileWithTrace(input)).context;
  }

  async compileWithTrace(input: CompileContextInput): Promise<ContextCompilationResult> {
    boundedInteger(input.tokenBudget, 256, 200_000, "Context token budget");
    boundedInteger(input.outputHeadroomTokens, 0, input.tokenBudget - 1, "Context output headroom");
    const available = input.tokenBudget - input.outputHeadroomTokens;
    const scope: ContextScope = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      branch: input.branch,
      revision: input.revision,
      includeWorkspaceSources: true,
    };
    const mandatoryIds = [...new Set(input.mandatoryChunkIds ?? [])];
    const requestedExactIds = [...new Set(input.exactChunkIds ?? [])];
    const mandatoryChunks = mandatoryIds.length ? await this.#backend.getChunks(mandatoryIds, scope) : [];
    const fetchedExactChunks = requestedExactIds.length ? await this.#backend.getChunks(requestedExactIds, scope) : [];
    const availableMandatoryIds = new Set(mandatoryChunks.map((chunk) => chunk.chunkId));
    const availableExactIds = new Set(fetchedExactChunks.map((chunk) => chunk.chunkId));
    const missingIds = [
      ...mandatoryIds.filter((chunkId) => !availableMandatoryIds.has(chunkId)),
      ...requestedExactIds.filter((chunkId) => !availableExactIds.has(chunkId)),
    ];
    if (missingIds.length) {
      throw new Error(`Required context chunks are unavailable in the requested scope: ${[...new Set(missingIds)].sort(compareContextText).join(", ")}.`);
    }
    const mandatoryIdSet = new Set(mandatoryIds);
    const exactChunks = fetchedExactChunks.filter((chunk) => !mandatoryIdSet.has(chunk.chunkId));
    const omitted: CompiledContextPackage["omitted"] = [];
    const mandatoryPolicies = mandatoryChunks
      .filter((chunk) => {
        const allowed = chunkPermitted(chunk, input.permission);
        if (!allowed) omitted.push({ reason: "permission", sourceUri: chunk.sourceUri });
        return allowed;
      })
      .map((chunk) => contextItemFromCandidate(asCandidate(chunk, 100, true)));
    const exactProjectFiles = exactChunks
      .filter((chunk) => {
        const allowed = chunkPermitted(chunk, input.permission);
        if (!allowed) omitted.push({ reason: "permission", sourceUri: chunk.sourceUri });
        return allowed;
      })
      .map((chunk) => contextItemFromCandidate(asCandidate(chunk, 90, true)));
    const requiredIds = new Set([...mandatoryPolicies, ...exactProjectFiles].map((item) => item.chunkId));
    let estimatedTokens = [...mandatoryPolicies, ...exactProjectFiles].reduce((total, item) => total + itemTokens(item), 0);
    if (estimatedTokens > available) throw new Error("Mandatory policies and exact project files exceed the context token budget.");

    const retrieval = await retrieveContext({
      ...scope,
      task: input.task,
      backend: this.#backend,
      permission: input.permission,
      embeddingProvider: this.#embeddingProvider,
      reranker: this.#reranker,
      policy: this.#retrievalPolicy,
      exactChunkIds: requestedExactIds.filter((chunkId) => !mandatoryIdSet.has(chunkId)),
    });
    const projectMemory: ContextItem[] = [];
    const retrievedProjectContext: ContextItem[] = [];
    const officialReferences: ContextItem[] = [];
    const runtimeEvidence: ContextItem[] = [];
    const integrationEvidence: ContextItem[] = [];
    const seen = new Set(requiredIds);
    for (const candidate of retrieval.selected) {
      if (seen.has(candidate.chunk.chunkId)) {
        if (!requiredIds.has(candidate.chunk.chunkId)) omitted.push({ reason: "duplicate", sourceUri: candidate.chunk.sourceUri });
        continue;
      }
      const item = contextItemFromCandidate(candidate);
      const tokens = itemTokens(item);
      if (estimatedTokens + tokens > available) {
        omitted.push({ reason: "budget", sourceUri: item.sourceUri });
        continue;
      }
      estimatedTokens += tokens;
      seen.add(item.chunkId);
      if (candidate.chunk.sourceType === "memory") projectMemory.push(item);
      else if (candidate.chunk.endpoint) integrationEvidence.push(item);
      else if (["runtime-log", "browser-report", "test-report"].includes(candidate.chunk.sourceType)) runtimeEvidence.push(item);
      else if (candidate.chunk.trust === "official" || candidate.chunk.trust === "system") officialReferences.push(item);
      else retrievedProjectContext.push(item);
    }
    omitted.push(...retrieval.omitted);
    const taskHash = await contextSha256(input.task.trim());
    const base = {
      schemaVersion: 1 as const,
      projectRevision: input.projectRevision,
      taskHash,
      role: input.role,
      modelProfileHash: input.modelProfileHash,
      retrievalMode: retrieval.mode,
      promptVersion: input.promptVersion,
      tokenBudget: input.tokenBudget,
      estimatedTokens,
      mandatoryPolicies: deterministicItems(mandatoryPolicies),
      projectMemory: deterministicItems(projectMemory),
      exactProjectFiles: deterministicItems(exactProjectFiles),
      retrievedProjectContext: deterministicItems(retrievedProjectContext),
      officialReferences: deterministicItems(officialReferences),
      runtimeEvidence: deterministicItems(runtimeEvidence),
      integrationEvidence: deterministicItems(integrationEvidence),
      omitted: omitted.sort((left, right) => compareContextText(left.reason, right.reason) || compareContextText(left.sourceUri, right.sourceUri)),
    };
    const packageId = await contextSha256(stableContextJson({ ...base, approvalState: input.approvalState ?? "none", indexVersion: retrieval.indexVersion }));
    const context: CompiledContextPackage = { packageId, ...base };
    return {
      context,
      trace: {
        retrievalMode: retrieval.mode,
        indexVersion: retrieval.indexVersion,
        queryKinds: retrieval.queries.map((query) => query.kind),
        queryIds: retrieval.queries.map((query) => query.id),
        candidateCount: retrieval.candidates.length,
        selected: retrieval.selected.map((candidate) => ({
          chunkId: candidate.chunk.chunkId,
          sourceUri: candidate.chunk.sourceUri,
          trust: candidate.chunk.trust,
          score: candidate.score,
          injectionFlags: [...candidate.chunk.injectionFlags],
        })),
        tokenBudget: input.tokenBudget,
        estimatedTokens,
        omittedCount: context.omitted.length,
        retrievalSucceeded: retrieval.selected.length > 0,
      },
    };
  }
}
