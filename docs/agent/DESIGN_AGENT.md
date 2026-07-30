# Drops Studio Design Agent and Visual Verifier

**Contract version:** 3.0.0
**Runtime status:** candidate behind `DROPS_DESIGN_AGENT_ENABLED`
**Authority:** frontend mutation only; deterministic visual evidence remains final

## Role boundary

The Design Agent exists to turn an accepted category-native product plan into a
coherent Drops Studio frontend. It reads the current project UI, `DESIGN.md`,
project tokens, local primitives, selected references, and the smallest relevant
category context. It does not own backend behavior, auth, provider adapters,
integration truth, project data, deployment, publication, or visual baselines.

The runtime validates every proposed path with
`assertDesignAgentScope()`. Allowed roots are frontend surfaces under `app`,
`components`, `styles`, `public`, and their supported `src` equivalents. API
routes, server actions, middleware, auth, providers, integrations, secrets,
package manifests, and infrastructure configuration are blocked even when a
prompt asks for them. The patch must also remain inside explicit task scopes.

## Direction contract

`proposeDesignDirections()` returns three structured options:

1. **Signal Command Center** — decision and evidence hierarchy;
2. **Research Narrative** — sourced editorial market context;
3. **Alert Operations** — event triage, rules, and approval-aware delivery.

Every direction records its thesis, component hierarchy, primary interaction,
responsive strategy, brand expression, category signals, and deterministic
selection score. A live task with no explicit selection stops before mutation
and returns all directions for review. An unattended benchmark uses the frozen
rubric, chooses the highest score deterministically, and records the policy and
reason. A model does not silently select a live user's visual direction.

## Implementation loop

```text
accepted brief
→ current frontend and design context
→ three structured directions
→ explicit user selection or deterministic eval selection
→ frontend-only scoped patch
→ typecheck, lint, tests, and production build as required
→ real Sandbox preview
→ content-addressed captures at 1440x900, 1024x768, and 390x844
→ deterministic visual checks
→ optional structured visual judge
→ read-only Visual Verifier report
→ bounded separately authorized repair
```

The Design Agent never updates screenshot baselines. It cannot mask missing
content, errors, or overflow with clipping. External assets require recorded
provenance and permission. Generated provider states remain truthful; styling
cannot convert demo, unconfigured, or setup-required into connected or live.

## Visual Verifier

The Visual Verifier has only read/search/log/browser evidence capabilities. It
cannot write files, install packages, run arbitrary commands, start a new
deployment, create checkpoints, update snapshots, or publish. Its report is
bound to the exact Project V2 revision and hashes the supplied evidence.

Required captures are exact:

| Evidence ID | Viewport |
|---|---:|
| `desktop-1440` | 1440 × 900 |
| `tablet-1024` | 1024 × 768 |
| `mobile-390` | 390 × 844 |

For every capture the deterministic layer checks screenshot presence and hash,
viewport dimensions, horizontal overflow, missing required content,
inaccessible controls, serious/critical accessibility findings, page and
console errors, and primary-flow completion.

The optional visual judge scores information hierarchy, typography/readability,
spacing, component coherence, Drops brand adherence, category-native
interaction, responsive composition, accessibility, interaction clarity,
originality, and absence of generic AI-dashboard artifacts. Its score is
advisory. It cannot override any deterministic blocker or missing evidence.

## Stop and handoff rules

The Design Agent stops before mutation when direction selection is pending. It
also stops on scope expansion, backend/integration change, missing design
source, unproven external asset, stale revision, secret-like content, or an
approval boundary. After implementation it stops with a blocker if any required
capture or deterministic check fails. Repair becomes a separately bounded
frontend task; the Visual Verifier remains read-only.

## Release evidence

A passing design report alone does not release a project. The normal Project V2
schema, dependency, typecheck, lint, test, build, live preview, browser,
security, permission, checkpoint, and approval gates remain authoritative. The
Design Agent stage and selected versions are recorded in the prompt manifest
and privacy-safe run trace. No new production default is enabled until the V3
design benchmark slice and functional non-regression gates pass.
