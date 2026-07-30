import type { BenchmarkCaseResult, BenchmarkConfiguration } from "./types.ts";

export function aggregateBenchmarkConfiguration(
  configuration: Pick<BenchmarkConfiguration, "id" | "label">,
  results: readonly BenchmarkCaseResult[],
) {
  const selected = results.filter((entry) => entry.configurationId === configuration.id);
  const divisor = Math.max(1, selected.length);
  return {
    id: configuration.id,
    label: configuration.label,
    cases: selected.length,
    successRate: selected.filter((entry) => entry.passed).length / divisor,
    firstPassRate: selected.filter((entry) => entry.firstPassSuccess).length / divisor,
    averageRepairCount: selected.reduce((sum, entry) => sum + entry.repairCount, 0) / divisor,
    averageLatencyMs: selected.reduce((sum, entry) => sum + entry.latencyMs, 0) / divisor,
    totalEstimatedCostUsd: Number(selected.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0).toFixed(6)),
    deterministicBlockers: selected.filter((entry) => !entry.deterministicGatePassed).length,
  };
}

export function contextRecall(required: readonly string[], observed: readonly string[]): number {
  if (!required.length) return 1;
  const haystack = new Set(observed.map((value) => value.toLowerCase()));
  return required.filter((value) => haystack.has(value.toLowerCase())).length / required.length;
}
