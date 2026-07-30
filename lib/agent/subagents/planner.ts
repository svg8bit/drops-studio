import { createBoundedSubagent, type BoundedSubagentExecutor, type SubagentContract } from "./contracts.ts";
import type { PlannerResult, RoleExecutionCallback } from "../orchestrator/types.ts";

export const PLANNER_CONTRACT: SubagentContract = {
  role: "planner",
  mutation: "none",
  capabilities: ["list-files", "read-file"],
  maxTools: 12,
  externalMutation: false,
};

export function createPlannerSubagent(
  execute: BoundedSubagentExecutor<PlannerResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: PLANNER_CONTRACT, execute });
}
