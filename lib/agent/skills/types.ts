import type { AgentPromptRole } from "../prompts/types.ts";

export const RUNTIME_SKILL_IDS = [
  "project-inspection",
  "multi-file-build",
  "quick-edit",
  "sandbox-debugging",
  "release-verification",
  "crypto-ui",
  "design-direction",
  "responsive-layout",
  "dropstab-integration",
  "dropsbot-integration",
  "telegram-delivery",
  "workflow-builder",
  "security-review",
  "github-delivery",
  "vercel-deployment",
  "crypto-game",
  "project-data",
  "managed-backend",
  "managed-auth",
  "data-modeling",
  "object-storage",
  "server-functions",
  "jobs-and-cron",
  "webhooks",
  "realtime-data",
  "collaboration",
  "enterprise-rbac",
  "enterprise-sso",
  "audit-and-compliance",
] as const;

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number];

export interface RuntimeSkillDefinition {
  id: RuntimeSkillId;
  version: string;
  description: string;
  activationSignals: string[];
  requiredCapabilities: string[];
  allowedRoles: AgentPromptRole[];
  allowedTools: string[];
  requiredContextQueries: string[];
  instructions: string[];
  acceptanceChecks: string[];
  forbiddenClaims: string[];
  priority: number;
  documentationPath: string;
}

export interface RuntimeSkill extends RuntimeSkillDefinition {
  contentHash: string;
  estimatedTokens: number;
}

export interface RuntimeSkillSelectionInput {
  role: AgentPromptRole;
  task: string;
  project?: {
    framework?: string;
    category?: string;
    filePaths?: string[];
  };
  integrations?: string[];
  availableCapabilities?: string[];
  explicitSignals?: string[];
  maximumSkills?: number;
  maximumEstimatedTokens?: number;
}

export interface RuntimeSkillSelection {
  skills: RuntimeSkill[];
  omitted: Array<{
    id: RuntimeSkillId;
    reason: "role" | "capability" | "activation" | "budget";
  }>;
  estimatedTokens: number;
  selectionHash: string;
}
