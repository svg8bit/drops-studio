import type {
  BuilderAgentRequest,
  BuilderAgentResult,
  BuilderModelResolution,
  BuilderProviderSelection,
} from "../../builder-agent/types.ts";
import type { RunBuilderAgentDependencies } from "../../builder-agent/orchestrator.ts";
import type { ProjectV2 } from "../../project-v2-types.ts";
import type { CompiledContextPackage, ContextIndexBackend } from "../context/types.ts";
import type { AgentEvalStore } from "../evals/store.ts";
import type { AgentRunTrace } from "../evals/types.ts";
import type { AgentIntelligenceFlags } from "../flags.ts";
import type {
  ModelCapabilityProfile,
  ModelRouteDecision,
  ModelRoutingMode,
} from "../models/types.ts";
import type { VerificationReport } from "../models/verifier.ts";
import type { RuntimeSystemPrompt } from "../system/types.ts";

export interface IntelligentBuilderActorScope {
  actorId: string;
  tenantId: string;
  workspaceId: string;
  branch: string;
}

export interface DeterministicFallbackRoute {
  routeId: string;
  primaryRole: "deterministic-fallback";
  provider: "free";
  model: "deterministic-project-v2";
  routingMode: "selected-only";
  reasonCodes: readonly ["FREE_DETERMINISTIC_FALLBACK"];
  policyVersion: string;
}

export type IntelligentBuilderRoute =
  | ModelRouteDecision
  | DeterministicFallbackRoute;

export type IntelligentBuilderTracePersistence =
  | { status: "persisted" }
  | { status: "disabled"; reason: string }
  | { status: "unavailable"; reason: string };

export type IntelligentBuilderExecutor = (
  request: BuilderAgentRequest,
  dependencies: RunBuilderAgentDependencies,
) => Promise<BuilderAgentResult>;

export interface IntelligentBuilderContextOptions {
  backend?: ContextIndexBackend;
  tokenBudget?: number;
  outputHeadroomTokens?: number;
}

export interface RunIntelligentBuilderAgentInput {
  request: BuilderAgentRequest;
  dependencies: RunBuilderAgentDependencies;
  actor: IntelligentBuilderActorScope;
  project: ProjectV2;
  flags?: AgentIntelligenceFlags;
  evalStore?: Pick<AgentEvalStore, "writeTrace">;
  context?: IntelligentBuilderContextOptions;
  /**
   * Auto policies are accepted only for a platform-owned Vercel AI Gateway
   * resolution. BYOK and custom endpoints are always selected-only.
   */
  requestedRoutingMode?: ModelRoutingMode;
  modelCapabilityOverride?: Partial<ModelCapabilityProfile>;
  runtimePrompt?: RuntimeSystemPrompt;
  builderExecutor?: IntelligentBuilderExecutor;
  now?: () => Date;
}

export interface IntelligentBuilderAgentOutput {
  result: BuilderAgentResult;
  trace: AgentRunTrace;
  verification: VerificationReport;
  contextPackage: CompiledContextPackage | null;
  route: IntelligentBuilderRoute;
  tracePersistence: IntelligentBuilderTracePersistence;
}

export interface ResolvedIntelligentModel {
  resolution: BuilderModelResolution;
  selection: BuilderProviderSelection;
  profile: ModelCapabilityProfile;
  routingMode: ModelRoutingMode;
}
