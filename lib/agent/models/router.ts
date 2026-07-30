import { createHash } from "node:crypto";
import { AuthorizedModelRegistry, modelRegistryKey } from "./capability-registry.ts";
import type { ModelRoleCircuitBreaker } from "./circuit-breaker.ts";
import { estimatedCostBand } from "./usage.ts";
import type {
  AgentModelRole,
  ModelCapabilityProfile,
  ModelRouteDecision,
  ModelRouteReasonCode,
  ModelRoutingRequest,
} from "./types.ts";

export class ModelRoutingError extends Error {
  readonly code:
    | "NO_AUTHORIZED_MODEL"
    | "SELECTED_MODEL_UNAVAILABLE"
    | "CAPABILITY_MISMATCH"
    | "BUDGET_EXCEEDED";
  readonly requiresUserConfirmation: boolean;

  constructor(
    code:
      | "NO_AUTHORIZED_MODEL"
      | "SELECTED_MODEL_UNAVAILABLE"
      | "CAPABILITY_MISMATCH"
      | "BUDGET_EXCEEDED",
    message: string,
    requiresUserConfirmation = false,
  ) {
    super(message);
    this.name = "ModelRoutingError";
    this.code = code;
    this.requiresUserConfirmation = requiresUserConfirmation;
  }
}

function classify(request: ModelRoutingRequest): {
  role: AgentModelRole;
  reasons: ModelRouteReasonCode[];
} {
  const task = request.task;
  if (task.failureClass === "type-error") {
    return { role: "autofix", reasons: ["TYPE_ERROR_REPAIR"] };
  }
  if (task.failureClass === "runtime-error") {
    return { role: "autofix", reasons: ["RUNTIME_ERROR_REPAIR"] };
  }
  if (!task.mutation) {
    return {
      role: task.riskClass === "high" ? "verifier" : "planner",
      reasons: task.riskClass === "high" ? ["SECURITY_SENSITIVE"] : ["NEW_PRODUCT_PLAN"],
    };
  }
  if (task.newProduct || task.architectureChange) {
    return {
      role: "planner",
      reasons: [
        task.architectureChange ? "COMPLEX_ARCHITECTURE" : "NEW_PRODUCT_PLAN",
        "MULTI_FILE_BUILD",
      ],
    };
  }
  if (
    (task.expectedFiles ?? Number.POSITIVE_INFINITY) <= 4 &&
    (task.expectedChangedLines ?? Number.POSITIVE_INFINITY) <= 160 &&
    !(task.requestedIntegrations?.length)
  ) {
    return { role: "quick-edit", reasons: ["SMALL_LOCAL_EDIT"] };
  }
  return { role: "coder", reasons: ["MULTI_FILE_BUILD"] };
}

function supportsRole(profile: ModelCapabilityProfile, role: AgentModelRole): boolean {
  if (!profile.allowedRoles.includes(role)) return false;
  if (["planner", "quick-edit", "verifier", "router"].includes(role)) {
    if (profile.supportsStructuredOutput !== true) return false;
  }
  if (["coder", "quick-edit", "autofix"].includes(role)) {
    if (profile.supportsTools !== true) return false;
  }
  return true;
}

function qualityScore(profile: ModelCapabilityProfile): number {
  return { frontier: 3, standard: 2, utility: 1, unknown: 0 }[profile.qualityClass];
}

function latencyScore(profile: ModelCapabilityProfile): number {
  return { fast: 3, balanced: 2, slow: 1, unknown: 0 }[profile.latencyClass];
}

function inputCost(profile: ModelCapabilityProfile): number {
  return profile.cost.inputPerMillion ?? Number.POSITIVE_INFINITY;
}

function compareProfiles(
  left: ModelCapabilityProfile,
  right: ModelCapabilityProfile,
  mode: ModelRoutingRequest["mode"],
): number {
  if (mode === "auto-quality") {
    return (
      qualityScore(right) - qualityScore(left) ||
      inputCost(left) - inputCost(right) ||
      modelRegistryKey(left.provider, left.model).localeCompare(
        modelRegistryKey(right.provider, right.model),
      )
    );
  }
  if (mode === "auto-economy") {
    return (
      inputCost(left) - inputCost(right) ||
      latencyScore(right) - latencyScore(left) ||
      qualityScore(right) - qualityScore(left) ||
      modelRegistryKey(left.provider, left.model).localeCompare(
        modelRegistryKey(right.provider, right.model),
      )
    );
  }
  return (
    qualityScore(right) - qualityScore(left) ||
    latencyScore(right) - latencyScore(left) ||
    inputCost(left) - inputCost(right) ||
    modelRegistryKey(left.provider, left.model).localeCompare(
      modelRegistryKey(right.provider, right.model),
    )
  );
}

function routeId(request: ModelRoutingRequest, profile: ModelCapabilityProfile): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: request.policyVersion,
        mode: request.mode,
        task: request.task,
        provider: profile.provider,
        model: profile.model,
      }),
    )
    .digest("hex")
    .slice(0, 24);
}

export function routeModel(
  registry: AuthorizedModelRegistry,
  request: ModelRoutingRequest,
  circuitBreaker?: ModelRoleCircuitBreaker,
): ModelRouteDecision {
  const classification = classify(request);
  const requiredContext = Math.max(1_024, request.task.requiredContextTokens ?? 8_000);
  let candidates = registry
    .listAuthorized(classification.role)
    .filter((profile) => supportsRole(profile, classification.role))
    .filter(
      (profile) =>
        profile.maxContextTokens === null || profile.maxContextTokens >= requiredContext,
    )
    .filter((profile) => !request.task.needsVision || profile.supportsVision === true)
    .filter(
      (profile) =>
        !circuitBreaker?.isOpen(classification.role, {
          provider: profile.provider,
          model: profile.model,
        }),
    );

  if (request.mode === "selected-only") {
    if (!request.selected) {
      throw new ModelRoutingError(
        "SELECTED_MODEL_UNAVAILABLE",
        "Selected-only routing requires an explicit model.",
        true,
      );
    }
    const selected = registry.get(request.selected.provider, request.selected.model);
    if (!selected?.authorized || selected.unavailableReason) {
      throw new ModelRoutingError(
        "SELECTED_MODEL_UNAVAILABLE",
        "The selected model is not currently authorized and available.",
        true,
      );
    }
    if (!supportsRole(selected, classification.role)) {
      throw new ModelRoutingError(
        "CAPABILITY_MISMATCH",
        "The selected model does not have verified capabilities for this role.",
        true,
      );
    }
    if (circuitBreaker?.isOpen(classification.role, request.selected)) {
      throw new ModelRoutingError(
        "SELECTED_MODEL_UNAVAILABLE",
        "The selected model is temporarily unavailable for this role.",
        true,
      );
    }
    candidates = [selected];
    classification.reasons.push("SELECTED_MODEL_ONLY");
  }

  if (request.maxInputCostPerMillion !== null && request.maxInputCostPerMillion !== undefined) {
    candidates = candidates.filter(
      (profile) =>
        profile.cost.inputPerMillion !== null &&
        profile.cost.inputPerMillion <= request.maxInputCostPerMillion!,
    );
  }
  if (!candidates.length) {
    throw new ModelRoutingError(
      request.maxInputCostPerMillion !== null &&
        request.maxInputCostPerMillion !== undefined
        ? "BUDGET_EXCEEDED"
        : "NO_AUTHORIZED_MODEL",
      "No authorized model satisfies the required role capabilities and policy.",
      true,
    );
  }
  candidates.sort((left, right) => compareProfiles(left, right, request.mode));
  const selected = candidates[0];
  const fallbackChain = request.mode === "selected-only"
    ? []
    : candidates.slice(1, 4).map((profile) => ({
        provider: profile.provider,
        model: profile.model,
      }));
  const reasonCodes = [...new Set([
    ...classification.reasons,
    ...(request.task.needsVision ? ["VISION_REQUIRED" as const] : []),
    ...(requiredContext > 32_000 ? ["LONG_CONTEXT_REQUIRED" as const] : []),
    ...(request.mode === "auto-economy" ? ["LOW_COST_REQUESTED" as const] : []),
    ...(fallbackChain.length ? ["FALLBACK_AUTHORIZED" as const] : []),
  ])];
  return {
    routeId: routeId(request, selected),
    primaryRole: classification.role,
    provider: selected.provider,
    model: selected.model,
    fallbackChain,
    contextBudgetTokens: Math.min(
      selected.maxContextTokens ?? Math.max(requiredContext, 16_000),
      Math.max(requiredContext, 16_000),
    ),
    outputBudgetTokens: Math.min(selected.maxOutputTokens ?? 8_000, 24_000),
    maxToolRounds: classification.role === "quick-edit" ? 4 : classification.role === "planner" ? 4 : 16,
    maxRepairRounds: 3,
    reasonCodes,
    estimatedCostBand: estimatedCostBand(selected),
    requiresUserConfirmation:
      request.mode === "auto-quality" && estimatedCostBand(selected) === "high",
    policyVersion: request.policyVersion,
  };
}
