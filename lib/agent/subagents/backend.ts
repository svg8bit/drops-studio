import { createBoundedSubagent, type SubagentContract } from "./contracts.ts";
import type { BuilderSubagentResult, RoleContext, RoleExecutionCallback } from "../orchestrator/types.ts";

export const BACKEND_CONTRACT: SubagentContract = {
  role: "backend",
  mutation: "patch-proposal-only",
  capabilities: ["list-files", "read-file", "propose-patch"],
  maxTools: 24,
  externalMutation: false,
};

export function createBackendSubagent(
  execute: (context: RoleContext) => Promise<BuilderSubagentResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: BACKEND_CONTRACT, execute });
}
