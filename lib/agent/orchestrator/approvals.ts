import type { SubagentRole } from "./types.ts";

export const SUBAGENT_PROHIBITED_ACTIONS = [
  "connect-provider",
  "register-webhook",
  "publish-telegram",
  "github-push",
  "github-pull-request",
  "deploy",
  "mutate-production-database",
  "wallet-action",
  "trade-action",
  "create-paid-resource",
] as const;

export type ApprovalGatedAction = (typeof SUBAGENT_PROHIBITED_ACTIONS)[number];

export class SubagentApprovalError extends Error {
  constructor(role: SubagentRole, action: ApprovalGatedAction) {
    super(`${role} subagent cannot approve or perform ${action}; the Orchestrator must request explicit user approval.`);
    this.name = "SubagentApprovalError";
  }
}

export function assertSubagentActionAllowed(role: SubagentRole, action: string): void {
  if ((SUBAGENT_PROHIBITED_ACTIONS as readonly string[]).includes(action)) {
    throw new SubagentApprovalError(role, action as ApprovalGatedAction);
  }
}
