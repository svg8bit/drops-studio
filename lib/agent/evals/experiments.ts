import { createHash } from "node:crypto";
import type { BenchmarkReport } from "./types.ts";

export interface AgentExperimentVariant {
  id: string;
  weight: number;
  configurationId: string;
}

export interface AgentExperiment {
  experimentId: string;
  version: string;
  status: "draft" | "canary" | "active" | "paused" | "completed";
  variants: AgentExperimentVariant[];
  minimumSamples: number;
  maximumFailureRate: number;
  maximumCostRegression: number;
}

export function assignAgentExperiment(
  experiment: AgentExperiment,
  actorHash: string,
  projectId: string,
): AgentExperimentVariant | null {
  if (!['canary', 'active'].includes(experiment.status)) return null;
  const variants = experiment.variants.filter((entry) => entry.weight > 0);
  const total = variants.reduce((sum, entry) => sum + entry.weight, 0);
  if (!variants.length || total <= 0) return null;
  const digest = createHash("sha256")
    .update(`${experiment.experimentId}:${experiment.version}:${actorHash}:${projectId}`)
    .digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff * total;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight;
    if (bucket <= cursor) return { ...variant };
  }
  return { ...variants.at(-1)! };
}

export function experimentAutoPause(input: {
  experiment: AgentExperiment;
  candidate: BenchmarkReport["configurations"][number];
  control: BenchmarkReport["configurations"][number];
}): { pause: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.candidate.cases < input.experiment.minimumSamples) {
    return { pause: false, reasons: [] };
  }
  const candidateFailure = 1 - input.candidate.successRate;
  if (candidateFailure > input.experiment.maximumFailureRate) {
    reasons.push(`Failure rate ${(candidateFailure * 100).toFixed(1)}% exceeds the experiment limit.`);
  }
  const controlCost = Math.max(input.control.totalEstimatedCostUsd, 0.000001);
  const costRegression = (input.candidate.totalEstimatedCostUsd - controlCost) / controlCost;
  if (costRegression > input.experiment.maximumCostRegression) {
    reasons.push(`Cost regression ${(costRegression * 100).toFixed(1)}% exceeds the experiment limit.`);
  }
  if (input.candidate.deterministicBlockers > input.control.deterministicBlockers) {
    reasons.push("Candidate introduces additional deterministic release blockers.");
  }
  return { pause: reasons.length > 0, reasons };
}
