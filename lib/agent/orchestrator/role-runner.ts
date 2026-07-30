import type { ProjectV2 } from "../../project-v2-types.ts";
import { pathWithinScopes } from "./scopes.ts";
import type {
  AgentTask,
  RoleCapability,
  RoleContext,
  RoleExecutionCallback,
  RoleResult,
} from "./types.ts";

function deepFreeze<T>(value: T): T {
  // AbortSignal has mutable runtime slots owned by AbortController. Freezing it
  // would break cancellation; it carries no project data and is safe to pass through.
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return value;
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

export function roleCapabilities(task: AgentTask): RoleCapability[] {
  if (task.role === "planner") return ["list-files", "read-file"];
  if (task.role === "qa" || task.role === "security") {
    return ["list-files", "read-file", "report-findings"];
  }
  return ["list-files", "read-file", "propose-patch"];
}

export function createRoleContext(input: {
  project: ProjectV2;
  task: AgentTask;
  signal: AbortSignal;
}): RoleContext {
  const scopes = [...input.task.readScopes, ...input.task.writeScopes];
  const files = Object.fromEntries(
    Object.entries(input.project.files)
      .filter(([path]) => pathWithinScopes(path, scopes))
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([path, file]) => [path, { path, content: file.content, hash: file.hash }]),
  );
  return deepFreeze({
    runId: input.task.runId,
    task: structuredClone(input.task),
    projectId: input.project.id,
    baseRevision: input.project.revision,
    baseContentHash: input.project.contentHash,
    files,
    contextQueryIds: [...input.task.contextQueryIds],
    selectedSkills: [...input.task.selectedSkills],
    integrationScopes: [...input.task.integrationScopes],
    acceptanceChecks: [...input.task.acceptanceChecks],
    capabilities: roleCapabilities(input.task),
    signal: input.signal,
  });
}

function assertRoleResult(task: AgentTask, result: RoleResult): void {
  if (!result || typeof result !== "object") throw new Error(`Task ${task.taskId} returned no structured result.`);
  if (task.role === "planner" && !("taskGraph" in result)) throw new Error("Planner must return a task graph.");
  if ((task.role === "frontend" || task.role === "backend" || task.role === "integration") && !("patchBundle" in result)) {
    throw new Error(`${task.role} must return a patch bundle.`);
  }
  if (task.role === "qa" && (!("findings" in result) || !("primaryFlowStatus" in result))) {
    throw new Error("QA must return structured findings.");
  }
  if (task.role === "security" && (!("findings" in result) || !("blocked" in result))) {
    throw new Error("Security must return structured findings.");
  }
  if ((task.role === "qa" || task.role === "security" || task.role === "planner") && "patchBundle" in result) {
    throw new Error(`${task.role} cannot return mutations.`);
  }
}

export async function runRoleTask(input: {
  project: ProjectV2;
  task: AgentTask;
  signal: AbortSignal;
  execute: RoleExecutionCallback;
}): Promise<RoleResult> {
  const context = createRoleContext(input);
  const result = await input.execute(context);
  assertRoleResult(input.task, result);
  return structuredClone(result);
}
