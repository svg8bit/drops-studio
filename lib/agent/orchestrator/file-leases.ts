import { randomUUID } from "node:crypto";

import { normalizeScopePattern, scopesOverlap } from "./scopes.ts";
import type { AgentTask, FileLease } from "./types.ts";

export class FileLeaseConflictError extends Error {
  readonly conflictingTaskId: string;

  constructor(taskId: string, conflictingTaskId: string) {
    super(`Task ${taskId} overlaps the active file lease for ${conflictingTaskId}.`);
    this.name = "FileLeaseConflictError";
    this.conflictingTaskId = conflictingTaskId;
  }
}

export class FileLeaseRegistry {
  readonly #leases = new Map<string, FileLease>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  list(): FileLease[] {
    this.expire();
    return [...this.#leases.values()]
      .sort((left, right) => left.taskId.localeCompare(right.taskId, "en"))
      .map((lease) => structuredClone(lease));
  }

  reserve(task: AgentTask): FileLease | null {
    if (!task.writeScopes.length) return null;
    this.expire();
    const patterns = task.writeScopes.map(normalizeScopePattern);
    const conflict = [...this.#leases.values()].find(
      (lease) => lease.taskId !== task.taskId && scopesOverlap(patterns, lease.patterns),
    );
    if (conflict) throw new FileLeaseConflictError(task.taskId, conflict.taskId);
    const expiresAt = new Date(this.#now().getTime() + task.limits.timeoutMs + 5_000).toISOString();
    const lease: FileLease = {
      leaseId: randomUUID(),
      taskId: task.taskId,
      baseRevision: task.baseRevision,
      patterns,
      expiresAt,
    };
    this.#leases.set(task.taskId, lease);
    return structuredClone(lease);
  }

  get(taskId: string): FileLease | null {
    this.expire();
    const lease = this.#leases.get(taskId);
    return lease ? structuredClone(lease) : null;
  }

  release(taskId: string): void {
    this.#leases.delete(taskId);
  }

  expire(): void {
    const now = this.#now().getTime();
    for (const [taskId, lease] of this.#leases) {
      if (new Date(lease.expiresAt).getTime() <= now) this.#leases.delete(taskId);
    }
  }
}
