import { createBoundedSubagent, type BoundedSubagentExecutor, type SubagentContract } from "./contracts.ts";
import type { RoleExecutionCallback, SecurityResult } from "../orchestrator/types.ts";

export const SECURITY_CONTRACT: SubagentContract = {
  role: "security",
  mutation: "none",
  capabilities: ["list-files", "read-file", "report-findings"],
  maxTools: 20,
  externalMutation: false,
};

export function createSecuritySubagent(
  execute: BoundedSubagentExecutor<SecurityResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: SECURITY_CONTRACT, execute });
}
