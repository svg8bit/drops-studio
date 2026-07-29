# Drops Studio competitive benchmark

Verified on 2026-07-29 against the public entry flows and official documentation of Replit Agent, Lovable, Bolt, v0 and Base44.

## Same-task test

Prompt used on every accessible product:

> Build a crypto Telegram alert channel powered by live market data, with wallet tracking, editable alert rules, a Telegram-native preview, and one-click publish.

| Product | Public entry result | Product strengths to learn from | Drops Studio decision |
| --- | --- | --- | --- |
| Replit Agent | The public app was blocked by Cloudflare in the isolated QA browser. Official docs were used for the workflow audit. | Plan/Build modes, checkpoints, browser self-test, files, secrets, database, publishing | Add an explicit plan/build choice, visible quality gate and restore points without pretending to provide an unrestricted VM. |
| Lovable | Prompt accepted; generation required account creation. | Strong visual editing, Cloud backend, version history and two-way GitHub sync | Preserve guest building as an advantage; keep visual selection and reviewable proposals; mark real cloud accounts and Git sync as future infrastructure. |
| Bolt | Prompt accepted in Plan mode; generation required account creation. | Plan mode, direct file editing, target/lock files, GitHub branches, database/auth/secrets | Add owned source inspection and validated project JSON editing now; do not fake arbitrary source execution or GitHub sync. |
| v0 | Prompt accepted; generation required Vercel login. | Model selector, Design Mode, code editor, diffs and direct deployment | Keep session-only model choice and Design Mode; add source-file views and a quality report beside the preview. |
| Base44 | Prompt accepted and preserved through the registration redirect. | Category-first entry, managed backend, integrations, immediate live sharing and ZIP export | Keep category-native recipes, free public links and runnable ZIP; make integrations and data budgets explicit. |
| Drops Studio before this release | Guest generation worked without login, but the mixed Telegram + wallet prompt was routed to Smart Money Copy and produced the wrong preview. | Crypto-specific DropsTab and Drops Bot foundation, guest access, BYOK, distinct runtimes, public URLs and source ZIP | Treat requested output as the primary intent, preserve secondary capabilities, run deterministic quality checks before publish and cache the shared DropsTab feed. |

## Product position

Drops Studio does not try to win by copying a general-purpose cloud IDE. It wins by compiling a crypto idea into a category-native working product with a pre-wired, honest vertical foundation:

- DropsTab provides market data, research context, valuation and source handoffs.
- Drops Bot provides alert, Telegram and approval-based action handoffs.
- Free guests can plan and build without registration.
- Free platform models have a deterministic category-aware compiler fallback.
- BYOK users can connect OpenRouter, OpenAI, Anthropic, Kimi or a compatible endpoint without keys entering projects or exports.
- Every build is a standalone product, not a renamed dashboard card.
- Every build is checked for category fit, runtime behavior, data/action foundations, responsiveness and secret safety before publishing.

## Current honest boundary

This release does not claim an undocumented Drops Bot write API, unrestricted arbitrary-code execution, a managed database for every generated app, or two-way GitHub sync. Those require real provider infrastructure. The product exposes truthful guided handoffs and exports owned, runnable source instead.

## Evidence sources

- Replit: Build with Agent, Replit Apps, Plan vs Build, checkpoints, first app and Agent 3 documentation.
- Lovable: quickstart, Lovable Cloud and GitHub integration documentation.
- Bolt: intro, quickstart, Code View, GitHub integration, model and release documentation.
- v0: Design Mode, code editing and deployment documentation.
- Base44: quickstart, integrations, developer platform and app code documentation.
