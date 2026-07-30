# Drops Studio Agent Intelligence Stack v2 — Implemented Blueprint

**Version:** 2.0.0  
**Status:** implementation and operations map

This blueprint adapts the supplied implementation contract to the current Drops Studio Project V2 and Vercel Sandbox codebase. The system extends the existing builder; it does not create a second filesystem, agent, provider vault, Sandbox, or publishing flow.

## Layers

```text
Project Studio
  → Agent Intelligence runtime wrapper
    → versioned runtime prompt + authorized model registry/router
    → Context Compiler (project + official Drops references)
    → bounded role orchestrator and atomic patch merge
    → existing BuilderAgentSession tools
    → existing one canonical Vercel Sandbox
    → existing build/preview/browser/repair/checkpoint flow
    → read-only Verifier
    → privacy-safe trace and internal eval dashboard
```

## Code map

- `lib/agent/system`: canonical marker loader, deterministic prompt composition, version pins.
- `lib/agent/models`: capability registry, four routing policies, roles, Quick Edit, AutoFix, Verifier, retry/circuit breaker, usage.
- `lib/agent/context`: source registry, redaction, typed chunkers, lexical/optional embedding retrieval, RRF/reranking/MMR, provenance, cache, private Blob snapshot adapter.
- `lib/agent/orchestrator`: validated DAG, scheduler, file leases, patch validator, atomic merge, cancellation/resume, run store.
- `lib/agent/subagents`: Planner, Frontend, Backend, Integration, QA, and Security capability boundaries.
- `lib/agent/runtime`: production wrapper joining the new layers to `lib/builder-agent`.
- `lib/agent/evals`: traces, taxonomy, 20+ benchmarks, experiments, aggregates, repair examples, release gate, private store.
- `app/api/internal/agent-evals`: authenticated summary and runner APIs.
- `components/project-v2-agent-intelligence.tsx`: current project run evidence.
- `app/internal/agent-evals`: internal evaluation control room.

## Default rollout

- composite routing: enabled;
- Quick Edit: enabled;
- independent Verifier: enabled;
- hybrid retrieval: enabled;
- embeddings: disabled until configured;
- parallel patch roles: deterministic canary, at most three;
- isolated per-role Sandboxes: disabled;
- canonical Sandbox count: one;
- privacy-safe traces: enabled;
- eval dashboard: internal-only;
- experiments: disabled until configured.

BYOK and custom providers stay request-only. Selected-only routing cannot silently change model or provider. Free Auto remains the existing deterministic Project V2 fallback.

## Proof boundaries

Unit and contract tests prove schemas, routing, retrieval, scoping, redaction, DAG scheduling, overlapping-role prevention, parallel overlap, patch validation, atomic merge, AutoFix bounds, Verifier authority, trace privacy, benchmark comparison, and experiment rollback.

The opt-in seeded live test additionally proves:

1. whale-intelligence Project V2 materialization;
2. Router and Planner selection;
3. exact project symbol and documented Drops reference retrieval;
4. concurrent disjoint Frontend and Integration patch proposals;
5. atomic canonical merge;
6. a seeded TypeScript failure;
7. bounded repair;
8. the real Vercel Sandbox install/typecheck/lint/tests/build/dev server;
9. a real Sandbox URL and browser primary interaction;
10. read-only QA/Security and final Verifier evidence;
11. checkpoint and restore;
12. private trace persistence and dashboard summary.

The test is opt-in because it consumes Vercel Sandbox resources. Routine CI remains deterministic and uses no live DropsTab quota or external Telegram/webhook/deployment mutation.

## Rollback

The original `runBuilderAgent` and Legacy HTML Runtime Adapter remain intact. The intelligence wrapper is feature-flagged and can fall back to the existing Project V2 builder without changing project files. Traces and context snapshots are disposable derived data; Project V2 source/checkpoints remain canonical.
