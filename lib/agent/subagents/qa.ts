import { createBoundedSubagent, type BoundedSubagentExecutor, type SubagentContract } from "./contracts.ts";
import type { QaResult, RoleExecutionCallback } from "../orchestrator/types.ts";

export const QA_CONTRACT: SubagentContract = {
  role: "qa",
  mutation: "none",
  capabilities: ["list-files", "read-file", "report-findings"],
  maxTools: 20,
  externalMutation: false,
};

export function createQaSubagent(
  execute: BoundedSubagentExecutor<QaResult>,
): RoleExecutionCallback {
  return createBoundedSubagent({ contract: QA_CONTRACT, execute });
}
