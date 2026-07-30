export const BENCHMARK_SUITES_V3 = [
  "new-product-generation",
  "existing-project-editing",
  "debugging-repair",
  "drops-integrations",
  "security-approval",
  "context-retrieval",
  "design-responsive",
  "multi-agent-orchestration",
] as const;

export type BenchmarkSuiteV3 = (typeof BENCHMARK_SUITES_V3)[number];

export type BenchmarkLegacyCategory =
  | "build"
  | "edit"
  | "repair"
  | "retrieval"
  | "security"
  | "integration"
  | "release";

export type BenchmarkExpectedRoute = "planner" | "coder" | "quick-edit" | "autofix";

export type BenchmarkFailureClass =
  | "none"
  | "project-schema"
  | "dependency"
  | "typescript"
  | "lint"
  | "test"
  | "build"
  | "preview"
  | "browser-runtime"
  | "integration"
  | "security"
  | "permission"
  | "provider"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface BenchmarkViewport {
  width: number;
  height: number;
}

export type BrowserFlowStep =
  | { action: "navigate"; path: string }
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "press"; selector: string; key: "Enter" | "Escape" | "Space" | "ArrowDown" | "ArrowUp" }
  | { action: "expect-visible"; selector: string }
  | { action: "expect-text"; selector: string; text: string }
  | { action: "expect-url"; path: string }
  | { action: "expect-no-console-errors" }
  | { action: "expect-no-failed-requests" }
  | { action: "expect-no-horizontal-overflow" }
  | { action: "axe-scan" };

export interface BrowserFlowSpec {
  id: string;
  version: "1.0.0";
  startPath: string;
  steps: BrowserFlowStep[];
  timeoutMs: number;
}

export interface BenchmarkCaseV3 {
  id: string;
  version: string;
  title: string;
  suite: BenchmarkSuiteV3;
  intentKey: string;
  prompt: string;
  fixtureProject?: string;
  requiredCapabilities: string[];
  expectedArtifacts: string[];
  deterministicChecks: string[];
  browserFlow?: BrowserFlowSpec;
  visualViewports?: BenchmarkViewport[];
  providerEvidenceRequirements?: string[];
  forbiddenClaims: string[];
  hardBlockers: string[];
  seededFailures?: string[];
  maxDurationMs?: number;
  maxEstimatedCostUsd?: number;
  tags: string[];

  /** V2 runner compatibility fields; derived in the one canonical registry. */
  category: BenchmarkLegacyCategory;
  expectedRoute: BenchmarkExpectedRoute;
  requiredContext: string[];
  seededFailure: BenchmarkFailureClass;
  requiresBrowser: boolean;
  requiresApprovalBoundary: boolean;
  deterministicBlocker?: string;
}

export interface BenchmarkCaseDefinition extends Omit<
  BenchmarkCaseV3,
  | "version"
  | "requiresBrowser"
  | "seededFailure"
  | "deterministicBlocker"
  | "maxDurationMs"
  | "maxEstimatedCostUsd"
> {
  version?: string;
  maxDurationMs?: number;
  maxEstimatedCostUsd?: number;
  /** Only set for a fixture whose expected outcome is an intentional release block. */
  legacyDeterministicBlocker?: string;
}

export interface BenchmarkFixtureDefinition {
  id: string;
  version: string;
  presetId:
    | "action-engine"
    | "alpha-channel"
    | "morning-alpha"
    | "prediction-impact"
    | "smart-money-copy"
    | "crypto-aggregator"
    | "crypto-game"
    | "personal-companion"
    | "portfolio-tamagotchi"
    | "crypto-product-hunt"
    | "crypto-radio"
    | "crypto-siri"
    | "custom-product";
  prompt: string;
  tools: string[];
  source: "repository-owned" | "synthetic";
  license: "repository" | "CC0-1.0";
}

export type BenchmarkSeedKind =
  | "file-overlay"
  | "stream-events"
  | "provider-payload"
  | "network-request"
  | "revision-conflict"
  | "task-graph"
  | "browser-evidence";

export interface BenchmarkFailureSeed {
  id: string;
  version: string;
  kind: BenchmarkSeedKind;
  affectedPaths: string[];
  payload: unknown;
  expectedDiagnostic: string;
  canonicalCommitAllowed: false;
}

export interface BenchmarkFixtureEnvelope {
  fixtureId: string;
  fixtureVersion: string;
  canonicalProject: import("../../../project-v2-types.ts").ProjectV2;
  failureSeeds: BenchmarkFailureSeed[];
  source: BenchmarkFixtureDefinition["source"];
  license: BenchmarkFixtureDefinition["license"];
}

export interface BenchmarkCheckEvidence {
  passed: boolean;
  evidenceIds: string[];
  detail?: string;
}

export interface BenchmarkValidationContext {
  project?: import("../../../project-v2-types.ts").ProjectV2;
  expectedArtifacts: readonly string[];
  observedArtifacts: readonly string[];
  evidence: Readonly<Record<string, BenchmarkCheckEvidence>>;
}

export interface BenchmarkValidationResult extends BenchmarkCheckEvidence {
  checkId: string;
  hardBlocker: boolean;
}
