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

export interface BoundedSubagentTools {
  readonly callsUsed: number;
  run<T>(
    capability: RoleCapability,
    operation: () => Promise<T> | T,
  ): Promise<T>;
}

export type BoundedSubagentExecutor<T extends RoleResult> = (
  context: RoleContext,
  tools: BoundedSubagentTools,
) => Promise<T>;

function assertRuntimeContract(
  contract: SubagentContract,
  context: RoleContext,
): void {
  if (contract.externalMutation !== false) {
    throw new Error(`${contract.role} contract cannot authorize external mutation.`);
  }
  if (!Number.isSafeInteger(contract.maxTools) || contract.maxTools < 0) {
    throw new Error(`${contract.role} contract has an invalid tool budget.`);
  }
  if (contract.mutation === "none") {
    if (
      context.task.executionMode !== "read-only" ||
      context.task.writeScopes.length > 0 ||
      contract.capabilities.includes("propose-patch")
    ) {
      throw new Error(`${contract.role} read-only contract cannot propose mutations.`);
    }
    return;
  }
  if (
    context.task.executionMode !== "patch-only" ||
    !contract.capabilities.includes("propose-patch")
  ) {
    throw new Error(`${contract.role} patch contract must remain proposal-only.`);
  }
}

function boundedTools(
  contract: SubagentContract,
  context: RoleContext,
): BoundedSubagentTools {
  let callsUsed = 0;
  const maxTools = Math.min(contract.maxTools, context.task.limits.maxToolCalls);
  return Object.freeze({
    get callsUsed() {
      return callsUsed;
    },
    async run<T>(
      capability: RoleCapability,
      operation: () => Promise<T> | T,
    ): Promise<T> {
      if (
        !context.capabilities.includes(capability) ||
        !contract.capabilities.includes(capability)
      ) {
        throw new Error(`${contract.role} cannot invoke unauthorized capability ${capability}.`);
      }
      callsUsed += 1;
      if (callsUsed > maxTools) {
        throw new Error(`${contract.role} exceeded its actual tool-call budget of ${maxTools}.`);
      }
      return await operation();
    },
  });
}

export function createBoundedSubagent<T extends RoleResult>(input: {
  contract: SubagentContract;
  execute: BoundedSubagentExecutor<T>;
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
    assertRuntimeContract(input.contract, context);
    if (context.task.limits.maxToolCalls > input.contract.maxTools) {
      throw new Error(`${input.contract.role} task exceeds its role tool budget.`);
    }
    const result = await input.execute(context, boundedTools(input.contract, context));
    if (input.contract.mutation === "none" && "patchBundle" in result) {
      throw new Error(`${input.contract.role} read-only contract returned a mutation proposal.`);
    }
    return result;
  };
}
