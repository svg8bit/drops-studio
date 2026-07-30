# Drops Agent Intelligence V2 baseline

This immutable baseline was captured from commit `f47f14e` before any V3
compact-core, runtime-skill, Stabilizer, Design Agent, failure-clustering, or
data-driven Router/AutoFix candidate work.

The baseline is intentionally honest. Composite routing, tenant/revision-scoped
RAG, the strict Builder API integration, immutable Verifier, privacy-safe
traces, and the bounded parallel orchestrator exist. The production runtime does
not yet invoke the parallel orchestrator, the 24-case offline suite is a
contract fixture rather than a live model comparison, and no Router/AutoFix
default is changed by V3 until the required data gates exist.

Reproduce the deterministic baseline with:

```bash
npm run guardrails:ui
npm run lint
npm run typecheck
npm run test:unit
node --test tests/agent-intelligence-runtime.test.mjs tests/builder-agent-route.test.mjs tests/builder-provider-security.test.mjs
```

The preview deployment was confirmed `READY`; it remains protected by Vercel's
preview access policy and does not change the production alias.
