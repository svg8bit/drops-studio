import type { AgentRuntimeVersions } from "./types.ts";

export const AGENT_RUNTIME_VERSION = "2.0.0";
export const AGENT_CONFIG_VERSION = "2.0.0";
export const MODEL_ROUTING_POLICY_VERSION = "2.0.0";
export const CONTEXT_COMPILER_VERSION = "2.0.0";
export const MODEL_REGISTRY_VERSION = "2.0.0";

export const ROLE_PROMPT_VERSIONS = {
  router: "2.0.0",
  planner: "2.0.0",
  coder: "2.0.0",
  "quick-edit": "2.0.0",
  autofix: "2.0.0",
  verifier: "2.0.0",
  "retrieval-reranker": "2.0.0",
  "eval-judge": "2.0.0",
} as const;

export function createAgentRuntimeVersions(input: {
  projectRevision: string;
  selectedSkillVersions?: Array<{ id: string; version: string }>;
}): AgentRuntimeVersions {
  return {
    runtimePromptVersion: AGENT_RUNTIME_VERSION,
    configVersion: AGENT_CONFIG_VERSION,
    routingPolicyVersion: MODEL_ROUTING_POLICY_VERSION,
    contextCompilerVersion: CONTEXT_COMPILER_VERSION,
    modelRegistryVersion: MODEL_REGISTRY_VERSION,
    projectRevision: input.projectRevision,
    rolePromptVersions: { ...ROLE_PROMPT_VERSIONS },
    selectedSkillVersions: [...(input.selectedSkillVersions ?? [])]
      .map((skill) => ({ id: skill.id, version: skill.version }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}
