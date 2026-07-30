import { createBoundedSubagent, type SubagentContract } from "./contracts.ts";
import type { PlannerResult, RoleContext, RoleExecutionCallback } from "../orchestrator/types.ts";

export const PLANNER_CONTRACT: SubagentContract = {
  role: "planner",
  mutation: "none",
  capabilities: ["list-files", "read-file"],
  maxTools: 12,
  externalMutation: false,
};

export function createPlannerSubagent(
  execute: (context: RoleContext) => Promise<PlannerResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: PLANNER_CONTRACT, execute });
}
