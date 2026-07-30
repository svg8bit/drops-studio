import { randomUUID } from "node:crypto";
import { AGENT_BENCHMARK_VERSION } from "./benchmark-registry.ts";
import { evaluateAgentReleaseGate, type AgentEvalReleaseThresholds } from "./release-gate.ts";
import { aggregateBenchmarkConfiguration } from "./scoring.ts";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkConfiguration,
  BenchmarkReport,
} from "./types.ts";

export type BenchmarkExecutor = (
  fixture: BenchmarkCase,
  configuration: BenchmarkConfiguration,
  signal: AbortSignal,
) => Promise<BenchmarkCaseResult>;

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  execute: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await execute(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runAgentBenchmark(input: {
  suite: BenchmarkReport["suite"];
  cases: readonly BenchmarkCase[];
  configurations: readonly BenchmarkConfiguration[];
  execute: BenchmarkExecutor;
  concurrency?: number;
  timeoutMs?: number;
  thresholds?: AgentEvalReleaseThresholds;
  now?: () => Date;
}): Promise<BenchmarkReport> {
  if (input.cases.length < (input.suite === "local-fast" ? 1 : 20)) {
    throw new Error(`${input.suite} benchmark requires ${input.suite === "local-fast" ? 1 : 20} fixtures.`);
  }
  if (!input.configurations.length) throw new Error("At least one benchmark configuration is required.");
  const now = input.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const jobs = input.configurations.flatMap((configuration) =>
    input.cases.map((fixture) => ({ fixture, configuration })),
  );
  const results = await boundedMap(jobs, input.concurrency ?? 3, async ({ fixture, configuration }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Benchmark case timed out.")), input.timeoutMs ?? 180_000);
    try {
      const result = await input.execute(fixture, configuration, controller.signal);
      if (result.caseId !== fixture.id || result.configurationId !== configuration.id) {
        throw new Error("Benchmark executor returned mismatched fixture metadata.");
      }
      if (result.repairCount < 0 || result.repairCount > 3) {
        throw new Error("Benchmark repair count exceeds the bounded runtime contract.");
      }
      return structuredClone(result);
    } finally {
      clearTimeout(timer);
    }
  });
  const releaseGate = evaluateAgentReleaseGate(input.cases, results, input.thresholds);
  return {
    schemaVersion: 1,
    reportId: randomUUID(),
    suite: input.suite,
    createdAt,
    finishedAt: now().toISOString(),
    benchmarkVersion: AGENT_BENCHMARK_VERSION,
    cases: results,
    configurations: input.configurations.map((configuration) =>
      aggregateBenchmarkConfiguration(configuration, results),
    ),
    releaseGate,
  };
}
