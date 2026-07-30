import { validateRuntimeSkill } from "../skills/registry.ts";
import type { AssembledAgentPrompt, AssembleAgentPromptInput, PromptManifestV3 } from "./types.ts";
import { estimatePromptTokens, promptContentHash, stablePromptJson } from "./metrics.ts";

const DEFAULT_MAXIMUM_PROMPT_TOKENS = 24_000;
const MAX_DYNAMIC_CONTEXT_CHARACTERS = 48_000;

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} exceeds its bounded size.`);
  return normalized;
}

function runtimeModules(input: AssembleAgentPromptInput): Record<string, unknown> {
  const retrievedContext = [...(input.retrievedContext ?? [])]
    .map((entry) => ({
      id: boundedText(entry.id, "Context id", 160),
      source: boundedText(entry.source, "Context source", 500),
      version: boundedText(entry.version, "Context version", 160),
      trust: entry.trust,
      content: boundedText(entry.content, "Context content", 8_000),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const contextCharacters = retrievedContext.reduce((total, entry) => total + entry.content.length, 0);
  if (contextCharacters > MAX_DYNAMIC_CONTEXT_CHARACTERS) {
    throw new Error("Retrieved context exceeds the bounded prompt context size.");
  }
  return {
    task: {
      goal: boundedText(input.task.goal, "Task goal", 20_000),
      mode: input.task.mode,
      explicitConstraints: [...(input.task.explicitConstraints ?? [])].map((entry) => boundedText(entry, "Task constraint", 1_000)).sort(),
      requestedIntegrations: [...new Set(input.task.requestedIntegrations ?? [])].sort(),
    },
    project: {
      projectId: boundedText(input.project.projectId, "Project id", 128),
      revision: input.project.revision,
      framework: boundedText(input.project.framework, "Project framework", 80),
      assignedScopes: [...new Set(input.project.assignedScopes ?? [])].sort(),
    },
    approvalState: input.approvalState ?? {},
    retrievedContext,
    runtimeEvidence: input.runtimeEvidence ?? {},
    integrationEvidence: input.integrationEvidence ?? {},
  };
}

export function assembleAgentPrompt(input: AssembleAgentPromptInput): AssembledAgentPrompt {
  if (input.rolePrompt.role === "visual-verifier" && input.rolePrompt.mayMutateFiles) {
    throw new Error("Visual Verifier role cannot mutate files.");
  }
  const selectedSkills = [...input.selectedSkills].sort((left, right) => left.id.localeCompare(right.id));
  for (const skill of selectedSkills) {
    validateRuntimeSkill(skill);
    if (!skill.allowedRoles.includes(input.rolePrompt.role)) {
      throw new Error(`Skill ${skill.id} is not allowed for ${input.rolePrompt.role}.`);
    }
  }
  const skillSections = selectedSkills.map((skill) =>
    `<RUNTIME_SKILL id="${skill.id}" version="${skill.version}">\n${skill.instructions.join("\n")}\n</RUNTIME_SKILL>`,
  );
  const modules = stablePromptJson(runtimeModules(input));
  const prompt = [
    `<CORE mode="${input.core.mode}" version="${input.core.version}">\n${input.core.content}\n</CORE>`,
    `<ROLE id="${input.rolePrompt.role}" version="${input.rolePrompt.version}">\n${input.rolePrompt.content}\n</ROLE>`,
    ...skillSections,
    `<RUNTIME_MODULES>\n${modules}\n</RUNTIME_MODULES>`,
  ].join("\n\n");
  const tokenCount = estimatePromptTokens(prompt);
  const maximumTokens = input.maximumTokens ?? DEFAULT_MAXIMUM_PROMPT_TOKENS;
  if (!Number.isSafeInteger(maximumTokens) || maximumTokens < 1_000 || maximumTokens > 200_000) {
    throw new Error("Maximum prompt token budget is invalid.");
  }
  if (tokenCount > maximumTokens) {
    throw new Error(`Assembled prompt requires ${tokenCount} estimated tokens, above ${maximumTokens}.`);
  }
  const skillHashPayload = stablePromptJson(
    selectedSkills.map((skill) => ({ id: skill.id, version: skill.version, hash: skill.contentHash })),
  );
  const manifest: PromptManifestV3 = {
    schemaVersion: 3,
    core: {
      mode: input.core.mode,
      version: input.core.version,
      sourcePath: input.core.sourcePath,
      hash: input.core.contentHash,
      tokenCount: input.core.estimatedTokens,
    },
    role: {
      id: input.rolePrompt.role,
      version: input.rolePrompt.version,
      sourcePath: input.rolePrompt.sourcePath,
      hash: input.rolePrompt.contentHash,
      tokenCount: input.rolePrompt.estimatedTokens,
    },
    selectedSkills: selectedSkills.map((skill) => ({
      id: skill.id,
      version: skill.version,
      hash: skill.contentHash,
      tokenCount: skill.estimatedTokens,
    })),
    contextCompilerVersion: input.contextCompilerVersion,
    modelRoute: structuredClone(input.modelRoute),
    tokenCount,
    contentHashes: {
      core: input.core.contentHash,
      role: input.rolePrompt.contentHash,
      skills: promptContentHash(skillHashPayload),
      context: promptContentHash(modules),
      assembled: promptContentHash(prompt),
    },
  };
  return { prompt, manifest };
}
