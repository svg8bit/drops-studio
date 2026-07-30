# Codex master prompt — implementation ledger

**Source brief:** `CODEX-MASTER-PROMPT.md` supplied by the product owner  
**Baseline commit:** `f47f14e`  
**Project V2 commit:** `129af40`  

This file makes the supplied master prompt discoverable under its original
filename and records where each requested capability lives. The source prompt
is an implementation brief, not a runtime system prompt; executable behavior
comes from typed code, strict schemas, permissions, tests, and real provider
evidence.

## Implemented V2 platform

| Requirement | Implementation |
|---|---|
| Multi-file Project V2 | `lib/project-v2-*`, project file/hash/validator tests |
| V1 compatibility | legacy HTML runtime adapter and migration tests |
| Vercel Sandbox | `lib/vercel-sandbox-runtime-adapter.ts`, cleanup and live opt-in tests |
| Builder tool loop | `lib/builder-agent/**`, `/api/builder/agent` |
| Real files/logs/checks/preview | Project V2 workspace and Builder release gate |
| Checkpoints and restore | Project V2 checkpoint/snapshot engines |
| Runnable ZIP/export | Project V2 export and portability tests |
| GitHub integration | `lib/github-integration.ts`, `/api/integrations/github` |
| Vercel deployment | `lib/vercel-deployment.ts`, `/api/deployments/vercel` |
| DropsTab/Drops Bot | typed modules under `lib/drops-platform/**` |
| Project data | capability-scoped Project V2 data service |
| Security boundaries | secret, path, SSRF, webhook, storage, runtime tests |

## Implemented Agent Intelligence V2

| Supplied design | Production implementation |
|---|---|
| Composite model system | `lib/agent/models/**` |
| Canonical runtime contract | `docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md` and `lib/agent/system/**` |
| Context Compiler/RAG | `lib/agent/context/**` |
| Multi-agent orchestration | `lib/agent/orchestrator/**`, `lib/agent/subagents/**` |
| Runtime integration | `lib/agent/runtime/**`, `/api/builder/agent` |
| AutoFix/Quick Edit/Verifier | strict role modules under `lib/agent/models/**` |
| Eval and feedback platform | `lib/agent/evals/**`, `/internal/agent-evals` |
| Project Studio evidence | Agent view in the unified Project V2 workspace |

The runtime resolves only an authorized request model, redacts context before
provider use, runs the existing strict Builder tools, executes the real release
gate, and applies an independent read-only Verifier. A failed Verifier verdict
downgrades the Builder result and cannot receive a server release receipt.

## Truthful current boundaries

- Free Auto remains deterministic and records no fictional model route.
- BYOK credentials remain request/session-only and are not persisted.
- The V2 parallel orchestrator is implemented and test-proven; production
  activation remains feature/canary controlled.
- V2 offline evals are labelled contract fixtures, not live-model evidence.
- Provider writes, Telegram delivery, deployment, GitHub mutation, webhook
  registration, and external database mutation retain explicit approval gates.
- No private keys, seed phrases, or automatic trading are supported.

## Data-driven V3 continuation

The current V3 branch adds, in this order:

1. immutable V2 baseline evidence;
2. compact core, isolated role prompts, and runtime skills;
3. streaming deterministic Stabilizer in shadow mode;
4. 120+ non-trivial benchmark cases;
5. authorized live-model measurements under an explicit cost cap;
6. 30+ verified repair traces;
7. first-class Design Agent and read-only Visual Verifier;
8. privacy-safe failure clustering;
9. versioned Router/AutoFix/prompt/skill candidates only after the data gate.

Production defaults do not change during evidence collection. Every candidate
must link to measured failure clusters, pass protected crypto/integration/design
slices, declare rollback configuration, and start as a stable 5% canary at most.

## Repository evidence

- Project V2 PR: `#3`.
- Agent Intelligence V2 PR: `#4`.
- V2 preview deployment: `dpl_GMwTiRkeaengmxJxW6yA2sEuwNss` (`READY`).
- V2 unit checkpoint: 562 passed, 2 opt-in skipped, 0 failed.
- TypeScript, ESLint, UI guardrails, and Vercel preview build passed.

The original attachment and this ledger have the same product intent. This
ledger is kept shorter so repository documentation stays synchronized with the
actual code and does not become a second, stale system prompt.
