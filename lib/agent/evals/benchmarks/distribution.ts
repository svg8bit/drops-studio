import { BENCHMARK_FIXTURE_IDS } from "./fixture-registry.ts";
import { parseBenchmarkCaseV3 } from "./schema.ts";
import { BENCHMARK_FAILURE_SEED_IDS } from "./seeders.ts";
import type { BenchmarkCaseV3, BenchmarkSuiteV3 } from "./types.ts";
import { BENCHMARK_VALIDATOR_IDS } from "./validator-registry.ts";

export const BENCHMARK_DISTRIBUTION_V3: Readonly<Record<BenchmarkSuiteV3, number>> = {
  "new-product-generation": 24,
  "existing-project-editing": 18,
  "debugging-repair": 18,
  "drops-integrations": 15,
  "security-approval": 15,
  "context-retrieval": 10,
  "design-responsive": 10,
  "multi-agent-orchestration": 10,
};

function normalizedWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 1;
}

function assertUniqueList(values: readonly string[], label: string, caseId: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${caseId} repeats ${label}.`);
}

export function validateBenchmarkRegistryV3(value: readonly BenchmarkCaseV3[]): BenchmarkCaseV3[] {
  if (value.length !== 120) throw new Error(`Benchmark V3 requires exactly 120 cases; received ${value.length}.`);
  const cases = value.map(parseBenchmarkCaseV3);
  const ids = new Set<string>();
  const intents = new Set<string>();
  const flowIds = new Set<string>();
  const prompts: Array<{ id: string; suite: BenchmarkSuiteV3; words: Set<string>; normalized: string }> = [];
  const counts = Object.fromEntries(Object.keys(BENCHMARK_DISTRIBUTION_V3).map((suite) => [suite, 0])) as Record<BenchmarkSuiteV3, number>;

  for (const fixture of cases) {
    if (ids.has(fixture.id)) throw new Error(`Duplicate benchmark id ${fixture.id}.`);
    if (intents.has(fixture.intentKey)) throw new Error(`Duplicate benchmark intent ${fixture.intentKey}.`);
    ids.add(fixture.id);
    intents.add(fixture.intentKey);
    counts[fixture.suite] += 1;
    if (!fixture.fixtureProject || !BENCHMARK_FIXTURE_IDS.has(fixture.fixtureProject)) {
      throw new Error(`${fixture.id} references an unknown or missing fixture project.`);
    }
    for (const seedId of fixture.seededFailures ?? []) {
      if (!BENCHMARK_FAILURE_SEED_IDS.has(seedId)) throw new Error(`${fixture.id} references unknown failure seed ${seedId}.`);
    }
    for (const checkId of fixture.deterministicChecks) {
      if (!BENCHMARK_VALIDATOR_IDS.has(checkId)) throw new Error(`${fixture.id} references unknown validator ${checkId}.`);
    }
    for (const [label, values] of Object.entries({
      capabilities: fixture.requiredCapabilities,
      artifacts: fixture.expectedArtifacts,
      checks: fixture.deterministicChecks,
      claims: fixture.forbiddenClaims,
      blockers: fixture.hardBlockers,
      tags: fixture.tags,
    })) assertUniqueList(values, label, fixture.id);
    if (fixture.requiredCapabilities.length < 2) throw new Error(`${fixture.id} is too trivial: at least two capabilities are required.`);
    if (fixture.browserFlow) {
      if (flowIds.has(fixture.browserFlow.id)) throw new Error(`Duplicate browser flow id ${fixture.browserFlow.id}.`);
      flowIds.add(fixture.browserFlow.id);
    }
    const normalized = [...normalizedWords(fixture.prompt)].sort().join(" ");
    prompts.push({ id: fixture.id, suite: fixture.suite, words: normalizedWords(fixture.prompt), normalized });
  }

  for (const [suite, expected] of Object.entries(BENCHMARK_DISTRIBUTION_V3) as Array<[BenchmarkSuiteV3, number]>) {
    if (counts[suite] !== expected) throw new Error(`${suite} requires ${expected} cases; received ${counts[suite]}.`);
  }
  for (let left = 0; left < prompts.length; left += 1) {
    for (let right = left + 1; right < prompts.length; right += 1) {
      if (prompts[left].normalized === prompts[right].normalized) {
        throw new Error(`Duplicate benchmark prompts: ${prompts[left].id} and ${prompts[right].id}.`);
      }
      if (prompts[left].suite === prompts[right].suite && jaccard(prompts[left].words, prompts[right].words) > 0.88) {
        throw new Error(`Near-duplicate benchmark prompts: ${prompts[left].id} and ${prompts[right].id}.`);
      }
    }
  }
  return structuredClone(cases);
}
