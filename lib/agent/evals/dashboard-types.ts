import type { AgentDataGateEvidence } from "./data-gate.ts";

export const AGENT_V3_DASHBOARD_CONTRACT = Object.freeze({
  benchmarkCases: 120,
  benchmarkSlices: 8,
  syntheticRepairRecords: 36,
  promptRoles: 12,
  runtimeSkills: 29,
  stabilizerFixers: 4,
  requiredDesignViewports: 3,
  productionDefaultChanged: false,
} as const);

export interface AgentV3PlatformEvidence {
  schemaVersion: 1;
  generatedAt: string;
  version: string;
  registry: {
    benchmarkCases: number;
    benchmarkDistribution: Record<string, number>;
    syntheticRepairRecords: number;
    acceptedRepairRecords: number;
    rejectedRepairRecords: number;
    repairFailureClasses: number;
    promptRoles: number;
    runtimeSkills: number;
    stabilizerFixers: number;
    stabilizerDefaultMode: "shadow" | "mixed" | "active" | "disabled";
    compactCore: {
      available: boolean;
      version: string | null;
      estimatedTokens: number | null;
      lineCount: number | null;
      enabledForRequest: boolean;
    };
    design: {
      agentRegistered: boolean;
      visualVerifierReadOnly: boolean;
      requiredViewports: Array<{ id: string; width: number; height: number }>;
      rubricDimensions: number;
    };
  };
  evidenceLabels: {
    benchmarks: "repository-owned deterministic fixtures";
    repairs: "accepted synthetic source-level fixtures";
    stabilizer: "shadow proposals do not mutate canonical files";
    design: "contract registered; capture evidence is run-specific";
  };
  dataGate: {
    passed: boolean;
    blockers: string[];
    inputs: AgentDataGateEvidence;
    productionDefaultChanged: false;
  };
}
