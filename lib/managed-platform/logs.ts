import { randomUUID } from "node:crypto";
import type { ManagedLogEntry, ManagedPrincipal, ManagedScope } from "./contracts.ts";
import { assertScope, clone, requirePermission, sanitizeLogValue } from "./security.ts";

export class ManagedLogStore {
  private readonly entries = new Map<string, ManagedLogEntry[]>();
  private readonly now: () => Date;
  private readonly maxEntriesPerEnvironment: number;
  constructor(now: () => Date, maxEntriesPerEnvironment = 2_000) {
    this.now = now;
    this.maxEntriesPerEnvironment = maxEntriesPerEnvironment;
  }

  append(scope: ManagedScope, input: Omit<ManagedLogEntry, "id" | "scopeKey" | "createdAt">): ManagedLogEntry {
    const entry: ManagedLogEntry = {
      ...input,
      id: `log_${randomUUID()}`,
      scopeKey: scope.scopeKey,
      metadata: sanitizeLogValue(input.metadata) as Record<string, unknown>,
      createdAt: this.now().toISOString(),
    };
    const current = this.entries.get(scope.scopeKey) ?? [];
    current.push(entry);
    if (current.length > this.maxEntriesPerEnvironment) current.splice(0, current.length - this.maxEntriesPerEnvironment);
    this.entries.set(scope.scopeKey, current);
    return clone(entry);
  }

  list(scope: ManagedScope, principal: ManagedPrincipal, input: { category?: ManagedLogEntry["category"]; severity?: ManagedLogEntry["severity"]; limit?: number } = {}): ManagedLogEntry[] {
    assertScope(scope, principal);
    requirePermission(principal, "backend.logs.read");
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Log query limit is invalid.");
    return clone((this.entries.get(scope.scopeKey) ?? [])
      .filter((entry) => (!input.category || entry.category === input.category) && (!input.severity || entry.severity === input.severity))
      .slice(-limit)
      .reverse());
  }
}
