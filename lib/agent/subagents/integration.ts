import { createBoundedSubagent, type SubagentContract } from "./contracts.ts";
import type { BuilderSubagentResult, RoleContext, RoleExecutionCallback } from "../orchestrator/types.ts";

export const INTEGRATION_CONTRACT: SubagentContract = {
  role: "integration",
  mutation: "patch-proposal-only",
  capabilities: ["list-files", "read-file", "propose-patch"],
  maxTools: 24,
  externalMutation: false,
};

export function createIntegrationSubagent(
  execute: (context: RoleContext) => Promise<BuilderSubagentResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: INTEGRATION_CONTRACT, execute });
}
