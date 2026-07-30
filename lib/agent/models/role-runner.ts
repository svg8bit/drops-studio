import { AuthorizedModelRegistry } from "./capability-registry.ts";
import { ModelRoleCircuitBreaker } from "./circuit-breaker.ts";
import { estimateModelCostUsd } from "./usage.ts";
import type {
  ModelRouteDecision,
  ModelUsage,
  RoleAttemptTrace,
} from "./types.ts";

export interface RoleInvocationResult<T> {
  output: T;
  usage: ModelUsage | null;
}

export class RoleInvocationError extends Error {
  readonly errorClass: "transient" | "permanent";

  constructor(
    message: string,
    errorClass: "transient" | "permanent",
  ) {
    super(message);
    this.name = "RoleInvocationError";
    this.errorClass = errorClass;
  }
}

export class RoutedRoleExecutionError extends Error {
  readonly code:
    | "HIGH_COST_CONFIRMATION_REQUIRED"
    | "ALL_CANDIDATES_SKIPPED"
    | "ALL_CANDIDATES_FAILED";
  readonly trace: RoleAttemptTrace[];
  readonly lastError: unknown;

  constructor(input: {
    code: RoutedRoleExecutionError["code"];
    message: string;
    trace: RoleAttemptTrace[];
    lastError?: unknown;
  }) {
    super(input.message);
    this.name = "RoutedRoleExecutionError";
    this.code = input.code;
    this.trace = structuredClone(input.trace);
    this.lastError = input.lastError ?? null;
  }
}

export async function executeRoutedRole<T>(input: {
  route: ModelRouteDecision;
  registry: AuthorizedModelRegistry;
  circuitBreaker?: ModelRoleCircuitBreaker;
  invoke: (input: {
    provider: ModelRouteDecision["provider"];
    model: string;
    role: ModelRouteDecision["primaryRole"];
    attempt: number;
    fallback: boolean;
  }) => Promise<RoleInvocationResult<T>>;
  userConfirmedHighCost?: boolean;
  now?: () => Date;
}): Promise<{ output: T; trace: RoleAttemptTrace[] }> {
  if (input.route.requiresUserConfirmation && input.userConfirmedHighCost !== true) {
    throw new RoutedRoleExecutionError({
      code: "HIGH_COST_CONFIRMATION_REQUIRED",
      message: "This high-cost model route requires explicit user confirmation before execution.",
      trace: [],
    });
  }
  const now = input.now ?? (() => new Date());
  const breaker = input.circuitBreaker ?? new ModelRoleCircuitBreaker();
  const routedRefs = [
    { provider: input.route.provider, model: input.route.model },
    ...input.route.fallbackChain,
  ];
  const refs = input.route.reasonCodes.includes("SELECTED_MODEL_ONLY")
    ? routedRefs.slice(0, 1)
    : routedRefs;
  const trace: RoleAttemptTrace[] = [];
  let lastError: unknown = null;
  let invocationCount = 0;
  for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
    const ref = refs[refIndex];
    const profile = input.registry.get(ref.provider, ref.model);
    const skipReason = breaker.isOpen(input.route.primaryRole, ref)
      ? "circuit-open" as const
      : !profile?.authorized
        ? "unauthorized" as const
        : null;
    if (skipReason) {
      const skippedAt = now().toISOString();
      trace.push({
        role: input.route.primaryRole,
        ...ref,
        attempt: trace.length + 1,
        fallback: refIndex > 0,
        startedAt: skippedAt,
        finishedAt: skippedAt,
        durationMs: 0,
        status: "skipped",
        skipReason,
        errorClass: null,
        usage: null,
        estimatedCostUsd: null,
      });
      continue;
    }
    if (!profile?.authorized) {
      throw new Error("Routed model authorization changed during execution.");
    }
    for (let retry = 0; retry < 2; retry += 1) {
      const attempt = trace.length + 1;
      const started = now();
      invocationCount += 1;
      try {
        const result = await input.invoke({
          ...ref,
          role: input.route.primaryRole,
          attempt,
          fallback: refIndex > 0,
        });
        const finished = now();
        trace.push({
          role: input.route.primaryRole,
          ...ref,
          attempt,
          fallback: refIndex > 0,
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          status: "succeeded",
          skipReason: null,
          errorClass: null,
          usage: result.usage,
          estimatedCostUsd: result.usage
            ? estimateModelCostUsd(profile, result.usage)
            : null,
        });
        breaker.recordSuccess(input.route.primaryRole, ref);
        return { output: result.output, trace };
      } catch (error) {
        lastError = error;
        const errorClass = error instanceof RoleInvocationError
          ? error.errorClass
          : "permanent";
        const finished = now();
        trace.push({
          role: input.route.primaryRole,
          ...ref,
          attempt,
          fallback: refIndex > 0,
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          status: "failed",
          skipReason: null,
          errorClass,
          usage: null,
          estimatedCostUsd: null,
        });
        breaker.recordFailure(input.route.primaryRole, ref, errorClass);
        if (errorClass !== "transient") break;
      }
    }
  }
  if (invocationCount === 0) {
    throw new RoutedRoleExecutionError({
      code: "ALL_CANDIDATES_SKIPPED",
      message: "Every routed model was skipped because it was unauthorized or its role circuit was open.",
      trace,
    });
  }
  throw new RoutedRoleExecutionError({
    code: "ALL_CANDIDATES_FAILED",
    message: lastError instanceof Error
      ? `Every authorized routed model failed: ${lastError.message}`
      : "Every authorized routed model failed.",
    trace,
    lastError,
  });
}
