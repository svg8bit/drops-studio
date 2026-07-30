import type {
  AgentModelRole,
  ModelCapabilityProfile,
  ModelRoutingMode,
} from "../models/types.ts";

export const RUNTIME_SYSTEM_PROMPT_START =
  "<!-- RUNTIME_SYSTEM_PROMPT_START -->";
export const RUNTIME_SYSTEM_PROMPT_END =
  "<!-- RUNTIME_SYSTEM_PROMPT_END -->";

export interface AgentRuntimeVersions {
  runtimePromptVersion: string;
  configVersion: string;
  routingPolicyVersion: string;
  contextCompilerVersion: string;
  modelRegistryVersion: string;
  projectRevision: string;
  rolePromptVersions: Record<AgentModelRole, string>;
  selectedSkillVersions: Array<{ id: string; version: string }>;
}

export interface RuntimePromptTask {
  goal: string;
  mode: "plan" | "build" | "edit" | "debug" | "release";
  explicitConstraints: string[];
  requestedIntegrations: string[];
}

export interface RuntimePromptCompositionInput {
  core: RuntimeSystemPrompt;
  role: AgentModelRole;
  model: ModelCapabilityProfile;
  routingMode: ModelRoutingMode;
  approvalState: Record<string, boolean | string | null>;
  task: RuntimePromptTask;
  projectMemory: Record<string, unknown>;
  selectedSkills: Array<{ id: string; version: string; instructions: string }>;
  retrievedContext: Array<{
    id: string;
    source: string;
    version: string;
    trust: "trusted" | "project" | "untrusted";
    content: string;
  }>;
  runtimeEvidence: Record<string, unknown>;
  integrationEvidence: Record<string, unknown>;
  versions: AgentRuntimeVersions;
}

export interface RuntimeSystemPrompt {
  version: string;
  sourcePath: string;
  content: string;
  contentHash: string;
}

export interface ComposedRuntimePrompt {
  prompt: string;
  promptHash: string;
  coreHash: string;
  moduleHash: string;
  versions: AgentRuntimeVersions;
}
