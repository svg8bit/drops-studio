import { promptContentHash, stablePromptJson } from "../prompts/metrics.ts";
import { runtimeSkillRegistry } from "./registry.ts";
import type { RuntimeSkill, RuntimeSkillSelection, RuntimeSkillSelectionInput } from "./types.ts";

const DEFAULT_MAXIMUM_SKILLS = 8;
const DEFAULT_MAXIMUM_SKILL_TOKENS = 1_800;

function corpus(input: RuntimeSkillSelectionInput): string {
  return [
    input.task,
    input.project?.framework,
    input.project?.category,
    ...(input.project?.filePaths ?? []),
    ...(input.integrations ?? []),
    ...(input.explicitSignals ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function integrationSignal(skill: RuntimeSkill, integrations: Set<string>): boolean {
  const map: Partial<Record<RuntimeSkill["id"], string[]>> = {
    "dropstab-integration": ["dropstab"],
    "dropsbot-integration": ["dropsbot", "drops-bot"],
    "telegram-delivery": ["telegram"],
    "github-delivery": ["github"],
    "vercel-deployment": ["vercel"],
    "project-data": ["project-data", "database"],
    "managed-backend": ["managed-backend", "project-data", "database"],
    "data-modeling": ["managed-backend", "database"],
    "managed-auth": ["managed-auth", "auth"],
    "object-storage": ["object-storage", "blob", "r2"],
    "server-functions": ["managed-functions", "functions"],
    "jobs-and-cron": ["managed-jobs", "cron"],
    "webhooks": ["managed-webhooks", "dropsbot"],
    "realtime-data": ["managed-realtime", "realtime"],
    "collaboration": ["collaboration"],
    "enterprise-rbac": ["organizations", "rbac"],
    "enterprise-sso": ["oidc", "sso"],
    "audit-and-compliance": ["audit", "backups"],
  };
  return (map[skill.id] ?? []).some((entry) => integrations.has(entry));
}

export function selectRuntimeSkills(input: RuntimeSkillSelectionInput): RuntimeSkillSelection {
  const maximumSkills = input.maximumSkills ?? DEFAULT_MAXIMUM_SKILLS;
  const maximumEstimatedTokens = input.maximumEstimatedTokens ?? DEFAULT_MAXIMUM_SKILL_TOKENS;
  if (!Number.isSafeInteger(maximumSkills) || maximumSkills < 1 || maximumSkills > 15) {
    throw new Error("Runtime skill count budget is invalid.");
  }
  if (!Number.isSafeInteger(maximumEstimatedTokens) || maximumEstimatedTokens < 128 || maximumEstimatedTokens > 8_000) {
    throw new Error("Runtime skill token budget is invalid.");
  }
  const text = corpus(input);
  const capabilities = new Set(input.availableCapabilities ?? []);
  const integrations = new Set((input.integrations ?? []).map((entry) => entry.toLowerCase()));
  const omitted: RuntimeSkillSelection["omitted"] = [];
  const candidates: Array<{ skill: RuntimeSkill; score: number }> = [];
  for (const skill of runtimeSkillRegistry()) {
    if (!skill.allowedRoles.includes(input.role)) {
      omitted.push({ id: skill.id, reason: "role" });
      continue;
    }
    if (skill.requiredCapabilities.some((capability) => !capabilities.has(capability))) {
      omitted.push({ id: skill.id, reason: "capability" });
      continue;
    }
    const matches = skill.activationSignals.filter((signal) => text.includes(signal.toLowerCase())).length;
    const integrationMatched = integrationSignal(skill, integrations);
    if (!matches && !integrationMatched) {
      omitted.push({ id: skill.id, reason: "activation" });
      continue;
    }
    candidates.push({ skill, score: matches * 10 + (integrationMatched ? 25 : 0) + skill.priority / 100 });
  }
  candidates.sort((left, right) => right.score - left.score || right.skill.priority - left.skill.priority || left.skill.id.localeCompare(right.skill.id));
  const selected: RuntimeSkill[] = [];
  let estimatedTokens = 0;
  for (const candidate of candidates) {
    if (selected.length >= maximumSkills || estimatedTokens + candidate.skill.estimatedTokens > maximumEstimatedTokens) {
      omitted.push({ id: candidate.skill.id, reason: "budget" });
      continue;
    }
    selected.push(candidate.skill);
    estimatedTokens += candidate.skill.estimatedTokens;
  }
  selected.sort((left, right) => left.id.localeCompare(right.id));
  omitted.sort((left, right) => left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason));
  return {
    skills: selected.map((skill) => structuredClone(skill)),
    omitted,
    estimatedTokens,
    selectionHash: promptContentHash(stablePromptJson(selected.map((skill) => ({ id: skill.id, version: skill.version, hash: skill.contentHash })))),
  };
}
