import { runtimeSkill } from "./registry.ts";
import { selectRuntimeSkills } from "./selector.ts";
import type { RuntimeSkillId, RuntimeSkillSelection, RuntimeSkillSelectionInput } from "./types.ts";

export function loadRuntimeSkills(input: RuntimeSkillSelectionInput): RuntimeSkillSelection {
  return selectRuntimeSkills(input);
}

export function loadRuntimeSkill(id: RuntimeSkillId) {
  return runtimeSkill(id);
}
