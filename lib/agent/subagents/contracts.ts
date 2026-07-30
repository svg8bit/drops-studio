import type {
  RoleCapability,
  RoleContext,
  RoleExecutionCallback,
  RoleResult,
  SubagentRole,
} from "../orchestrator/types.ts";

export interface SubagentContract {
  role: SubagentRole;
  mutation: "none" | "patch-proposal-only";
  capabilities: readonly RoleCapability[];
  maxTools: number;
  externalMutation: false;
}

export function createBoundedSubagent<T extends RoleResult>(input: {
  contract: SubagentContract;
  execute: (context: RoleContext) => Promise<T>;
}): RoleExecutionCallback {
  return async (context) => {
    if (context.task.role !== input.contract.role) {
      throw new Error(`${input.contract.role} runner cannot execute ${context.task.role} task ${context.task.taskId}.`);
    }
    for (const capability of context.capabilities) {
      if (!input.contract.capabilities.includes(capability)) {
        throw new Error(`${input.contract.role} received unauthorized capability ${capability}.`);
      }
    }
    if (context.task.limits.maxToolCalls > input.contract.maxTools) {
      throw new Error(`${input.contract.role} task exceeds its role tool budget.`);
    }
    return input.execute(context);
  };
}
