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
  now?: () => Date;
}): Promise<{ output: T; trace: RoleAttemptTrace[] }> {
  const now = input.now ?? (() => new Date());
  const breaker = input.circuitBreaker ?? new ModelRoleCircuitBreaker();
  const refs = [
    { provider: input.route.provider, model: input.route.model },
    ...input.route.fallbackChain,
  ];
  const trace: RoleAttemptTrace[] = [];
  let lastError: unknown = null;
  for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
    const ref = refs[refIndex];
    if (breaker.isOpen(input.route.primaryRole, ref)) continue;
    const profile = input.registry.get(ref.provider, ref.model);
    if (!profile?.authorized) continue;
    for (let retry = 0; retry < 2; retry += 1) {
      const attempt = trace.length + 1;
      const started = now();
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
          errorClass,
          usage: null,
          estimatedCostUsd: null,
        });
        breaker.recordFailure(input.route.primaryRole, ref, errorClass);
        if (errorClass !== "transient") break;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Every authorized routed model failed.");
}
