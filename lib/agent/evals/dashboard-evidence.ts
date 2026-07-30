import {
  REQUIRED_DESIGN_VIEWPORTS,
  VISUAL_RUBRIC_DIMENSIONS,
} from "../design/types.ts";
import { AGENT_PROMPT_ROLES } from "../prompts/types.ts";
import { loadCompactCorePrompt } from "../prompts/loaders.ts";
import {
  SYNTHETIC_REPAIR_DATASET_V3,
  validateRepairDatasetV3,
} from "../repairs/dataset-v3.ts";
import { RUNTIME_SKILL_IDS } from "../skills/types.ts";
import { STABILIZER_FIXERS } from "../stabilizer/fixers.ts";
import {
  AGENT_BENCHMARK_CASES,
  AGENT_BENCHMARK_VERSION,
  BENCHMARK_DISTRIBUTION_V3,
} from "./benchmark-registry.ts";
import {
  evaluateAgentDataGate,
  type AgentDataGateEvidence,
} from "./data-gate.ts";
import type { AgentV3PlatformEvidence } from "./dashboard-types.ts";

export interface AgentV3ObservedEvidence {
  baselineId?: string;
  baselineResultsRecorded?: boolean;
  authorizedModelCount?: number;
  measuredModelCount?: number;
  failureClusterCount?: number;
  designReportRecorded?: boolean;
  promptTokenReportRecorded?: boolean;
}

function stabilizerMode(): AgentV3PlatformEvidence["registry"]["stabilizerDefaultMode"] {
  const modes = new Set(STABILIZER_FIXERS.map((fixer) => fixer.defaultMode));
  if (modes.size !== 1) return "mixed";
  return modes.values().next().value ?? "disabled";
}

function boundedCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value ?? 0 : 0;
}

export async function createAgentV3PlatformEvidence(options: {
  now?: Date;
  env?: Record<string, string | undefined>;
  observed?: AgentV3ObservedEvidence;
} = {}): Promise<AgentV3PlatformEvidence> {
  const repairs = validateRepairDatasetV3(SYNTHETIC_REPAIR_DATASET_V3);
  let compactCore: AgentV3PlatformEvidence["registry"]["compactCore"];
  try {
    const core = await loadCompactCorePrompt();
    compactCore = {
      available: true,
      version: core.version,
      estimatedTokens: core.estimatedTokens,
      lineCount: core.lineCount,
      enabledForRequest: options.env?.DROPS_AGENT_COMPACT_CORE_ENABLED === "1",
    };
  } catch {
    compactCore = {
      available: false,
      version: null,
      estimatedTokens: null,
      lineCount: null,
      enabledForRequest: false,
    };
  }

  const observed = options.observed ?? {};
  const gateInputs: AgentDataGateEvidence = {
    baselineId: observed.baselineId ?? "",
    benchmarkCases: AGENT_BENCHMARK_CASES.length,
    baselineResultsRecorded: observed.baselineResultsRecorded === true,
    authorizedModelCount: boundedCount(observed.authorizedModelCount),
    measuredModelCount: boundedCount(observed.measuredModelCount),
    verifiedRepairCount: repairs.accepted.length,
    failureClusterCount: boundedCount(observed.failureClusterCount),
    designBenchmarkCount: BENCHMARK_DISTRIBUTION_V3["design-responsive"],
    designReportRecorded: observed.designReportRecorded === true,
    promptTokenReportRecorded: observed.promptTokenReportRecorded ?? compactCore.available,
  };
  const gate = evaluateAgentDataGate(gateInputs);
  const blockers = [...gate.blockers];
  if (gateInputs.authorizedModelCount === 0) {
    blockers.push("Authorized live model inventory and measured matrix evidence are not loaded.");
  }

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    version: AGENT_BENCHMARK_VERSION,
    registry: {
      benchmarkCases: AGENT_BENCHMARK_CASES.length,
      benchmarkDistribution: { ...BENCHMARK_DISTRIBUTION_V3 },
      syntheticRepairRecords: SYNTHETIC_REPAIR_DATASET_V3.length,
      acceptedRepairRecords: repairs.accepted.length,
      rejectedRepairRecords: repairs.rejected.length,
      repairFailureClasses: new Set(repairs.accepted.map((entry) => entry.failureClass)).size,
      promptRoles: AGENT_PROMPT_ROLES.length,
      runtimeSkills: RUNTIME_SKILL_IDS.length,
      stabilizerFixers: STABILIZER_FIXERS.length,
      stabilizerDefaultMode: stabilizerMode(),
      compactCore,
      design: {
        agentRegistered: true,
        visualVerifierReadOnly: true,
        requiredViewports: REQUIRED_DESIGN_VIEWPORTS.map((entry) => ({ ...entry })),
        rubricDimensions: VISUAL_RUBRIC_DIMENSIONS.length,
      },
    },
    evidenceLabels: {
      benchmarks: "repository-owned deterministic fixtures",
      repairs: "accepted synthetic source-level fixtures",
      stabilizer: "shadow proposals do not mutate canonical files",
      design: "contract registered; capture evidence is run-specific",
    },
    dataGate: {
      passed: gate.passed && blockers.length === 0,
      blockers,
      inputs: gateInputs,
      productionDefaultChanged: false,
    },
  };
}
