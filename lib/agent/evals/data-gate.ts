import { createHash } from "node:crypto";

export const AGENT_DATA_GATE_VERSION = "3.0.0";

export type AgentCandidateKind = "router" | "autofix" | "role-prompt" | "skill";

export interface AgentDataGateEvidence {
  baselineId: string;
  benchmarkCases: number;
  baselineResultsRecorded: boolean;
  authorizedModelCount: number;
  measuredModelCount: number;
  verifiedRepairCount: number;
  failureClusterCount: number;
  designBenchmarkCount: number;
  designReportRecorded: boolean;
  promptTokenReportRecorded: boolean;
}

export interface AgentDataGateVerdict {
  passed: boolean;
  blockers: string[];
}

export interface AgentCandidateExperiment {
  candidateId: string;
  kind: AgentCandidateKind;
  version: string;
  status: "draft" | "rejected" | "canary-ready";
  hypothesis: string;
  linkedFailureClusterIds: string[];
  expectedMetric: string;
  affectedBenchmarkSlices: string[];
  safetyGuardrails: string[];
  rollbackConfig: { defaultVersion: string; featureFlag: string };
  experimentId: string;
  productionDefaultChanged: false;
}

export interface CandidateMetricSnapshot {
  workingPreviewRate: number;
  estimatedCostUsd: number;
  p95LatencyMs: number;
  criticalSecurityRegressions: number;
  hardBlockerRegressions: number;
  cryptoSliceRegression: number;
  integrationTruthRegression: number;
  designSliceRegression: number;
  samples: number;
}

export interface AgentCandidateEvaluation {
  verdict: "promote-to-canary" | "reject" | "insufficient-data";
  reasons: string[];
  previewDelta: number;
  costDelta: number;
  latencyDelta: number;
  canaryPercent: 5 | 0;
  productionDefaultChanged: false;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function evaluateAgentDataGate(evidence: AgentDataGateEvidence): AgentDataGateVerdict {
  const blockers: string[] = [];
  if (!evidence.baselineId.trim() || !evidence.baselineResultsRecorded) blockers.push("Immutable V2 baseline results are missing.");
  if (evidence.benchmarkCases < 120) blockers.push("At least 120 registered benchmark cases are required.");
  if (evidence.authorizedModelCount >= 2 && evidence.measuredModelCount < 2) blockers.push("At least two authorized models must be measured.");
  if (evidence.authorizedModelCount === 1 && evidence.measuredModelCount < 1) blockers.push("The single authorized model has not been measured.");
  if (evidence.verifiedRepairCount < 30) blockers.push("At least 30 verified repair traces are required.");
  if (evidence.failureClusterCount < 1) blockers.push("A failure clustering report is required.");
  if (evidence.designBenchmarkCount < 10 || !evidence.designReportRecorded) blockers.push("The 10-case Design Agent report is required.");
  if (!evidence.promptTokenReportRecorded) blockers.push("The compact-core token report is required.");
  return { passed: blockers.length === 0, blockers };
}

export function createAgentCandidate(input: {
  gate: AgentDataGateEvidence;
  kind: AgentCandidateKind;
  version: string;
  hypothesis: string;
  linkedFailureClusterIds: string[];
  expectedMetric: string;
  affectedBenchmarkSlices: string[];
  safetyGuardrails: string[];
  defaultVersion: string;
  featureFlag: string;
  experimentId: string;
}): AgentCandidateExperiment {
  const verdict = evaluateAgentDataGate(input.gate);
  if (!verdict.passed) throw new Error(`Agent candidate is data-gated: ${verdict.blockers.join(" ")}`);
  if (!input.linkedFailureClusterIds.length) throw new Error("Agent candidate requires measured failure-cluster evidence.");
  if (!input.hypothesis.trim() || !input.expectedMetric.trim() || !input.affectedBenchmarkSlices.length) {
    throw new Error("Agent candidate hypothesis, metric, and benchmark slices are required.");
  }
  if (!input.safetyGuardrails.length || !input.featureFlag.startsWith("DROPS_")) {
    throw new Error("Agent candidate requires safety guardrails and a rollback feature flag.");
  }
  return {
    candidateId: `${input.kind}-${hash(JSON.stringify(input))}`,
    kind: input.kind,
    version: input.version,
    status: "draft",
    hypothesis: input.hypothesis,
    linkedFailureClusterIds: [...new Set(input.linkedFailureClusterIds)].sort(),
    expectedMetric: input.expectedMetric,
    affectedBenchmarkSlices: [...new Set(input.affectedBenchmarkSlices)].sort(),
    safetyGuardrails: [...new Set(input.safetyGuardrails)].sort(),
    rollbackConfig: { defaultVersion: input.defaultVersion, featureFlag: input.featureFlag },
    experimentId: input.experimentId,
    productionDefaultChanged: false,
  };
}

function relativeDelta(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (candidate - baseline) / baseline;
}

export function evaluateAgentCandidate(
  baseline: CandidateMetricSnapshot,
  candidate: CandidateMetricSnapshot,
): AgentCandidateEvaluation {
  const previewDelta = candidate.workingPreviewRate - baseline.workingPreviewRate;
  const costDelta = relativeDelta(candidate.estimatedCostUsd, baseline.estimatedCostUsd);
  const latencyDelta = relativeDelta(candidate.p95LatencyMs, baseline.p95LatencyMs);
  const reasons: string[] = [];
  if (candidate.criticalSecurityRegressions > 0) reasons.push("Critical security regression detected.");
  if (candidate.hardBlockerRegressions > 0) reasons.push("Deterministic hard-blocker regression detected.");
  if (candidate.cryptoSliceRegression > 0 || candidate.integrationTruthRegression > 0 || candidate.designSliceRegression > 0) {
    reasons.push("A protected crypto, integration-truth, or design slice regressed.");
  }
  if (Math.min(baseline.samples, candidate.samples) < 20) {
    reasons.push("Sample is too small for a promotion recommendation.");
    return { verdict: "insufficient-data", reasons, previewDelta, costDelta, latencyDelta, canaryPercent: 0, productionDefaultChanged: false };
  }
  const qualityWin = previewDelta >= 0.03;
  const efficiencyWin = (costDelta <= -0.15 || latencyDelta <= -0.15) && previewDelta >= -0.01;
  if (!qualityWin && !efficiencyWin) reasons.push("Candidate does not meet the quality or non-inferior efficiency threshold.");
  const rejected = reasons.length > 0;
  return {
    verdict: rejected ? "reject" : "promote-to-canary",
    reasons,
    previewDelta,
    costDelta,
    latencyDelta,
    canaryPercent: rejected ? 0 : 5,
    productionDefaultChanged: false,
  };
}

export function stableCanaryAssignment(input: {
  experimentId: string;
  version: string;
  actorHash: string;
  projectId: string;
  percent?: number;
}): "candidate" | "control" {
  const percent = Math.min(Math.max(input.percent ?? 5, 0), 100);
  if (percent === 0) return "control";
  if (percent === 100) return "candidate";
  const digest = createHash("sha256")
    .update(`${input.experimentId}:${input.version}:${input.actorHash}:${input.projectId}`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 * 100 < percent ? "candidate" : "control";
}

export function criticalRegressionAutoPause(input: {
  criticalSecurityRegressions: number;
  hardBlockerRegressions: number;
  failureRateDelta: number;
  costDelta: number;
}): { paused: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.criticalSecurityRegressions > 0) reasons.push("Critical security regression.");
  if (input.hardBlockerRegressions > 0) reasons.push("Hard-blocker regression.");
  if (input.failureRateDelta > 0.03) reasons.push("Failure-rate guardrail exceeded.");
  if (input.costDelta > 0.2) reasons.push("Cost guardrail exceeded.");
  return { paused: reasons.length > 0, reasons };
}
