import { createBoundedSubagent, type BoundedSubagentExecutor, type SubagentContract } from "./contracts.ts";
import type { BuilderSubagentResult, RoleExecutionCallback } from "../orchestrator/types.ts";

export const INTEGRATION_CONTRACT: SubagentContract = {
  role: "integration",
  mutation: "patch-proposal-only",
  capabilities: ["list-files", "read-file", "propose-patch"],
  maxTools: 24,
  externalMutation: false,
};

export function createIntegrationSubagent(
  execute: BoundedSubagentExecutor<BuilderSubagentResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: INTEGRATION_CONTRACT, execute });
}
