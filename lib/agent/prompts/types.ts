import type { RuntimeSkill } from "../skills/types.ts";

export const AGENT_PROMPT_ROLES = [
  "router",
  "planner",
  "coder",
  "quick-edit",
  "autofix",
  "verifier",
  "design-agent",
  "visual-verifier",
  "qa",
  "security",
  "retrieval-reranker",
  "eval-judge",
] as const;

export type AgentPromptRole = (typeof AGENT_PROMPT_ROLES)[number];

export interface PromptSourceDocument {
  version: string;
  sourcePath: string;
  content: string;
  contentHash: string;
  estimatedTokens: number;
  lineCount: number;
}

export interface PromptCoreDocument extends PromptSourceDocument {
  mode: "compact-v3" | "legacy-v2";
  fallbackReason?: string;
}

export interface RolePromptDocument extends PromptSourceDocument {
  role: AgentPromptRole;
  allowedTools: string[];
  mayMutateFiles: boolean;
  mayRunRuntime: boolean;
}

export interface PromptModelRoute {
  routeId: string;
  provider: string;
  model: string;
  policyVersion: string;
}

export interface PromptManifestV3 {
  schemaVersion: 3;
  core: {
    mode: PromptCoreDocument["mode"];
    version: string;
    sourcePath: string;
    hash: string;
    tokenCount: number;
  };
  role: {
    id: AgentPromptRole;
    version: string;
    sourcePath: string;
    hash: string;
    tokenCount: number;
  };
  selectedSkills: Array<{
    id: RuntimeSkill["id"];
    version: string;
    hash: string;
    tokenCount: number;
  }>;
  contextCompilerVersion: string;
  modelRoute: PromptModelRoute;
  tokenCount: number;
  contentHashes: {
    core: string;
    role: string;
    skills: string;
    context: string;
    assembled: string;
  };
}

export interface AssembleAgentPromptInput {
  core: PromptCoreDocument;
  rolePrompt: RolePromptDocument;
  selectedSkills: RuntimeSkill[];
  contextCompilerVersion: string;
  modelRoute: PromptModelRoute;
  task: {
    goal: string;
    mode: "plan" | "build" | "edit" | "debug" | "release" | "evaluate";
    explicitConstraints?: string[];
    requestedIntegrations?: string[];
  };
  project: {
    projectId: string;
    revision: number;
    framework: string;
    assignedScopes?: string[];
  };
  approvalState?: Record<string, boolean | string | null>;
  retrievedContext?: Array<{
    id: string;
    source: string;
    version: string;
    trust: "trusted" | "project" | "untrusted";
    content: string;
  }>;
  runtimeEvidence?: Record<string, unknown>;
  integrationEvidence?: Record<string, unknown>;
  maximumTokens?: number;
}

export interface AssembledAgentPrompt {
  prompt: string;
  manifest: PromptManifestV3;
}
