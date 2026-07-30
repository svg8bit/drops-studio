export const CONTEXT_SCHEMA_VERSION = 1 as const;

export type ContextTrust =
  | "system"
  | "official"
  | "project-authoritative"
  | "user-supplied"
  | "generated"
  | "runtime-evidence"
  | "untrusted-external";

export type ContextSensitivity =
  | "public"
  | "workspace-private"
  | "project-private"
  | "secret-like"
  | "prohibited";

export type ContextSourceType =
  | "code"
  | "markdown"
  | "openapi"
  | "json-schema"
  | "memory"
  | "skill"
  | "runtime-log"
  | "browser-report"
  | "test-report"
  | "design-reference";

export interface ContextScope {
  tenantId: string;
  workspaceId: string;
  projectId?: string;
  branch?: string;
  revision?: string;
  /** Allows project-scoped reads to also see workspace/platform references, never another project. */
  includeWorkspaceSources?: boolean;
}

export interface ContextEndpointMetadata {
  provider: string;
  method: string;
  path: string;
  operationId?: string;
  authMode?: string;
  capabilityTags?: string[];
  limitations?: string[];
}

export interface ContextChunk extends ContextScope {
  chunkId: string;
  sourceType: ContextSourceType;
  sourceUri: string;
  sourceVersion: string;
  path?: string;
  language?: string;
  symbol?: string;
  headingPath?: string[];
  endpoint?: ContextEndpointMetadata;
  lineStart?: number;
  lineEnd?: number;
  ordinal: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  trust: ContextTrust;
  sensitivity: Exclude<ContextSensitivity, "prohibited">;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lexicalTerms: string[];
  embeddingRef?: string;
  neighborChunkIds: string[];
  injectionFlags: PromptInjectionFlag[];
}

export interface StoredContextChunk extends ContextChunk {
  embedding?: number[];
}

export interface ContextSource extends ContextScope {
  sourceType: ContextSourceType;
  sourceUri: string;
  sourceVersion: string;
  content: string;
  path?: string;
  language?: string;
  trust: ContextTrust;
  sensitivity: ContextSensitivity;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  noIndex?: boolean;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export type PromptInjectionFlag =
  | "instruction-override"
  | "secret-exfiltration"
  | "unauthorized-tool"
  | "provider-or-billing-change"
  | "external-publication"
  | "disable-checks"
  | "conceal-failure";

export interface RedactionFinding {
  kind: string;
  placeholder: string;
  count: number;
}

export interface RedactionResult {
  content: string;
  findings: RedactionFinding[];
  injectionFlags: PromptInjectionFlag[];
}

export interface ChunkDraft {
  content: string;
  ordinal: number;
  path?: string;
  language?: string;
  symbol?: string;
  headingPath?: string[];
  endpoint?: ContextEndpointMetadata;
  lineStart?: number;
  lineEnd?: number;
}

export interface ContextCandidate {
  chunk: ContextChunk;
  score: number;
  lexicalScore?: number;
  vectorScore?: number;
  rankSources: Array<"lexical" | "vector" | "exact">;
}

export interface ContextPermissionState {
  allowedTrust?: ContextTrust[];
  allowWorkspacePrivate: boolean;
  allowProjectPrivate: boolean;
  includeRuntimeEvidence: boolean;
}

export interface LexicalQuery extends ContextScope {
  text: string;
  terms?: string[];
  symbols?: string[];
  sourceTypes?: ContextSourceType[];
  permission: ContextPermissionState;
  limit: number;
}

export interface VectorQuery extends ContextScope {
  vector: number[];
  sourceTypes?: ContextSourceType[];
  permission: ContextPermissionState;
  limit: number;
}

export interface ContextIndexSnapshot {
  schemaVersion: 1;
  indexVersion: number;
  chunks: StoredContextChunk[];
  createdAt: string;
}

export interface ContextIndexBackend {
  upsertChunks(chunks: StoredContextChunk[]): Promise<void>;
  deleteSource(sourceUri: string, sourceVersion?: string, scope?: ContextScope): Promise<void>;
  lexicalSearch(query: LexicalQuery): Promise<ContextCandidate[]>;
  vectorSearch(query: VectorQuery): Promise<ContextCandidate[]>;
  getChunks(chunkIds: string[], scope?: ContextScope): Promise<ContextChunk[]>;
  getNeighbors(chunkIds: string[], radius: number, scope?: ContextScope): Promise<ContextChunk[]>;
  persistSnapshot(): Promise<ContextIndexSnapshot>;
  loadSnapshot(snapshot: ContextIndexSnapshot): Promise<void>;
  getIndexVersion(): number;
}

export interface EmbeddingPolicy {
  provider: string;
  model: string;
  dimensions: number;
  normalization: "none" | "unit";
  policyVersion: string;
}

export interface EmbeddingProvider {
  readonly policy: EmbeddingPolicy;
  embed(input: string[]): Promise<number[][]>;
}

export type RetrievalQueryKind =
  | "project-architecture"
  | "target-files"
  | "symbol-definition"
  | "framework-reference"
  | "integration-endpoint"
  | "error-diagnosis"
  | "design-rule"
  | "security-policy"
  | "test-pattern"
  | "project-memory";

export interface RetrievalQuery {
  id: string;
  kind: RetrievalQueryKind;
  text: string;
  terms: string[];
  symbols: string[];
  sourceTypes?: ContextSourceType[];
}

export interface RetrievalPolicy {
  lexicalCandidates: number;
  vectorCandidates: number;
  fusedCandidates: number;
  rerankCandidates: number;
  finalChunks: number;
  neighborRadius: number;
  rrfK: number;
  mmrLambda: number;
  policyVersion: string;
}

export interface RerankInput {
  query: string;
  candidates: ContextCandidate[];
}

export interface ContextReranker {
  readonly id: string;
  rerank(input: RerankInput): Promise<Array<{ chunkId: string; score: number }>>;
}

export interface RetrievalResult {
  mode: "hybrid" | "lexical-only" | "exact-files-only";
  queries: RetrievalQuery[];
  candidates: ContextCandidate[];
  selected: ContextCandidate[];
  omitted: Array<{ reason: "permission" | "stale" | "duplicate" | "low-score"; sourceUri: string }>;
  indexVersion: number;
  embeddingPolicy?: EmbeddingPolicy;
}

export interface ContextItem {
  chunkId: string;
  sourceUri: string;
  sourceVersion: string;
  trust: ContextTrust;
  relevanceScore: number;
  contentHash: string;
  content: string;
  path?: string;
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
  endpoint?: ContextEndpointMetadata;
  injectionFlags: PromptInjectionFlag[];
}

export interface CompiledContextPackage {
  schemaVersion: 1;
  packageId: string;
  projectRevision: string;
  taskHash: string;
  role: string;
  modelProfileHash: string;
  retrievalMode: "hybrid" | "lexical-only" | "exact-files-only";
  promptVersion: string;
  tokenBudget: number;
  estimatedTokens: number;
  mandatoryPolicies: ContextItem[];
  projectMemory: ContextItem[];
  exactProjectFiles: ContextItem[];
  retrievedProjectContext: ContextItem[];
  officialReferences: ContextItem[];
  runtimeEvidence: ContextItem[];
  integrationEvidence: ContextItem[];
  omitted: Array<{
    reason: "budget" | "permission" | "stale" | "duplicate" | "low-score";
    sourceUri: string;
  }>;
}

export interface ContextCompilationTrace {
  retrievalMode: CompiledContextPackage["retrievalMode"];
  indexVersion: number;
  queryKinds: RetrievalQueryKind[];
  queryIds: string[];
  candidateCount: number;
  selected: Array<{
    chunkId: string;
    sourceUri: string;
    trust: ContextTrust;
    score: number;
    injectionFlags: PromptInjectionFlag[];
  }>;
  tokenBudget: number;
  estimatedTokens: number;
  omittedCount: number;
  retrievalSucceeded: boolean;
}

export interface ContextCompilationResult {
  context: CompiledContextPackage;
  trace: ContextCompilationTrace;
}

export interface CompileContextInput extends ContextScope {
  task: string;
  role: string;
  projectRevision: string;
  modelProfileHash: string;
  promptVersion: string;
  tokenBudget: number;
  outputHeadroomTokens: number;
  permission: ContextPermissionState;
  exactChunkIds?: string[];
  mandatoryChunkIds?: string[];
  approvalState?: string;
}

export interface EndpointKnowledge {
  provider: string;
  version: string;
  method: string;
  path: string;
  operationId?: string;
  documented: boolean;
  authMode: string;
  requestSchemaRef?: string;
  responseSchemaRef?: string;
  capabilityTags: string[];
  limitations: string[];
  sourceChunkIds: string[];
}
