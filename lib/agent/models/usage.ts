import type { ModelCapabilityProfile, ModelUsage } from "./types.ts";

export function estimateModelCostUsd(
  profile: ModelCapabilityProfile,
  usage: ModelUsage,
): number | null {
  const { inputPerMillion, cachedInputPerMillion, outputPerMillion } = profile.cost;
  if (inputPerMillion === null || outputPerMillion === null) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cachedRate = cachedInputPerMillion ?? inputPerMillion;
  return (
    (uncachedInput * inputPerMillion +
      usage.cachedInputTokens * cachedRate +
      usage.outputTokens * outputPerMillion) /
    1_000_000
  );
}

export function estimatedCostBand(
  profile: ModelCapabilityProfile,
): "free" | "low" | "medium" | "high" | "unknown" {
  const input = profile.cost.inputPerMillion;
  const output = profile.cost.outputPerMillion;
  if (input === null || output === null) return "unknown";
  if (input === 0 && output === 0) return "free";
  const blended = input + output;
  if (blended <= 5) return "low";
  if (blended <= 30) return "medium";
  return "high";
}
