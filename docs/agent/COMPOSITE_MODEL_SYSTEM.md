# Drops Studio Composite Model System

**Version:** 2.0.0  
**Status:** implemented runtime contract

Drops Studio routes each job through bounded roles rather than treating one
model call as the whole product agent:

```text
deterministic Router → Planner/Coder/Quick Edit → deterministic checks
→ bounded AutoFix → read-only Verifier
```

The implementation lives in `lib/agent/models`. It imports the established
builder provider identity types and does not introduce another provider or
billing path.

## Live capability registry

`AuthorizedModelRegistry` stores sanitized, non-secret metadata: provider,
model, authorization source, explicit capabilities, verified limits, role
allowlist, latency/quality classes, public prices, verification time, and
availability. An unknown capability remains `unknown` and never satisfies a
required capability. Registry snapshots contain no credentials.

## Routing policies

- `selected-only`: exact chosen authorized model for every supported role;
  mismatch stops and requests authorization instead of switching.
- `auto-balanced`: favors verified quality, latency, then cost within connected
  providers.
- `auto-quality`: favors the highest verified quality class, then least cost.
- `auto-economy`: favors least known cost, deterministic/Quick Edit behavior,
  then latency and quality.

The deterministic classifier handles obvious plan, local edit, multi-file,
repair, and verification tasks before any optional model router. Fallback chains
contain only compatible authorized models. Selected-only has no fallback. Route
records contain reason codes, budgets, policy version, cost band, and a stable
route id, never chain-of-thought.

## Role isolation

Planner, Router, Verifier, Retrieval Reranker, and Eval Judge are non-mutating.
Quick Edit validates revision, paths, four-file and 160-line limits and
escalates on dependency/scope/repeated-check changes. AutoFix applies a
deterministic fixer first, then at most three focused model repairs, and stops
on unchanged evidence. Credential, authorization, destructive-conflict, and
security-policy failures are never model-repaired. Verifier can read immutable
evidence only; required deterministic failures cannot become PASS.

## Provider reliability and cost evidence

`executeRoutedRole` performs at most one retry for a transient provider error,
then uses only the route's disclosed authorized fallback. Every attempt records
role, provider/model, fallback state, timing, result, error class, token usage,
and estimated USD cost when public rates are complete. Repeated role/model
failures open a project-local timed circuit breaker; this never disables the
user's provider globally.

## Versioned runtime contract

The canonical marked prompt is
`docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md`. The loader requires exactly one
marker pair and deterministic module order. Runs pin runtime prompt, config,
role prompt, routing policy, context compiler, model registry, selected skill,
and project revision versions plus content hashes.

## Proof coverage

Focused tests under `tests/agent-composite-*.test.mjs` cover deterministic
prompt extraction/composition, selected-only non-switching, unauthorized and
unknown capabilities, policy routing, bounded Quick Edit, circuit breaking,
single retry/disclosed fallback traces, AutoFix limits and forbidden classes,
Verifier tool isolation, and deterministic-gate authority.
