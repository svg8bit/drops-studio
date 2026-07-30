import type { BuilderProviderId } from "../../builder-agent/types.ts";

export const AGENT_MODEL_ROLES = [
  "router",
  "planner",
  "coder",
  "quick-edit",
  "autofix",
  "verifier",
  "retrieval-reranker",
  "eval-judge",
] as const;

export type AgentModelRole = (typeof AGENT_MODEL_ROLES)[number];
export type LiveModelProviderId = Exclude<BuilderProviderId, "free">;
export type CapabilityState = boolean | "unknown";

export type ModelRoutingMode =
  | "selected-only"
  | "auto-balanced"
  | "auto-quality"
  | "auto-economy";

export type ModelRouteReasonCode =
  | "SMALL_LOCAL_EDIT"
  | "NEW_PRODUCT_PLAN"
  | "MULTI_FILE_BUILD"
  | "COMPLEX_ARCHITECTURE"
  | "TYPE_ERROR_REPAIR"
  | "RUNTIME_ERROR_REPAIR"
  | "SECURITY_SENSITIVE"
  | "LONG_CONTEXT_REQUIRED"
  | "VISION_REQUIRED"
  | "LOW_LATENCY_REQUESTED"
  | "LOW_COST_REQUESTED"
  | "SELECTED_MODEL_ONLY"
  | "PROVIDER_UNAVAILABLE"
  | "FALLBACK_AUTHORIZED";

export interface ModelCapabilityProfile {
  provider: LiveModelProviderId;
  model: string;
  displayName: string;
  authorized: boolean;
  source: "user-byok" | "member-oauth" | "platform" | "custom";
  supportsTools: CapabilityState;
  supportsParallelTools: CapabilityState;
  supportsStructuredOutput: CapabilityState;
  supportsVision: CapabilityState;
  supportsEmbeddings: CapabilityState;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  latencyClass: "fast" | "balanced" | "slow" | "unknown";
  qualityClass: "utility" | "standard" | "frontier" | "unknown";
  cost: {
    inputPerMillion: number | null;
    cachedInputPerMillion: number | null;
    outputPerMillion: number | null;
    currency: "USD";
  };
  allowedRoles: AgentModelRole[];
  verifiedAt: string;
  unavailableReason?: string;
}

export interface ModelRef {
  provider: LiveModelProviderId;
  model: string;
}

export interface ModelRouteDecision {
  routeId: string;
  primaryRole: AgentModelRole;
  provider: LiveModelProviderId;
  model: string;
  fallbackChain: ModelRef[];
  contextBudgetTokens: number;
  outputBudgetTokens: number;
  maxToolRounds: number;
  maxRepairRounds: number;
  reasonCodes: ModelRouteReasonCode[];
  estimatedCostBand: "free" | "low" | "medium" | "high" | "unknown";
  requiresUserConfirmation: boolean;
  policyVersion: string;
}

export interface ModelRoutingTask {
  goal: string;
  mutation: boolean;
  newProduct?: boolean;
  architectureChange?: boolean;
  expectedFiles?: number;
  expectedChangedLines?: number;
  requestedIntegrations?: string[];
  failureClass?:
    | "type-error"
    | "runtime-error"
    | "credentials"
    | "authorization"
    | "security-policy"
    | null;
  riskClass?: "low" | "medium" | "high";
  needsVision?: boolean;
  requiredContextTokens?: number;
}

export interface ModelRoutingRequest {
  task: ModelRoutingTask;
  mode: ModelRoutingMode;
  selected?: ModelRef;
  maxInputCostPerMillion?: number | null;
  policyVersion: string;
  now?: Date;
}

export interface ModelUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface RoleAttemptTrace {
  role: AgentModelRole;
  provider: LiveModelProviderId;
  model: string;
  attempt: number;
  fallback: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "succeeded" | "failed" | "skipped";
  skipReason: "circuit-open" | "unauthorized" | null;
  errorClass: "transient" | "permanent" | null;
  usage: ModelUsage | null;
  estimatedCostUsd: number | null;
}
