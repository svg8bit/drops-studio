import { FileLeaseRegistry } from "./file-leases.ts";
import { scopesOverlap } from "./scopes.ts";
import { readyTasks, validateTaskGraph } from "./task-graph.ts";
import type {
  AgentTask,
  AgentTaskStatus,
  AgentTaskTimeline,
  SchedulerLimits,
  SchedulerResult,
} from "./types.ts";

export const DEFAULT_SCHEDULER_LIMITS: SchedulerLimits = {
  maxActiveSubagents: 3,
  maxParallelModelCalls: 3,
  maxTotalRoleCallsPerRun: 12,
  maxEstimatedCostUsd: 5,
};

export class AgentSchedulerLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSchedulerLimitError";
  }
}

interface SchedulerOptions {
  limits?: Partial<SchedulerLimits>;
  signal?: AbortSignal;
  now?: () => Date;
  leases?: FileLeaseRegistry;
}

function selectWave(tasks: readonly AgentTask[], limit: number): AgentTask[] {
  const selected: AgentTask[] = [];
  for (const task of tasks) {
    if (selected.length >= limit) break;
    if (selected.some((active) => scopesOverlap(active.writeScopes, task.writeScopes))) continue;
    selected.push(task);
  }
  return selected;
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "Agent run cancelled.");
}

const MAX_TIMEOUT_MS = 2_147_483_647;

async function executeWithBoundary<T>(input: {
  task: AgentTask;
  runSignal?: AbortSignal;
  execute: (task: AgentTask, signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(input.runSignal?.reason ?? new Error("Agent run cancelled."));
  if (input.runSignal?.aborted) cancel();
  else input.runSignal?.addEventListener("abort", cancel, { once: true });
  const requestedTimeout = input.task.limits.timeoutMs;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(1, requestedTimeout), MAX_TIMEOUT_MS)
    : MAX_TIMEOUT_MS;
  const timeout = setTimeout(
    () => controller.abort(new Error(`Task ${input.task.taskId} exceeded ${input.task.limits.timeoutMs}ms.`)),
    timeoutMs,
  );
  try {
    return await Promise.race([
      input.execute(input.task, controller.signal),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(abortError(controller.signal.reason));
        else controller.signal.addEventListener("abort", () => reject(abortError(controller.signal.reason)), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    input.runSignal?.removeEventListener("abort", cancel);
  }
}

function blockDependents(tasks: readonly AgentTask[], statuses: Map<string, AgentTaskStatus>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      const status = statuses.get(task.taskId);
      if (status === "merged" || status === "failed" || status === "cancelled" || status === "blocked") continue;
      if (task.dependencies.some((dependency) => {
        const dependencyStatus = statuses.get(dependency);
        return dependencyStatus === "failed" || dependencyStatus === "cancelled" || dependencyStatus === "blocked";
      })) {
        statuses.set(task.taskId, "blocked");
        changed = true;
      }
    }
  }
}

export async function runDeterministicScheduler<T>(
  inputTasks: readonly AgentTask[],
  execute: (task: AgentTask, signal: AbortSignal) => Promise<T>,
  options: SchedulerOptions = {},
): Promise<SchedulerResult<T>> {
  const tasks = validateTaskGraph(inputTasks);
  const limits = { ...DEFAULT_SCHEDULER_LIMITS, ...options.limits };
  if (
    limits.maxActiveSubagents < 1 ||
    limits.maxActiveSubagents > 3 ||
    limits.maxParallelModelCalls < 1 ||
    limits.maxParallelModelCalls > 3
  ) {
    throw new AgentSchedulerLimitError("Active subagents and parallel model calls must remain between 1 and 3.");
  }
  const concurrency = Math.min(limits.maxActiveSubagents, limits.maxParallelModelCalls);
  if (tasks.length > limits.maxTotalRoleCallsPerRun) {
    throw new AgentSchedulerLimitError("Task graph exceeds the role-call budget.");
  }
  const modelCalls = tasks.reduce((total, task) => total + task.limits.maxModelCalls, 0);
  if (modelCalls > limits.maxTotalRoleCallsPerRun) {
    throw new AgentSchedulerLimitError("Task graph exceeds the model-call budget.");
  }
  const estimatedCost = tasks.reduce((total, task) => total + task.estimatedCostUsd, 0);
  if (estimatedCost > limits.maxEstimatedCostUsd) {
    throw new AgentSchedulerLimitError("Task graph exceeds the estimated cost budget.");
  }

  const now = options.now ?? (() => new Date());
  const leases = options.leases ?? new FileLeaseRegistry(now);
  const statuses = new Map<string, AgentTaskStatus>(tasks.map((task) => [task.taskId, "queued"]));
  const results = new Map<string, T>();
  const timelines: AgentTaskTimeline[] = [];
  let eventOrder = 0;
  let maxObservedConcurrency = 0;

  while ([...statuses.values()].some((status) => status === "queued" || status === "ready" || status === "waiting")) {
    if (options.signal?.aborted) {
      for (const [taskId, status] of statuses) {
        if (status === "queued" || status === "ready" || status === "waiting") statuses.set(taskId, "cancelled");
      }
      break;
    }
    blockDependents(tasks, statuses);
    const ready = readyTasks(tasks, statuses);
    if (!ready.length) {
      if ([...statuses.values()].some((status) => status === "queued" || status === "ready" || status === "waiting")) {
        throw new Error("Scheduler reached a dependency deadlock.");
      }
      break;
    }
    const wave = selectWave(ready, concurrency);
    if (!wave.length) throw new Error("Scheduler could not create a non-overlapping task wave.");
    maxObservedConcurrency = Math.max(maxObservedConcurrency, wave.length);
    const started = wave.map((task) => {
      statuses.set(task.taskId, "running");
      const lease = leases.reserve(task);
      const timeline: AgentTaskTimeline = {
        taskId: task.taskId,
        role: task.role,
        startedAt: now().toISOString(),
        finishedAt: "",
        startedOrder: ++eventOrder,
        finishedOrder: 0,
        status: "succeeded",
      };
      return { task, lease, timeline };
    });

    const settled = await Promise.all(
      started.map(async ({ task, timeline }) => {
        try {
          const result = await executeWithBoundary({ task, runSignal: options.signal, execute });
          timeline.status = "succeeded";
          return { task, timeline, result, error: null };
        } catch (error) {
          timeline.status = options.signal?.aborted ? "cancelled" : "failed";
          timeline.error = error instanceof Error ? error.message : "Task failed.";
          return { task, timeline, result: undefined, error };
        } finally {
          timeline.finishedAt = now().toISOString();
          timeline.finishedOrder = ++eventOrder;
          leases.release(task.taskId);
        }
      }),
    );

    for (const item of settled.sort((left, right) => left.task.taskId.localeCompare(right.task.taskId, "en"))) {
      timelines.push(item.timeline);
      if (item.error) {
        statuses.set(item.task.taskId, item.timeline.status === "cancelled" ? "cancelled" : "failed");
      } else {
        statuses.set(item.task.taskId, "merged");
        results.set(item.task.taskId, item.result as T);
      }
    }
    blockDependents(tasks, statuses);
  }

  return { results, timelines, statuses, maxObservedConcurrency };
}

export function timelinesOverlap(left: AgentTaskTimeline, right: AgentTaskTimeline): boolean {
  const leftStart = new Date(left.startedAt).getTime();
  const leftEnd = new Date(left.finishedAt).getTime();
  const rightStart = new Date(right.startedAt).getTime();
  const rightEnd = new Date(right.finishedAt).getTime();
  return leftStart <= rightEnd && rightStart <= leftEnd && left.startedOrder < right.finishedOrder && right.startedOrder < left.finishedOrder;
}
