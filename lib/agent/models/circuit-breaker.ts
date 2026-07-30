import { modelRegistryKey } from "./capability-registry.ts";
import type { AgentModelRole, ModelRef } from "./types.ts";

interface CircuitState {
  failures: number;
  openedAt: number | null;
  expiresAt: number | null;
  reason: string | null;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export class ModelRoleCircuitBreaker {
  readonly #states = new Map<string, CircuitState>();
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = Math.max(2, options.failureThreshold ?? 3);
    this.#cooldownMs = Math.max(1_000, options.cooldownMs ?? 60_000);
    this.#now = options.now ?? Date.now;
  }

  #key(role: AgentModelRole, ref: ModelRef): string {
    return `${role}:${modelRegistryKey(ref.provider, ref.model)}`;
  }

  isOpen(role: AgentModelRole, ref: ModelRef): boolean {
    const key = this.#key(role, ref);
    const state = this.#states.get(key);
    if (!state?.expiresAt) return false;
    if (state.expiresAt > this.#now()) return true;
    this.#states.delete(key);
    return false;
  }

  recordFailure(role: AgentModelRole, ref: ModelRef, reason: string): void {
    const key = this.#key(role, ref);
    const previous = this.#states.get(key) ?? {
      failures: 0,
      openedAt: null,
      expiresAt: null,
      reason: null,
    };
    const failures = previous.failures + 1;
    const shouldOpen = failures >= this.#failureThreshold;
    const now = this.#now();
    this.#states.set(key, {
      failures,
      openedAt: shouldOpen ? now : null,
      expiresAt: shouldOpen ? now + this.#cooldownMs : null,
      reason: reason.slice(0, 240),
    });
  }

  recordSuccess(role: AgentModelRole, ref: ModelRef): void {
    this.#states.delete(this.#key(role, ref));
  }

  snapshot(): Array<{
    role: AgentModelRole;
    provider: string;
    model: string;
    failures: number;
    openedAt: number | null;
    expiresAt: number | null;
    reason: string | null;
  }> {
    return [...this.#states.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, state]) => {
        const [role, provider, ...modelParts] = key.split(":");
        return {
          role: role as AgentModelRole,
          provider,
          model: modelParts.join(":"),
          ...state,
        };
      });
  }
}
