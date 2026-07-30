import { z } from "zod";

import { normalizeScopePattern } from "./scopes.ts";
import type { AgentTask } from "./types.ts";

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const stringList = z.array(z.string().min(1).max(240)).max(64);
const integrationScopeList = z
  .array(
    z.string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid integration scope."),
  )
  .max(64);

export const agentTaskSchema = z
  .object({
    taskId: idSchema,
    runId: idSchema,
    role: z.enum(["planner", "frontend", "backend", "integration", "qa", "security"]),
    title: z.string().min(1).max(160),
    objective: z.string().min(1).max(2_000),
    dependencies: z.array(idSchema).max(32),
    priority: z.number().int().min(-100).max(100),
    baseRevision: z.number().int().positive(),
    baseContentHash: hashSchema,
    readScopes: stringList,
    writeScopes: stringList,
    protectedScopes: stringList,
    integrationScopes: integrationScopeList,
    contextQueryIds: z.array(idSchema).max(64),
    selectedSkills: z.array(z.string().min(1).max(128)).max(16),
    modelRouteId: idSchema,
    executionMode: z.enum(["read-only", "patch-only"]),
    acceptanceChecks: stringList,
    expectedArtifacts: stringList,
    risk: z.enum(["low", "medium", "high", "critical"]),
    estimatedCostUsd: z.number().min(0).max(100),
    limits: z
      .object({
        maxModelCalls: z.number().int().min(1).max(12),
        maxToolCalls: z.number().int().min(0).max(100),
        timeoutMs: z.number().int().min(100).max(600_000),
        maxChangedFiles: z.number().int().min(0).max(64),
        maxChangedLines: z.number().int().min(0).max(100_000),
      })
      .strict(),
    status: z.enum([
      "queued",
      "ready",
      "running",
      "waiting",
      "proposed",
      "merged",
      "failed",
      "cancelled",
      "blocked",
    ]),
  })
  .strict();

export class AgentTaskGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskGraphError";
  }
}

function taskCompare(left: AgentTask, right: AgentTask): number {
  return right.priority - left.priority || left.taskId.localeCompare(right.taskId, "en");
}

function assertRoleBoundary(task: AgentTask): void {
  const readOnly = task.role === "planner" || task.role === "qa" || task.role === "security";
  if (readOnly && (task.executionMode !== "read-only" || task.writeScopes.length)) {
    throw new AgentTaskGraphError(`${task.role} task ${task.taskId} must be read-only.`);
  }
  if (!readOnly && task.executionMode !== "patch-only") {
    throw new AgentTaskGraphError(`${task.role} task ${task.taskId} must be patch-only.`);
  }
  if (!readOnly && !task.writeScopes.length) {
    throw new AgentTaskGraphError(`${task.role} task ${task.taskId} requires a bounded write scope.`);
  }
}

export function validateTaskGraph(value: unknown): AgentTask[] {
  const tasks = z.array(agentTaskSchema).min(1).max(64).parse(value) as AgentTask[];
  const ids = new Set<string>();
  const runIds = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.taskId)) throw new AgentTaskGraphError(`Duplicate task ${task.taskId}.`);
    ids.add(task.taskId);
    runIds.add(task.runId);
    task.readScopes.forEach(normalizeScopePattern);
    task.writeScopes.forEach(normalizeScopePattern);
    task.protectedScopes.forEach(normalizeScopePattern);
    assertRoleBoundary(task);
  }
  if (runIds.size !== 1) throw new AgentTaskGraphError("A task graph must belong to one run.");
  for (const task of tasks) {
    const dependencies = new Set(task.dependencies);
    if (dependencies.size !== task.dependencies.length) {
      throw new AgentTaskGraphError(`Task ${task.taskId} repeats a dependency.`);
    }
    if (dependencies.has(task.taskId)) {
      throw new AgentTaskGraphError(`Task ${task.taskId} cannot depend on itself.`);
    }
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) {
        throw new AgentTaskGraphError(`Task ${task.taskId} references unknown dependency ${dependency}.`);
      }
    }
  }
  deterministicTopologicalOrder(tasks);
  return structuredClone(tasks);
}

export function deterministicTopologicalOrder(input: readonly AgentTask[]): AgentTask[] {
  const tasks = [...input];
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const inDegree = new Map(tasks.map((task) => [task.taskId, task.dependencies.length]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.taskId]);
    }
  }
  const ready = tasks.filter((task) => inDegree.get(task.taskId) === 0).sort(taskCompare);
  const ordered: AgentTask[] = [];
  while (ready.length) {
    const task = ready.shift();
    if (!task) break;
    ordered.push(task);
    for (const dependentId of (dependents.get(task.taskId) ?? []).sort()) {
      const degree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, degree);
      if (degree === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(taskCompare);
        }
      }
    }
  }
  if (ordered.length !== tasks.length) {
    const cyclic = tasks
      .filter((task) => !ordered.some((entry) => entry.taskId === task.taskId))
      .map((task) => task.taskId)
      .sort();
    throw new AgentTaskGraphError(`Task graph contains a cycle: ${cyclic.join(", ")}.`);
  }
  return ordered;
}

export function readyTasks(
  tasks: readonly AgentTask[],
  statuses: ReadonlyMap<string, AgentTask["status"]>,
): AgentTask[] {
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  return tasks
    .filter((task) => {
      const status = statuses.get(task.taskId) ?? task.status;
      return (
        (status === "queued" || status === "ready" || status === "waiting") &&
        task.dependencies.every(
          (dependency) =>
            (statuses.get(dependency) ?? taskById.get(dependency)?.status) === "merged",
        )
      );
    })
    .sort(taskCompare);
}
