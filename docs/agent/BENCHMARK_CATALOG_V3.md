# Agent Benchmark Catalog V3

Version: `agent-data-driven-v3.0`
Canonical registry: `lib/agent/evals/benchmark-registry.ts`
Catalog size: **120 deterministic cases**

This catalog replaces the small V2 fixture list without creating a second registry. It is the repository-owned contract for local, CI, nightly, release, and explicitly enabled live evaluation. Cases are strict-schema data: they do not contain executable callbacks, arbitrary browser JavaScript, credentials, or mutable canonical failure fixtures.

## Distribution

| Suite | Cases | Primary evidence |
| --- | ---: | --- |
| New product generation | 24 | Project V2, build, preview, browser flow |
| Existing project editing | 18 | bounded diff, revision, focused checks |
| Debugging and repair | 18 | seeded diagnostic, patch, rerun evidence |
| Drops integrations | 15 | documented operation and provider evidence |
| Security and approval | 15 | denial/block evidence and independent gate |
| Context retrieval | 10 | recall, freshness, provenance, isolation |
| Design and responsive | 10 | 1440/1024/390 captures and browser checks |
| Multi-agent orchestration | 10 | DAG, scopes, atomic merge, cancellation |
| **Total** | **120** | |

## Case IDs

### New product generation (24)

- `build-whale-intelligence`, `build-alpha-channel`, `build-market-reactive-game`, `build-unlock-calendar`
- `build-market-aggregator`, `build-prediction-impact`, `build-multipage-crypto-saas`, `build-wallet-alert-workflow`
- `build-token-research-terminal`, `build-funding-investor-radar`, `build-portfolio-risk-lab`, `build-airdrop-research-board`
- `build-dao-governance-monitor`, `build-defi-yield-comparison`, `build-onchain-activity-timeline`, `build-exchange-listing-watch`
- `build-token-comparison`, `build-unlock-risk-simulator`, `build-community-sentiment-brief`, `build-crypto-news-research-hub`
- `build-market-anomaly-monitor`, `build-wallet-cohort-analysis`, `build-project-data-webhook-inbox`, `build-telegram-research-digest`

### Existing project editing (18)

- `edit-button-copy`, `edit-mobile-filter`, `edit-multi-route`, `edit-add-wallet-column`, `edit-reorder-unlock-table`, `edit-add-coin-search`
- `edit-provider-fallback-copy`, `edit-add-token-detail-route`, `edit-refactor-market-card-component`, `edit-migrate-fetch-server-proxy`
- `edit-add-project-data-form`, `edit-rename-integration-module`, `edit-remove-unused-dependency`, `edit-update-env-schema-no-values`
- `edit-add-unit-test-existing-hook`, `edit-preserve-manual-file-provenance`, `edit-conflicting-user-revision`, `edit-accessible-filter-controls`

### Debugging and repair (18)

- `repair-missing-dependency`, `repair-typescript`, `repair-browser`, `repair-invalid-import-export`, `repair-malformed-package-json`
- `repair-next-client-boundary`, `repair-broken-api-route`, `repair-root-asset-path`, `repair-integration-response-shape`
- `repair-responsive-overflow`, `repair-accessibility-name`, `repair-stale-patch-rebase`, `repair-install-failure`
- `repair-lint-hooks`, `repair-test-regression`, `repair-preview-port-timeout`, `repair-json-schema-output`, `repair-incomplete-stream`

### Drops integrations (15)

- `integration-dropstab-fallback`, `integration-dropsbot-unsupported`, `integration-webhook-registration`, `integration-telegram-delivery`
- `integration-dropstab-coins-selection`, `integration-dropstab-unlocks-selection`, `integration-dropstab-funding-normalization`
- `integration-dropstab-activities-rate-limit`, `integration-dropsbot-webhook-verification`, `integration-dropsbot-replay-rejection`
- `integration-wallet-event-enrichment`, `integration-alert-rule-filtering`, `integration-telegram-mtproto-handoff`
- `integration-telegram-botapi-fallback`, `integration-provider-evidence-expiry`

### Security and approval (15)

- `security-prompt-injection`, `security-secret-source`, `security-cross-tenant`, `release-verifier-blocks-build`
- `release-preview-ready`, `release-trace-privacy`, `security-ssrf-custom-provider`, `security-path-traversal-patch`
- `security-null-byte-file`, `security-oversized-output`, `security-production-env-sandbox`
- `security-approval-webhook-bypass`, `security-approval-github-push`, `security-token-artifact-containment`
- `security-provider-capability-escalation`

### Context retrieval (10)

- `retrieve-project-symbol`, `retrieve-dropstab-endpoint`, `retrieve-lexical-fallback`, `retrieve-current-over-stale-doc`
- `retrieve-openapi-exact-operation`, `retrieve-project-neighbor-chunks`, `retrieve-tenant-isolated-identical-symbol`
- `retrieve-token-budget-pruning`, `retrieve-prompt-injection-labeled-source`, `retrieve-cache-invalidation-revision`

### Design and responsive (10)

- `design-whale-premium-directions`, `design-alpha-channel-telegram-native`, `design-crypto-game-playable-mobile`
- `design-market-aggregator-density`, `design-multipage-saas-navigation`, `design-mobile-390-hierarchy`
- `design-tablet-1024-composition`, `design-accessibility-contrast-focus`, `design-non-generic-category-native`
- `design-visual-verifier-blocks-overflow`

### Multi-agent orchestration (10)

- `orchestrate-parallel-frontend-integration`, `orchestrate-overlapping-scope-serialize`, `orchestrate-stale-patch-rerun`
- `orchestrate-atomic-merge-rollback`, `orchestrate-cancel-resume-durable`, `orchestrate-qa-security-parallel`
- `orchestrate-security-blocks-verifier`, `orchestrate-cost-concurrency-cap`, `orchestrate-cyclic-dag-rejection`
- `release-checkpoint-restore`

## Fixture and failure model

Eleven Project V2 fixture definitions materialize through the production project factory, template materializer, and validator. Their timestamp is fixed, so the canonical file and project hashes are deterministic. Repository starters retain repository licensing; synthetic fixtures are declared `CC0-1.0`.

Failure seeds are separate, declarative envelopes. Every seed has `canonicalCommitAllowed: false`; materialization never applies a seed to the canonical project. The corpus covers dependencies, TypeScript, build/runtime errors, malformed streams, stale revisions, provider payloads, SSRF, traversal, secret-shaped material, permission bypass, task graph conflicts, rollback, and cancellation. Secret fixtures name a safe content factory and never include a usable token.

## Strict validators and browser flow

Each case names registered deterministic validators. Missing validators, fixtures, seeds, repeated IDs/intent keys/browser-flow IDs, duplicate prompts, near-duplicate prompts, or the wrong suite distribution reject the complete registry at module load.

Browser checks use a Zod-validated DSL limited to navigation, click, fill, bounded keypress, visibility/text/URL assertions, console/request/overflow checks, and Axe. It has relative-only paths, bounded selectors and values, a real timeout, and no `evaluate` or arbitrary code action.

The release gate requires exactly one result for every expected case in each observed configuration. Missing, unknown, and duplicate result IDs are blockers. The runner uses a wall-clock `Promise.race`, so an executor that ignores `AbortSignal` still cannot hang CI.

## Execution tiers

- `local-fast`: 16 stratified cases, exactly two from each suite.
- `ci`: all 120 deterministic repository-owned cases.
- `nightly` and `release`: all 120 deterministic cases.
- live subset: 20 explicit IDs in `LIVE_STRATIFIED_BENCHMARK_CASE_IDS`; network/provider/Sandbox execution remains behind an explicit environment gate in the live harness.

The offline runner is labelled contract-only. It proves routing, retrieval, data shape, timeout, and release-gate behavior; it is never described as a live model, provider, browser, or Sandbox run.

## Focused verification

```bash
node --test tests/agent-benchmark-v3-*.test.mjs tests/agent-evals-platform.test.mjs
npx tsc --noEmit --pretty false
npx eslint lib/agent/evals/benchmark-registry.ts lib/agent/evals/runner.ts lib/agent/evals/release-gate.ts lib/agent/evals/benchmarks tests/agent-benchmark-v3-*.test.mjs tests/agent-evals-platform.test.mjs
```
