import type { ProjectFileOperationV2, ProjectV2 } from "../../project-v2-types.ts";

export const SUBAGENT_ROLES = [
  "planner",
  "frontend",
  "backend",
  "integration",
  "qa",
  "security",
] as const;

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

export type AgentTaskStatus =
  | "queued"
  | "ready"
  | "running"
  | "waiting"
  | "proposed"
  | "merged"
  | "failed"
  | "cancelled"
  | "blocked";

export interface AgentTask {
  taskId: string;
  runId: string;
  role: SubagentRole;
  title: string;
  objective: string;
  dependencies: string[];
  priority: number;
  baseRevision: number;
  baseContentHash: string;
  readScopes: string[];
  writeScopes: string[];
  protectedScopes: string[];
  integrationScopes: string[];
  contextQueryIds: string[];
  selectedSkills: string[];
  modelRouteId: string;
  executionMode: "read-only" | "patch-only";
  acceptanceChecks: string[];
  expectedArtifacts: string[];
  risk: "low" | "medium" | "high" | "critical";
  estimatedCostUsd: number;
  limits: {
    maxModelCalls: number;
    maxToolCalls: number;
    timeoutMs: number;
    maxChangedFiles: number;
    maxChangedLines: number;
  };
  status: AgentTaskStatus;
}

export interface DependencyChange {
  name: string;
  version?: string;
  dev: boolean;
  action: "add" | "remove";
}

export interface PatchBundle {
  taskId: string;
  role: "frontend" | "backend" | "integration";
  baseRevision: number;
  baseContentHash: string;
  expectedFileHashes: Record<string, string | null>;
  operations: ProjectFileOperationV2[];
  dependencyChanges: DependencyChange[];
  testsToRun: string[];
  summary: string;
  unresolvedAssumptions: string[];
  contextProvenanceIds: string[];
}

export interface Finding {
  findingId: string;
  role: "qa" | "security";
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string;
  title: string;
  detail: string;
  evidenceIds: string[];
  relevantPaths: string[];
  recommendedAction: string;
  blocksVerification: boolean;
}

export interface PlannerResult {
  architecture: string[];
  taskGraph: AgentTask[];
  decisions: Array<{ decision: string; reasonCodes: string[] }>;
  setupRequired: string[];
  unsupported: string[];
  acceptanceMatrix: string[];
}

export interface BuilderSubagentResult {
  taskId: string;
  patchBundle: PatchBundle;
  evidenceIds: string[];
  assumptions: string[];
  followUps: string[];
}

export interface QaResult {
  findings: Finding[];
  checksRequested: string[];
  primaryFlowStatus: "unverified" | "failed" | "passed";
  repairTasks: AgentTask[];
}

export interface SecurityResult {
  findings: Finding[];
  blocked: boolean;
  requiredApprovals: string[];
  repairTasks: AgentTask[];
}

export type RoleResult =
  | PlannerResult
  | BuilderSubagentResult
  | QaResult
  | SecurityResult;

export interface FileLease {
  leaseId: string;
  taskId: string;
  baseRevision: number;
  patterns: string[];
  expiresAt: string;
}

export interface RoleContext {
  runId: string;
  task: AgentTask;
  projectId: string;
  baseRevision: number;
  baseContentHash: string;
  files: Readonly<Record<string, Readonly<{ path: string; content: string; hash: string }>>>;
  contextQueryIds: readonly string[];
  selectedSkills: readonly string[];
  integrationScopes: readonly string[];
  acceptanceChecks: readonly string[];
  capabilities: readonly RoleCapability[];
  signal: AbortSignal;
}

export type RoleCapability =
  | "list-files"
  | "read-file"
  | "propose-patch"
  | "report-findings";

export type RoleExecutionCallback = (
  context: RoleContext,
) => Promise<RoleResult>;

export interface AgentTaskTimeline {
  taskId: string;
  role: SubagentRole;
  startedAt: string;
  finishedAt: string;
  startedOrder: number;
  finishedOrder: number;
  status: "succeeded" | "failed" | "cancelled";
  error?: string;
}

export interface AgentRunState {
  runId: string;
  status: "planning" | "building" | "reviewing" | "completed" | "failed" | "cancelled";
  canonicalProject: ProjectV2;
  tasks: AgentTask[];
  timelines: AgentTaskTimeline[];
  mergeRevision?: number;
  findings: Finding[];
  createdAt: string;
  updatedAt: string;
  failure?: string;
}

export interface SchedulerLimits {
  maxActiveSubagents: number;
  maxParallelModelCalls: number;
  maxTotalRoleCallsPerRun: number;
  maxEstimatedCostUsd: number;
}

export interface SchedulerResult<T> {
  results: Map<string, T>;
  timelines: AgentTaskTimeline[];
  statuses: Map<string, AgentTaskStatus>;
  maxObservedConcurrency: number;
}

export interface MergeSuccess {
  status: "merged";
  project: ProjectV2;
  mergedTaskIds: string[];
  changedPaths: string[];
}

export interface MergeRerunRequired {
  status: "rerun-required";
  project: ProjectV2;
  taskIds: string[];
  reason: string;
  code: "stale-base" | "stale-hash" | "bundle-conflict";
}

export type MergeResult = MergeSuccess | MergeRerunRequired;
