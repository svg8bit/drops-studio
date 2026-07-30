export const AGENT_TRACE_SCHEMA_VERSION = 2 as const;

export type AgentFailureClass =
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

export type AgentVerificationVerdict =
  | "PASS"
  | "PASS_WITH_SETUP_REQUIRED"
  | "RETRYABLE_FAILURE"
  | "BLOCKED"
  | "UNSAFE";

export interface AgentTraceVersions {
  runtimeContract: string;
  prompt: string;
  routing: string;
  contextCompiler: string;
  orchestrator: string;
  evals: string;
  projectSchema: 2;
  selectedSkills: Record<string, string>;
}

export interface AgentTraceRoute {
  routeId: string;
  role:
    | "router"
    | "planner"
    | "coder"
    | "quick-edit"
    | "autofix"
    | "verifier"
    | "reranker"
    | "eval-judge";
  provider: string;
  model: string;
  policy: "selected-only" | "auto-balanced" | "auto-quality" | "auto-economy";
  reasonCodes: string[];
  fallback: boolean;
  startedAt: string;
  finishedAt: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AgentTraceContextPackage {
  packageId: string;
  queryId: string;
  retrievalMode: "hybrid" | "lexical-only";
  sourceIds: string[];
  chunkIds: string[];
  omittedReasons: string[];
  estimatedTokens: number;
  compiledAt: string;
}

export interface AgentTraceRoleRun {
  roleRunId: string;
  taskId: string;
  role: "planner" | "frontend" | "backend" | "integration" | "qa" | "security";
  modelRouteId: string;
  status: "queued" | "running" | "proposed" | "merged" | "failed" | "cancelled" | "blocked";
  readScopes: string[];
  writeScopes: string[];
  startedAt: string;
  finishedAt: string;
  changedFiles: string[];
  findingIds: string[];
}

export interface AgentTraceFinding {
  findingId: string;
  role: "qa" | "security" | "verifier" | "release-gate";
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string;
  title: string;
  evidenceIds: string[];
  relevantPaths: string[];
  blocksVerification: boolean;
}

export interface AgentTraceCheck {
  checkId: string;
  name: "schema" | "install" | "typecheck" | "lint" | "tests" | "build" | "preview" | "browser" | "security";
  status: "passed" | "failed" | "skipped";
  evidenceId: string;
  durationMs: number;
  firstPass: boolean;
}

export interface AgentRunTrace {
  schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
  traceId: string;
  runId: string;
  actorHash: string;
  projectId: string;
  projectRevisionStart: number;
  projectRevisionFinal: number;
  promptFingerprint: string;
  promptSummary: string;
  versions: AgentTraceVersions;
  configurationId: string;
  experimentId: string | null;
  assignment: string | null;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "blocked" | "unsafe" | "cancelled";
  failureClass: AgentFailureClass;
  routes: AgentTraceRoute[];
  contextPackages: AgentTraceContextPackage[];
  roleRuns: AgentTraceRoleRun[];
  findings: AgentTraceFinding[];
  checks: AgentTraceCheck[];
  repairs: Array<{
    attempt: number;
    failureClass: AgentFailureClass;
    strategy: "deterministic" | "model";
    changedFiles: string[];
    result: "passed" | "failed";
  }>;
  verification: {
    verdict: AgentVerificationVerdict;
    deterministicGatePassed: boolean;
    setupRequired: string[];
    evidenceIds: string[];
  };
  firstPass: {
    build: boolean;
    preview: boolean;
    browser: boolean;
  };
  final: {
    build: boolean;
    preview: boolean;
    browser: boolean;
    primaryInteraction: boolean;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedModelCostUsd: number;
    sandboxDurationMs: number;
    totalLatencyMs: number;
  };
}

export type BenchmarkCase = import("./benchmarks/types.ts").BenchmarkCaseV3;

export interface BenchmarkConfiguration {
  id: string;
  label: string;
  routingPolicy: AgentTraceRoute["policy"];
  hybridRetrieval: boolean;
  parallelSubagents: boolean;
  verifier: boolean;
}

export interface BenchmarkCaseResult {
  caseId: string;
  configurationId: string;
  passed: boolean;
  routeMatched: boolean;
  contextRecall: number;
  deterministicGatePassed: boolean;
  verdict: AgentVerificationVerdict;
  firstPassSuccess: boolean;
  finalSuccess: boolean;
  repairCount: number;
  latencyMs: number;
  estimatedCostUsd: number;
  failureClass: AgentFailureClass;
  evidenceIds: string[];
}

export interface BenchmarkReport {
  schemaVersion: 1;
  reportId: string;
  suite: "local-fast" | "ci" | "nightly" | "release";
  createdAt: string;
  finishedAt: string;
  benchmarkVersion: string;
  cases: BenchmarkCaseResult[];
  configurations: Array<{
    id: string;
    label: string;
    cases: number;
    successRate: number;
    firstPassRate: number;
    averageRepairCount: number;
    averageLatencyMs: number;
    totalEstimatedCostUsd: number;
    deterministicBlockers: number;
  }>;
  releaseGate: {
    passed: boolean;
    blockers: string[];
  };
}

export interface AgentEvalSummary {
  generatedAt: string;
  traces: number;
  reports: number;
  workingPreviewRate: number;
  firstPassPreviewRate: number;
  averageRepairs: number;
  averageLatencyMs: number;
  estimatedModelCostUsd: number;
  failureClasses: Array<{ failureClass: AgentFailureClass; count: number }>;
  latestTraces: AgentRunTrace[];
  latestReports: BenchmarkReport[];
}
