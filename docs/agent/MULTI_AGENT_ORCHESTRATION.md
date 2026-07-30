# Drops Studio Multi-Agent Orchestration

**Contract version:** 1.0.0  
**Implementation:** `lib/agent/orchestrator/**` and `lib/agent/subagents/**`  
**Status:** working deterministic orchestration core

This document adapts the supplied orchestration contract to Drops Studio's existing Project V2 filesystem. It describes implemented behavior, not a fictional set of chatbots.

## Runtime topology

```text
user goal
  -> Planner (read-only)
  -> validated acyclic task graph
  -> Frontend / Backend / Integration patch proposals
  -> lease + hash + policy validation
  -> one atomic Project V2 revision
  -> canonical Sandbox integration (owned by the builder runtime)
  -> QA + Security (read-only, parallel when independent)
  -> Verifier integration
```

The Orchestrator is the only authority that can change the canonical project. A role callback can inspect only its scoped context and return either a patch proposal or findings. It never receives direct Project V2 mutation methods, deployment methods, provider credentials, or an unrestricted shell.

The orchestration package deliberately does not create a second Sandbox. The existing builder/runtime layer owns the one canonical Vercel Sandbox after patches have merged.

## Roles and hard boundaries

| Role | Files visible | Mutation output | Capabilities |
| --- | --- | --- | --- |
| Planner | assigned read scopes | none | list/read |
| Frontend | assigned read and frontend write scopes | patch proposal | list/read/propose patch |
| Backend | assigned read and server/data write scopes | patch proposal | list/read/propose patch |
| Integration | assigned read and adapter write scopes | patch proposal | list/read/propose patch |
| QA | assigned read scopes | none | list/read/report findings |
| Security | assigned read scopes | none | list/read/report findings |

`createRoleContext()` constructs a frozen, scope-filtered snapshot. Unrelated files are omitted rather than hidden only through prompting. QA, Security, and Planner results are rejected if they contain a patch bundle.

Every external or destructive action remains Orchestrator/user approval gated. Subagents cannot connect providers, register webhooks, publish Telegram posts, push GitHub changes, open PRs, deploy, mutate production databases, create paid resources, or perform wallet/trade actions.

## Task graph

`AgentTask` contains:

- run and task identifiers;
- role, objective, priority, and dependencies;
- canonical base revision and content hash;
- read, write, protected, and integration scopes;
- context query and skill identifiers;
- model route evidence;
- read-only or patch-only execution mode;
- acceptance checks and expected artifacts;
- risk and estimated cost;
- strict model/tool/time/file/line limits;
- durable status.

`validateTaskGraph()` enforces a strict schema, unique IDs, one run ID, known dependencies, valid POSIX scope patterns, role permissions, and acyclicity before a callback runs. `deterministicTopologicalOrder()` uses priority followed by stable task ID ordering.

## Deterministic scheduling

Defaults:

```yaml
max_active_subagents: 3
max_parallel_model_calls: 3
max_total_role_calls_per_run: 12
max_estimated_cost_usd: 5
max_isolated_sandboxes: 1
```

The scheduler selects deterministic non-overlapping waves. A wave is executed with real `Promise.all`; timing records contain start/finish timestamps and event order. Overlapping write scopes are delayed to a later wave. Read-only QA and Security work may overlap.

The scheduler enforces:

- active-role and parallel-model caps of at most three;
- aggregate role/model-call budgets;
- estimated cost ceiling;
- per-task timeout;
- `AbortSignal` cancellation propagation;
- dependent-task blocking after failure/cancellation;
- stable launch order for identical graphs.

No callback result is applied by the scheduler itself.

## File leases

Before patch work runs, `FileLeaseRegistry` reserves normalized write patterns for one task and canonical revision. Concurrent overlapping patterns are rejected. The scheduler releases its execution lease when the callback settles; the Orchestrator reacquires the same revision/scope as a merge lease before validating any returned proposal. Leases expire after the task timeout plus a small merge allowance and are released after their bounded phase.

Supported patterns use relative POSIX segments and bounded `*` / `**` wildcards. Absolute paths, traversal, backslashes, NULs, padded paths, and malformed segments are rejected.

## Patch protocol

Builder roles return a strict `PatchBundle`:

```ts
interface PatchBundle {
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
```

Every changed path requires an expected hash (`null` means it must not exist). Validation happens before canonical mutation:

1. strict Zod schema;
2. role/task identity;
3. base revision and canonical content hash;
4. active lease and path scope;
5. protected-file policy;
6. per-task changed-file and changed-line limits;
7. expected file hashes;
8. shared artifact secret scanner;
9. exact-semver dependency policy.

Patch writes and renames must use `ai` provenance. Direct `package.json` edits are protected; dependency changes use the typed dependency channel and are reconciled by the Orchestrator.

## Atomic merge gate

`mergePatchBundlesAtomically()` validates every proposal against the same immutable Project V2 base before applying anything. It then:

- sorts proposals deterministically by task ID;
- rejects overlapping path ownership;
- rejects conflicting dependency changes;
- combines operations and the reconciled package manifest;
- calls the existing `applyProjectV2FileOperations()` exactly once;
- revalidates the resulting Project V2 canonical hash and schema.

Because the existing Project V2 operation applies to an internal clone, any later operation failure leaves the input project byte-for-byte unchanged.

Stale base/hash and bundle conflicts return `rerun-required` with a reason code. They are never resolved through blind text merging.

## Cancellation, failure, and resume

`MultiAgentOrchestrator` owns a run-level `AbortController`. Cancellation propagates to active task signals. Callbacks that ignore cancellation can finish only against their private context; their output is not merged.

`AgentRunStore` is injectable. `MemoryAgentRunStore` is the in-process implementation and clones all writes/reads to prevent external mutation. A failed run records its last canonical Project V2 revision. `resume()` requeues unfinished tasks, rebases them to that canonical revision, and never reruns already merged tasks.

A failed task cannot modify the canonical project. Successfully merged earlier waves remain durable and auditable; the failed wave remains unmerged.

## Canonical Sandbox boundary

Parallel builder roles produce patches against immutable Project V2 snapshots. After the merge gate creates a canonical revision, the surrounding builder pipeline may write that revision to the existing `VercelSandboxRuntimeAdapter` for install/build/test/preview. This module exposes no mock terminal, fake logs, fake preview URL, or alternative Sandbox implementation.

## Seeded proof helper

`runSeededParallelExecution()` provides deterministic application-level evidence:

1. Planner emits a validated Frontend/Integration/QA/Security DAG;
2. Frontend and Integration use disjoint scopes and execute in one real `Promise.all` wave;
3. both return hash-bound patch bundles from the same Project V2 revision;
4. both patches merge as one atomic canonical revision;
5. QA and Security receive the merged revision and execute in one read-only parallel wave;
6. the returned evidence includes timelines and explicit overlap booleans.

It adds a category-native whale-intelligence UI evidence component and truthful DropsTab proxy-or-demo provider evidence. It does not call an external provider or claim a live connection.

## Tests

The focused suite is:

```bash
node --test tests/agent-orchestrator-*.test.mjs
```

It covers:

- cyclic DAG rejection;
- deterministic launch order;
- maximum concurrency/model/cost limits;
- real parallel overlap;
- overlap serialization;
- cancellation and dependent blocking;
- stale base/hash rerun outcomes;
- out-of-scope and protected path rejection;
- secret/dependency rejection;
- atomic rollback and conflict rejection;
- context minimization;
- reviewer mutation denial;
- external-action denial;
- failure preserving canonical state;
- durable resume;
- seeded Planner to parallel builders to atomic merge to parallel reviewers proof.

## Integration notes

- Composite model routing supplies the `modelRouteId` and role callbacks.
- Context Compiler supplies `contextQueryIds` and the already-redacted scoped excerpts.
- The builder orchestrator invokes the canonical Sandbox only after merge.
- AutoFix is represented as a new bounded Backend/Frontend/Integration repair task, never a reviewer mutation.
- Verifier consumes canonical checks and findings; it does not receive unmerged patches.
- UI/trace layers must render the recorded task/timeline state rather than inferred “agent working” animation.
