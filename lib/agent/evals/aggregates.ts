import type { AgentEvalSummary, AgentFailureClass, AgentRunTrace, BenchmarkReport } from "./types.ts";

export function aggregateAgentEvals(
  traces: readonly AgentRunTrace[],
  reports: readonly BenchmarkReport[],
  now = new Date(),
): AgentEvalSummary {
  const divisor = Math.max(1, traces.length);
  const failureMap = new Map<AgentFailureClass, number>();
  for (const trace of traces) failureMap.set(trace.failureClass, (failureMap.get(trace.failureClass) ?? 0) + 1);
  return {
    generatedAt: now.toISOString(),
    traces: traces.length,
    reports: reports.length,
    workingPreviewRate: traces.filter((trace) => trace.final.preview && trace.final.browser && trace.final.primaryInteraction).length / divisor,
    firstPassPreviewRate: traces.filter((trace) => trace.firstPass.preview && trace.firstPass.browser).length / divisor,
    averageRepairs: traces.reduce((sum, trace) => sum + trace.repairs.length, 0) / divisor,
    averageLatencyMs: traces.reduce((sum, trace) => sum + trace.usage.totalLatencyMs, 0) / divisor,
    estimatedModelCostUsd: Number(traces.reduce((sum, trace) => sum + trace.usage.estimatedModelCostUsd, 0).toFixed(6)),
    failureClasses: [...failureMap.entries()]
      .map(([failureClass, count]) => ({ failureClass, count }))
      .sort((left, right) => right.count - left.count || left.failureClass.localeCompare(right.failureClass)),
    latestTraces: [...traces]
      .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
      .slice(0, 20)
      .map((trace) => structuredClone(trace)),
    latestReports: [...reports]
      .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
      .slice(0, 10)
      .map((report) => structuredClone(report)),
  };
}
