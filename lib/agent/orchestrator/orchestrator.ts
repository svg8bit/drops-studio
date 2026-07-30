import { FileLeaseRegistry } from "./file-leases.ts";
import { mergePatchBundlesAtomically } from "./merge-gate.ts";
import { runRoleTask } from "./role-runner.ts";
import { DEFAULT_SCHEDULER_LIMITS, runDeterministicScheduler } from "./scheduler.ts";
import { scopesOverlap } from "./scopes.ts";
import { validateTaskGraph } from "./task-graph.ts";
import { MemoryAgentRunStore, type AgentRunStore } from "./run-store.ts";
import type {
  AgentRunState,
  AgentTask,
  BuilderSubagentResult,
  Finding,
  PlannerResult,
  QaResult,
  RoleExecutionCallback,
  SchedulerLimits,
  SecurityResult,
  SubagentRole,
} from "./types.ts";
import type { ProjectV2 } from "../../project-v2-types.ts";

export type RoleRunnerRegistry = Partial<Record<SubagentRole, RoleExecutionCallback>>;

interface OrchestratorOptions {
  store?: AgentRunStore;
  limits?: Partial<SchedulerLimits>;
  now?: () => Date;
}

export interface StartAgentRunInput {
  runId: string;
  project: ProjectV2;
  plannerTask: AgentTask;
  runners: RoleRunnerRegistry;
}

function selectDisjointWave(tasks: readonly AgentTask[], limit: number): AgentTask[] {
  const ordered = [...tasks].sort((left, right) => right.priority - left.priority || left.taskId.localeCompare(right.taskId, "en"));
  const selected: AgentTask[] = [];
  for (const task of ordered) {
    if (selected.length >= limit) break;
    if (selected.some((entry) => scopesOverlap(entry.writeScopes, task.writeScopes))) continue;
    selected.push(task);
  }
  return selected;
}

function rebaseTask(task: AgentTask, project: ProjectV2, dependencies: string[] = []): AgentTask {
  return {
    ...structuredClone(task),
    dependencies,
    baseRevision: project.revision,
    baseContentHash: project.contentHash,
    status: "queued",
  };
}

function updateTaskStatus(tasks: AgentTask[], taskIds: readonly string[], status: AgentTask["status"]): AgentTask[] {
  const ids = new Set(taskIds);
  return tasks.map((task) => (ids.has(task.taskId) ? { ...task, status } : task));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Subagent run failed.";
}

function assertRunBudgets(
  tasks: readonly AgentTask[],
  plannerTask: AgentTask,
  overrides: Partial<SchedulerLimits>,
): void {
  const limits = { ...DEFAULT_SCHEDULER_LIMITS, ...overrides };
  if (tasks.some((task) => task.role === "planner")) {
    throw new Error("Planner task graph must contain delegated work only.");
  }
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const builderRoles = new Set<SubagentRole>(["frontend", "backend", "integration"]);
  for (const task of tasks) {
    if (!builderRoles.has(task.role)) continue;
    const invalid = task.dependencies.find((dependency) => !builderRoles.has(byId.get(dependency)?.role as SubagentRole));
    if (invalid) throw new Error(`Builder task ${task.taskId} cannot depend on reviewer task ${invalid}.`);
  }
  if (tasks.length + 1 > limits.maxTotalRoleCallsPerRun) {
    throw new Error("Planned run exceeds the total role-call budget.");
  }
  const modelCalls = plannerTask.limits.maxModelCalls + tasks.reduce((total, task) => total + task.limits.maxModelCalls, 0);
  if (modelCalls > limits.maxTotalRoleCallsPerRun) {
    throw new Error("Planned run exceeds the total model-call budget.");
  }
  const cost = plannerTask.estimatedCostUsd + tasks.reduce((total, task) => total + task.estimatedCostUsd, 0);
  if (cost > limits.maxEstimatedCostUsd) throw new Error("Planned run exceeds the estimated cost budget.");
}

export class MultiAgentOrchestrator {
  readonly #store: AgentRunStore;
  readonly #limits: Partial<SchedulerLimits>;
  readonly #now: () => Date;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: OrchestratorOptions = {}) {
    this.#store = options.store ?? new MemoryAgentRunStore();
    this.#limits = options.limits ?? {};
    this.#now = options.now ?? (() => new Date());
  }

  async run(input: StartAgentRunInput): Promise<AgentRunState> {
    if (input.plannerTask.role !== "planner" || input.plannerTask.runId !== input.runId) {
      throw new Error("Agent run requires a matching Planner task.");
    }
    const planner = input.runners.planner;
    if (!planner) throw new Error("Planner runner is unavailable.");
    if (this.#controllers.has(input.runId)) {
      throw new Error(`Agent run ${input.runId} is already active.`);
    }
    const controller = new AbortController();
    this.#controllers.set(input.runId, controller);
    const createdAt = this.#now().toISOString();
    let state: AgentRunState = {
      runId: input.runId,
      status: "planning",
      canonicalProject: structuredClone(input.project),
      tasks: [],
      timelines: [],
      findings: [],
      createdAt,
      updatedAt: createdAt,
    };
    await this.#store.save(state);
    try {
      const plannerTask = rebaseTask(input.plannerTask, input.project);
      const result = await runRoleTask({
        project: input.project,
        task: plannerTask,
        signal: controller.signal,
        execute: planner,
      });
      const plan = result as PlannerResult;
      const tasks = validateTaskGraph(plan.taskGraph);
      if (tasks.some((task) => task.runId !== input.runId)) throw new Error("Planner emitted tasks for another run.");
      if (
        tasks.some(
          (task) =>
            task.baseRevision !== input.project.revision ||
            task.baseContentHash !== input.project.contentHash,
        )
      ) {
        throw new Error("Planner emitted a task graph from a stale canonical Project V2 revision.");
      }
      assertRunBudgets(tasks, plannerTask, this.#limits);
      state = { ...state, tasks, status: "building", updatedAt: this.#now().toISOString() };
      await this.#store.save(state);
      return await this.#executePlan(state, input.runners, controller);
    } catch (error) {
      state = (await this.#store.get(input.runId)) ?? state;
      state = {
        ...state,
        status: controller.signal.aborted ? "cancelled" : "failed",
        failure: errorMessage(error),
        updatedAt: this.#now().toISOString(),
      };
      await this.#store.save(state);
      return state;
    } finally {
      this.#controllers.delete(input.runId);
    }
  }

  async resume(runId: string, runners: RoleRunnerRegistry): Promise<AgentRunState> {
    if (this.#controllers.has(runId)) {
      throw new Error(`Agent run ${runId} is already active.`);
    }
    const stored = await this.#store.get(runId);
    if (!stored) throw new Error(`Agent run ${runId} was not found.`);
    if (stored.status === "completed") return stored;
    if (!stored.tasks.length) {
      throw new Error(`Agent run ${runId} has no task graph and must be planned again.`);
    }
    const controller = new AbortController();
    this.#controllers.set(runId, controller);
    const tasks = stored.tasks.map((task) =>
      task.status === "merged" ? task : { ...task, status: "queued" as const },
    );
    const state = {
      ...stored,
      tasks,
      status: "building" as const,
      failure: undefined,
      updatedAt: this.#now().toISOString(),
    };
    await this.#store.save(state);
    try {
      return await this.#executePlan(state, runners, controller);
    } catch (error) {
      const latest = (await this.#store.get(runId)) ?? state;
      const failed: AgentRunState = {
        ...latest,
        status: controller.signal.aborted ? "cancelled" : "failed",
        failure: errorMessage(error),
        updatedAt: this.#now().toISOString(),
      };
      await this.#store.save(failed);
      return failed;
    } finally {
      this.#controllers.delete(runId);
    }
  }

  cancel(runId: string, reason = "User cancelled the agent run."): boolean {
    const controller = this.#controllers.get(runId);
    if (!controller) return false;
    controller.abort(new Error(reason));
    return true;
  }

  get(runId: string): Promise<AgentRunState | null> {
    return this.#store.get(runId);
  }

  async #executePlan(
    initial: AgentRunState,
    runners: RoleRunnerRegistry,
    controller: AbortController,
  ): Promise<AgentRunState> {
    let state = structuredClone(initial);
    let project = structuredClone(state.canonicalProject);
    const completed = new Set(state.tasks.filter((task) => task.status === "merged").map((task) => task.taskId));
    const builderRoles = new Set<SubagentRole>(["frontend", "backend", "integration"]);
    const builderTasks = state.tasks.filter((task) => builderRoles.has(task.role) && !completed.has(task.taskId));
    const builderIds = new Set(state.tasks.filter((task) => builderRoles.has(task.role)).map((task) => task.taskId));

    while ([...builderIds].some((taskId) => !completed.has(taskId))) {
      if (controller.signal.aborted) return await this.#cancelledState(state);
      const ready = builderTasks.filter(
        (task) =>
          !completed.has(task.taskId) &&
          task.dependencies.every((dependency) => completed.has(dependency)),
      );
      if (!ready.length) {
        throw new Error("Builder DAG is blocked by a non-builder or failed dependency.");
      }
      const wave = selectDisjointWave(
        ready,
        this.#limits.maxActiveSubagents ?? DEFAULT_SCHEDULER_LIMITS.maxActiveSubagents,
      );
      const rebased = wave.map((task) => rebaseTask(task, project));
      const scheduled = await runDeterministicScheduler(
        rebased,
        async (task, signal) => {
          const runner = runners[task.role];
          if (!runner) throw new Error(`${task.role} runner is unavailable.`);
          return runRoleTask({ project, task, signal, execute: runner });
        },
        { limits: this.#limits, signal: controller.signal, now: this.#now },
      );
      state.timelines.push(...scheduled.timelines);
      const failures = rebased.filter((task) => scheduled.statuses.get(task.taskId) !== "merged");
      if (failures.length) {
        state.tasks = updateTaskStatus(state.tasks, failures.map((task) => task.taskId), controller.signal.aborted ? "cancelled" : "failed");
        return await this.#failedState(state, controller.signal.aborted ? "Agent run cancelled." : `Builder tasks failed: ${failures.map((task) => task.taskId).join(", ")}.`, controller.signal.aborted);
      }
      const leases = new FileLeaseRegistry(this.#now);
      const proposals = rebased.map((task) => {
        const result = scheduled.results.get(task.taskId) as BuilderSubagentResult;
        const lease = leases.reserve(task);
        if (!lease) throw new Error(`Task ${task.taskId} did not receive a write lease.`);
        return { task, lease, bundle: result.patchBundle };
      });
      const merged = await mergePatchBundlesAtomically({ project, proposals, now: this.#now });
      proposals.forEach(({ task }) => leases.release(task.taskId));
      if (merged.status === "rerun-required") {
        state.tasks = updateTaskStatus(state.tasks, merged.taskIds, "waiting");
        return await this.#failedState(state, `${merged.code}: ${merged.reason}`, false);
      }
      project = merged.project;
      for (const taskId of merged.mergedTaskIds) completed.add(taskId);
      state.tasks = updateTaskStatus(state.tasks, merged.mergedTaskIds, "merged");
      state = {
        ...state,
        canonicalProject: structuredClone(project),
        mergeRevision: project.revision,
        updatedAt: this.#now().toISOString(),
      };
      await this.#store.save(state);
    }

    state.status = "reviewing";
    const reviewerTasks = state.tasks.filter(
      (task) => (task.role === "qa" || task.role === "security") && !completed.has(task.taskId),
    );
    if (reviewerTasks.length) {
      const reviewerIds = new Set(reviewerTasks.map((task) => task.taskId));
      const readyReviewers = reviewerTasks.filter((task) =>
        task.dependencies
          .filter((dependency) => !reviewerIds.has(dependency))
          .every((dependency) => completed.has(dependency)),
      );
      if (readyReviewers.length !== reviewerTasks.length) throw new Error("Reviewer DAG is blocked by an unmet builder dependency.");
      const rebased = readyReviewers.map((task) =>
        rebaseTask(task, project, task.dependencies.filter((dependency) => reviewerIds.has(dependency))),
      );
      const reviewed = await runDeterministicScheduler(
        rebased,
        async (task, signal) => {
          const runner = runners[task.role];
          if (!runner) throw new Error(`${task.role} runner is unavailable.`);
          return runRoleTask({ project, task, signal, execute: runner });
        },
        { limits: this.#limits, signal: controller.signal, now: this.#now },
      );
      state.timelines.push(...reviewed.timelines);
      const failures = rebased.filter((task) => reviewed.statuses.get(task.taskId) !== "merged");
      if (failures.length) {
        state.tasks = updateTaskStatus(state.tasks, failures.map((task) => task.taskId), controller.signal.aborted ? "cancelled" : "failed");
        return await this.#failedState(state, `Reviewer tasks failed: ${failures.map((task) => task.taskId).join(", ")}.`, controller.signal.aborted);
      }
      const findings: Finding[] = [];
      let reviewBlocked = false;
      for (const task of rebased) {
        const result = reviewed.results.get(task.taskId);
        if (task.role === "qa") {
          const qa = result as QaResult;
          findings.push(...qa.findings);
          reviewBlocked ||= qa.primaryFlowStatus === "failed";
        } else {
          const security = result as SecurityResult;
          findings.push(...security.findings);
          reviewBlocked ||= security.blocked;
        }
      }
      state.findings = findings;
      reviewBlocked ||= findings.some((finding) => finding.blocksVerification || finding.severity === "critical");
      if (reviewBlocked) {
        state.tasks = updateTaskStatus(
          state.tasks,
          rebased.map((task) => task.taskId),
          "failed",
        );
        state.canonicalProject = project;
        return await this.#failedState(state, "QA or Security evidence blocks verification.", false);
      }
      for (const task of rebased) completed.add(task.taskId);
      state.tasks = updateTaskStatus(state.tasks, rebased.map((task) => task.taskId), "merged");
    }
    state = {
      ...state,
      canonicalProject: project,
      status: "completed",
      updatedAt: this.#now().toISOString(),
    };
    await this.#store.save(state);
    return structuredClone(state);
  }

  async #cancelledState(state: AgentRunState): Promise<AgentRunState> {
    return this.#failedState(state, "Agent run cancelled.", true);
  }

  async #failedState(state: AgentRunState, failure: string, cancelled: boolean): Promise<AgentRunState> {
    const next: AgentRunState = {
      ...state,
      status: cancelled ? "cancelled" : "failed",
      failure,
      updatedAt: this.#now().toISOString(),
    };
    await this.#store.save(next);
    return structuredClone(next);
  }
}
