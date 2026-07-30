import { defineBenchmarkCase } from "../define-case.ts";
import type { BenchmarkCaseV3 } from "../types.ts";

interface OrchestrationInput {
  id: string;
  title: string;
  prompt: string;
  fixture: string;
  capability: string;
  artifact: string;
  context: [string, string, ...string[]];
  checks: [string, ...string[]];
  forbidden: string;
  blocker: string;
  seed?: string;
  expectedBlock?: boolean;
  category?: "build" | "edit" | "repair" | "release";
}

function orchestration(input: OrchestrationInput): BenchmarkCaseV3 {
  return defineBenchmarkCase({
    id: input.id,
    title: input.title,
    suite: "multi-agent-orchestration",
    intentKey: `${input.id}-intent`,
    prompt: input.prompt,
    fixtureProject: input.fixture,
    requiredCapabilities: ["parallel-agent-orchestration", input.capability],
    expectedArtifacts: ["orchestration-trace", input.artifact],
    deterministicChecks: [...new Set(["project-v2-valid", "expected-artifacts", ...input.checks])],
    forbiddenClaims: [input.forbidden],
    hardBlockers: [input.blocker],
    seededFailures: input.seed ? [input.seed] : [],
    legacyDeterministicBlocker: input.expectedBlock ? input.blocker : undefined,
    maxDurationMs: 300_000,
    maxEstimatedCostUsd: 1.2,
    tags: ["v3", "orchestration", input.capability],
    category: input.category ?? "build",
    expectedRoute: input.category === "repair" ? "autofix" : "planner",
    requiredContext: input.context,
    requiresApprovalBoundary: false,
  });
}

export const ORCHESTRATION_BENCHMARK_CASES: readonly BenchmarkCaseV3[] = [
  orchestration({
    id: "orchestrate-parallel-frontend-integration",
    title: "Parallel frontend and integration work",
    prompt: "Plan independent frontend composition and typed integration adapter tasks in parallel, then merge their disjoint patches atomically before running the shared verification stage.",
    fixture: "whale-intelligence",
    capability: "disjoint-parallelism",
    artifact: "parallel-merge-evidence",
    context: ["task-dag", "file-scopes", "verification-stage"],
    checks: ["dag-acyclic", "concurrency-limit", "atomic-merge"],
    forbidden: "parallel agents mutate the canonical project directly",
    blocker: "a partial or overlapping patch becomes canonical",
  }),
  orchestration({
    id: "orchestrate-overlapping-scope-serialize",
    title: "Serialize overlapping agent scopes",
    prompt: "Detect two planned agent tasks that both modify the same route module, serialize them through an explicit dependency, and keep unrelated test work parallel.",
    fixture: "multipage-saas",
    capability: "scope-conflict-detection",
    artifact: "serialized-conflict-plan",
    context: ["task-file-scopes", "route-module", "dependency-edges"],
    checks: ["dag-acyclic", "concurrency-limit", "patch-scope"],
    forbidden: "overlapping file scopes execute concurrently",
    blocker: "two concurrent patches target the same canonical file",
    seed: "project-schema-scope-conflict",
  }),
  orchestration({
    id: "orchestrate-stale-patch-rerun",
    title: "Rerun agent after stale patch conflict",
    prompt: "When a subagent patch targets an obsolete base revision, reject it without partial apply, refresh only that task context, and rerun against the current canonical revision.",
    fixture: "multipage-saas",
    capability: "stale-patch-recovery",
    artifact: "stale-task-rerun-evidence",
    context: ["base-revision", "canonical-revision", "task-context"],
    checks: ["revision-conflict", "atomic-merge", "patch-scope"],
    forbidden: "a stale patch is force-applied over newer user work",
    blocker: "canonical state contains hunks from an obsolete revision",
    seed: "project-schema-stale-patch",
    category: "repair",
  }),
  orchestration({
    id: "orchestrate-atomic-merge-rollback",
    title: "Rollback failed multi-patch merge atomically",
    prompt: "Apply a batch of disjoint verified subagent patches as one revision and restore the exact prior snapshot when the final patch fails validation.",
    fixture: "whale-intelligence",
    capability: "atomic-batch-rollback",
    artifact: "merge-rollback-evidence",
    context: ["candidate-patches", "pre-merge-hash", "validation-result"],
    checks: ["atomic-merge", "checkpoint-hash", "revision-conflict"],
    forbidden: "earlier patches remain committed after batch failure",
    blocker: "a failed merge changes the canonical project hash",
    seed: "project-schema-merge-rollback",
    category: "repair",
  }),
  orchestration({
    id: "orchestrate-cancel-resume-durable",
    title: "Cancel and resume durable agent run",
    prompt: "Propagate cancellation to active child tasks, persist completed evidence and the last canonical revision, then resume only unfinished work without replaying external actions.",
    fixture: "alpha-channel",
    capability: "durable-cancel-resume",
    artifact: "cancel-resume-trace",
    context: ["run-state", "child-task-state", "canonical-revision"],
    checks: ["cancellation-propagated", "resume-canonical-revision", "atomic-merge"],
    forbidden: "resume repeats a completed publication or provider action",
    blocker: "cancelled child work mutates the project after cancellation",
    seed: "cancelled-agent-run",
  }),
  orchestration({
    id: "orchestrate-qa-security-parallel",
    title: "Parallel QA and security verification",
    prompt: "After a stable candidate revision, run browser QA and security artifact checks in parallel, collect independent evidence, and join both before the Verifier decides release.",
    fixture: "integration-lab",
    capability: "parallel-verification",
    artifact: "joined-verification-evidence",
    context: ["candidate-revision", "qa-task", "security-task"],
    checks: ["dag-acyclic", "concurrency-limit", "verifier-authority"],
    forbidden: "one verification branch can hide failure in the other",
    blocker: "release verdict occurs before all required evidence joins",
    category: "release",
  }),
  orchestration({
    id: "orchestrate-security-blocks-verifier",
    title: "Security agent blocks final verifier",
    prompt: "Propagate a hard security finding from a child task to the independent Verifier, cancel unnecessary downstream work, and preserve the blocking evidence in the final run result.",
    fixture: "integration-lab",
    capability: "hard-block-propagation",
    artifact: "security-blocked-run",
    context: ["security-finding", "task-dag", "verifier-input"],
    checks: ["verifier-authority", "cancellation-propagated", "trace-privacy"],
    forbidden: "majority task success overrides a hard security finding",
    blocker: "the run reports success despite a security hard blocker",
    seed: "security-secret-material",
    expectedBlock: true,
    category: "release",
  }),
  orchestration({
    id: "orchestrate-cost-concurrency-cap",
    title: "Respect cost and concurrency caps",
    prompt: "Schedule a wide task graph under configured concurrency and estimated-cost ceilings, prioritizing critical-path work and deferring optional agents without starving verification.",
    fixture: "multipage-saas",
    capability: "resource-aware-scheduling",
    artifact: "bounded-schedule-evidence",
    context: ["task-estimates", "concurrency-cap", "cost-budget"],
    checks: ["dag-acyclic", "concurrency-limit", "trace-privacy"],
    forbidden: "all ready tasks start regardless of resource limits",
    blocker: "active tasks or estimated spend exceed configured ceilings",
  }),
  orchestration({
    id: "orchestrate-cyclic-dag-rejection",
    title: "Reject cyclic agent dependency graph",
    prompt: "Reject a planned task graph containing a dependency cycle before any child agent starts, return the exact cycle, and request a corrected bounded plan.",
    fixture: "multipage-saas",
    capability: "dag-cycle-detection",
    artifact: "cyclic-plan-rejection",
    context: ["task-graph", "dependency-cycle", "planner-revision"],
    checks: ["dag-acyclic", "verifier-authority"],
    forbidden: "a cyclic graph enters the scheduler queue",
    blocker: "any child task starts from an invalid cyclic plan",
    seed: "project-schema-cyclic-dag",
    expectedBlock: true,
  }),
  orchestration({
    id: "release-checkpoint-restore",
    title: "Restore full project checkpoint after run",
    prompt: "Create a content-addressed checkpoint before a multi-agent edit, restore the complete Project V2 snapshot afterward, and prove files, metadata, and revision hash match.",
    fixture: "whale-intelligence",
    capability: "checkpoint-orchestration",
    artifact: "checkpoint-restore-evidence",
    context: ["checkpoint-snapshot", "candidate-revision", "restored-revision"],
    checks: ["checkpoint-hash", "atomic-merge", "resume-canonical-revision"],
    forbidden: "restore changes only selected files and leaves metadata stale",
    blocker: "restored project hash differs from the checkpoint snapshot",
    category: "release",
  }),
] as const;
