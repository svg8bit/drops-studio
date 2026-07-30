import { createBoundedSubagent, type BoundedSubagentExecutor, type SubagentContract } from "./contracts.ts";
import type { BuilderSubagentResult, RoleExecutionCallback } from "../orchestrator/types.ts";

export const FRONTEND_CONTRACT: SubagentContract = {
  role: "frontend",
  mutation: "patch-proposal-only",
  capabilities: ["list-files", "read-file", "propose-patch"],
  maxTools: 24,
  externalMutation: false,
};

export function createFrontendSubagent(
  execute: BoundedSubagentExecutor<BuilderSubagentResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: FRONTEND_CONTRACT, execute });
}
