import type { BenchmarkCaseDefinition, BenchmarkCaseV3 } from "./types.ts";

export function defineBenchmarkCase(input: BenchmarkCaseDefinition): BenchmarkCaseV3 {
  const { legacyDeterministicBlocker, ...definition } = input;
  const seededFailures = input.seededFailures ?? [];
  const failureClasses: BenchmarkCaseV3["seededFailure"][] = [
    "project-schema",
    "dependency",
    "typescript",
    "lint",
    "test",
    "build",
    "preview",
    "browser-runtime",
    "integration",
    "security",
    "permission",
    "provider",
    "timeout",
    "cancelled",
    "unknown",
    "none",
  ];
  const legacyFailure = failureClasses.find(
    (failure) => seededFailures[0] === failure || seededFailures[0]?.startsWith(`${failure}-`),
  ) ?? "none";
  return {
    ...definition,
    version: input.version ?? "3.0.0",
    seededFailures,
    seededFailure: legacyFailure,
    requiresBrowser: Boolean(input.browserFlow || input.visualViewports?.length),
    deterministicBlocker: legacyDeterministicBlocker,
    maxDurationMs: input.maxDurationMs ?? (input.browserFlow ? 180_000 : 60_000),
    maxEstimatedCostUsd: input.maxEstimatedCostUsd ?? 0.5,
  };
}
