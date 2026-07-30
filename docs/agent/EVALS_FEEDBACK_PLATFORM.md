# Drops Studio Agent Evals and Feedback Platform

**Version:** 2.0.0  
**Status:** implemented internal contract  
**Scope:** privacy-safe traces, deterministic benchmarks, experiments, repair examples, and release gates.

The source attachment set referenced this companion contract but did not include an `EVALS_FEEDBACK_PLATFORM.md` file. This document records the implemented contract derived from the canonical runtime, composite-model, RAG, multi-agent, blueprint, and master acceptance requirements. It does not claim to reproduce a missing source file.

## Authority

Deterministic checks remain release authority. An optional model judge may add a stricter finding, but it cannot turn a failed schema, build, preview, browser, secret, or permission check into `PASS`.

Verifier verdicts:

- `PASS`;
- `PASS_WITH_SETUP_REQUIRED`;
- `RETRYABLE_FAILURE`;
- `BLOCKED`;
- `UNSAFE`.

## Stored trace

`AgentRunTrace` stores:

- runtime, prompt, routing, context, orchestrator, eval, skill, model, and Project V2 versions;
- pseudonymous actor hash, project id, and project revisions;
- prompt fingerprint and a bounded redacted summary;
- role/model route decisions and disclosed fallback status;
- compiled-context package ids, retrieval mode, source/chunk ids, omitted reasons, and token estimate;
- actual role timelines, file scopes, merge state, checks, findings, AutoFix rounds, final verdict, latency, token usage, model cost estimate, and Sandbox duration;
- first-pass and final build/preview/browser outcomes.

It never stores credentials, raw private prompts, full private source, raw Sandbox environments, or private chain-of-thought. Trace writes run the shared credential scanner and support project deletion plus configured retention.

## Storage

The default store uses:

- process-local storage only when the repository's explicit local project-store mode is enabled;
- private Vercel Blob in configured deployments;
- no public Blob URL and no mandatory external analytics or vector database.

Production storage paths are tenant-pseudonymous and project-scoped. `DROPS_AGENT_TRACE_RETENTION_DAYS` is bounded to 1–365 days and defaults to 30.

## Benchmark registry

The versioned registry contains at least 20 fixtures across:

- category-native builds;
- bounded edits;
- dependency, TypeScript, and browser repair;
- exact symbol and Drops endpoint retrieval;
- lexical-only fallback;
- secret, injection, and cross-tenant attacks;
- DropsTab fallback truth;
- Drops Bot, webhook, and Telegram approval boundaries;
- build/preview/checkpoint/release verification.

Runners:

- `local-fast`: a small deterministic contract subset;
- `ci`: a broader deterministic regression set;
- `nightly`: the full registry when explicitly enabled;
- `release`: the full release-boundary registry.

The internal button labelled **Run contract fixtures** runs an offline contract suite. It is never shown as a live model or Sandbox run. Live executions appear only as stored real run traces.

## Metrics

The internal dashboard reports:

- working browser-verified preview rate;
- first-pass preview rate;
- final success rate;
- average repair rounds;
- context recall;
- route match;
- deterministic blocker count;
- latency;
- token usage and estimated model cost;
- failure taxonomy;
- configuration comparison.

The primary product metric is the percentage of user requests ending in a working preview with a browser-verified primary interaction.

## Experiments

Experiment assignment is deterministic from experiment id/version, actor hash, and project id. Canary variants have explicit weights and configuration ids. Auto-pause triggers on configured failure, cost, or deterministic-blocker regressions. Prompt experiments are disabled unless `DROPS_EXPERIMENTS_ENABLED=1`.

No experiment may:

- silently switch a selected-only provider/model;
- bypass approvals;
- weaken a security or release gate;
- retain private input without explicit opt-in.

## Repair dataset

Only repairs from a trace with a passing deterministic gate and `PASS` or `PASS_WITH_SETUP_REQUIRED` verdict can become a repair example. The stored example contains a failure class, redacted diagnostic category, strategy, path kinds, and evidence ids—not private source or hidden reasoning.

## Internal access

Routes under `/api/internal/agent-evals/*` require `DROPS_EVALS_INTERNAL_ACCESS_SECRET`. In production it must be at least 32 bytes. The client keeps the entered value only in page memory. Responses are `no-store`.

## Release blockers

- an unsafe result not correctly handled by its attack fixture;
- a verifier `PASS` over failed deterministic evidence;
- secret material in a trace or report;
- cross-tenant context evidence;
- fewer than 20 fixtures in CI/nightly/release;
- repair count above three;
- regression below configured success/context thresholds;
- unavailable required live preview or browser evidence in a real run.
