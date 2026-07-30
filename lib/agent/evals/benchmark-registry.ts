import {
  DESIGN_BENCHMARK_CASES,
  EDITING_BENCHMARK_CASES,
  GENERATION_BENCHMARK_CASES,
  INTEGRATION_BENCHMARK_CASES,
  ORCHESTRATION_BENCHMARK_CASES,
  REPAIR_BENCHMARK_CASES,
  RETRIEVAL_BENCHMARK_CASES,
  SECURITY_BENCHMARK_CASES,
} from "./benchmarks/cases/index.ts";
import { validateBenchmarkRegistryV3 } from "./benchmarks/distribution.ts";
import type { BenchmarkCase, BenchmarkConfiguration } from "./types.ts";

export const AGENT_BENCHMARK_VERSION = "agent-data-driven-v3.0";

/** The single canonical registry used by local, CI, nightly, and release runners. */
export const AGENT_BENCHMARK_CASES: readonly BenchmarkCase[] = validateBenchmarkRegistryV3([
  ...GENERATION_BENCHMARK_CASES,
  ...EDITING_BENCHMARK_CASES,
  ...REPAIR_BENCHMARK_CASES,
  ...INTEGRATION_BENCHMARK_CASES,
  ...SECURITY_BENCHMARK_CASES,
  ...RETRIEVAL_BENCHMARK_CASES,
  ...DESIGN_BENCHMARK_CASES,
  ...ORCHESTRATION_BENCHMARK_CASES,
]);

export const DEFAULT_BENCHMARK_CONFIGURATIONS: readonly BenchmarkConfiguration[] = [
  {
    id: "balanced-hybrid-parallel",
    label: "Balanced + hybrid + parallel",
    routingPolicy: "auto-balanced",
    hybridRetrieval: true,
    parallelSubagents: true,
    verifier: true,
  },
  {
    id: "economy-lexical-sequential",
    label: "Economy + lexical + sequential",
    routingPolicy: "auto-economy",
    hybridRetrieval: false,
    parallelSubagents: false,
    verifier: true,
  },
] as const;

const LOCAL_FAST_CASE_IDS = new Set([
  "build-whale-intelligence",
  "build-market-reactive-game",
  "edit-button-copy",
  "edit-conflicting-user-revision",
  "repair-typescript",
  "repair-browser",
  "integration-dropstab-fallback",
  "integration-dropsbot-unsupported",
  "security-secret-source",
  "security-cross-tenant",
  "retrieve-project-symbol",
  "retrieve-current-over-stale-doc",
  "design-mobile-390-hierarchy",
  "design-non-generic-category-native",
  "orchestrate-parallel-frontend-integration",
  "orchestrate-cyclic-dag-rejection",
]);

export const LIVE_STRATIFIED_BENCHMARK_CASE_IDS: readonly string[] = [
  "build-whale-intelligence",
  "build-alpha-channel",
  "build-market-reactive-game",
  "edit-button-copy",
  "edit-multi-route",
  "edit-conflicting-user-revision",
  "repair-missing-dependency",
  "repair-typescript",
  "repair-browser",
  "integration-dropstab-fallback",
  "integration-dropsbot-unsupported",
  "integration-webhook-registration",
  "security-secret-source",
  "security-cross-tenant",
  "retrieve-project-symbol",
  "retrieve-current-over-stale-doc",
  "design-mobile-390-hierarchy",
  "design-non-generic-category-native",
  "orchestrate-parallel-frontend-integration",
  "orchestrate-cyclic-dag-rejection",
] as const;

export function benchmarkCasesForSuite(
  suite: "local-fast" | "ci" | "nightly" | "release",
): BenchmarkCase[] {
  if (suite === "local-fast") {
    return AGENT_BENCHMARK_CASES.filter((entry) => LOCAL_FAST_CASE_IDS.has(entry.id));
  }
  // The V3 fixtures are deterministic and repository-owned, so CI evaluates the
  // full catalog. A separate explicit live flag controls provider/Sandbox calls.
  return [...AGENT_BENCHMARK_CASES];
}

export {
  BENCHMARK_DISTRIBUTION_V3,
  validateBenchmarkRegistryV3,
} from "./benchmarks/distribution.ts";
export {
  BENCHMARK_FIXTURE_IDS,
  BENCHMARK_FIXTURES,
  materializeBenchmarkFixture,
} from "./benchmarks/fixture-registry.ts";
export { runBenchmarkBrowserFlow } from "./benchmarks/browser-flow.ts";
export { parseBenchmarkCaseV3, parseBrowserFlowSpec } from "./benchmarks/schema.ts";
export {
  BENCHMARK_FAILURE_SEEDS,
  BENCHMARK_FAILURE_SEED_IDS,
} from "./benchmarks/seeders.ts";
export { runBenchmarkValidators } from "./benchmarks/validator-registry.ts";
export type {
  BenchmarkCaseV3,
  BenchmarkFixtureEnvelope,
  BenchmarkSuiteV3,
  BenchmarkValidationContext,
  BenchmarkValidationResult,
  BrowserFlowSpec,
  BrowserFlowStep,
} from "./benchmarks/types.ts";
