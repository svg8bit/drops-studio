# Drops Studio Engineering Contract

These instructions apply to the entire repository and override generic UI shortcuts.

## Product truth

- Drops Studio is a real AI product builder centered on DropsTab data and Drops Bot automation.
- A preset is complete only when it produces a category-native, editable, runnable, publishable product.
- Never call a card mockup a product, a Telegram-shaped preview a channel, a static screen a game, or a handoff a completed integration.
- Keep external actions explicit and consent-based. Never claim a trade, alert, Telegram channel, deployment, or connection succeeded without verified provider evidence.
- Apply the same Director, design, data, logic, testing, publish, and export quality to every preset.

## Mandatory UI workflow

1. Read the root `DESIGN.md` and inspect its selected reference before visible edits.
2. Use the global `premium-ui-workflow` skill.
3. Read `components.json` before adding UI. Use `npx shadcn@4.16.0` and local editable primitives under `components/ui`.
4. Use Tailwind CSS v4, Base UI 1.6 for new primitives, Lucide icons, and Motion only for short purposeful transitions.
5. Preserve current Radix behavior until a bounded Base UI migration has keyboard, Axe, and visual coverage.
6. Keep Drops Studio brand tokens project-local. Never modify ColdMath or BowYard tokens from this repository.

## Blocking design rules

- Body text is 16–18 px.
- Control text is at least 14 px.
- Helper and metadata text is at least 12 px.
- Any 6–11 px text declaration or arbitrary class blocks CI.
- Every visible interactive target is at least 44 by 44 CSS pixels.
- Verify at 1440, 1024, and 390 px with browser zoom 100% and device scale factor 1.
- Console errors, horizontal overflow, serious or critical Axe findings, Lighthouse regressions, or screenshot diffs block completion.

## Visual baselines

- Playwright `toHaveScreenshot()` baselines are committed and immutable in CI.
- Never run `--update-snapshots` without explicit user approval.
- Before baseline approval, show the selected reference and actual capture at the same viewport.
- Do not weaken pixel thresholds, mask broken UI, or add broad snapshot exclusions to make tests pass.

## Required verification

Run the narrowest checks while editing, then before commit, push, or deploy run:

```bash
npm run guardrails:ui
npm run lint
npm run typecheck
npm run test:unit
npm run build-storybook
npm run test:e2e
npm run test:lighthouse
npm run build
```

Report exact failures. Never update baselines or skip a gate automatically.

## Repository safety

- Preserve unrelated changes and inspect `git status -sb` before edits.
- Use `apply_patch` for hand edits.
- Never print `.env*` values or user/provider secrets.
- Commit and push intentional completed work; deploy only after all release gates pass.

## V2 Sandbox Builder workstream

These rules apply whenever work targets Project V2, the AI builder loop, or
persistent Vercel Sandbox previews.

### Protected state and worktree

- Before planning, inspect `git status -sb`, `git branch -vv`, `git worktree list`, recent commits, open PRs, and the latest default-branch CI.
- Work only in the isolated worktree on `codex/drops-studio-v2-sandbox-builder`, based on the verified current `origin/main`. Reuse it if it exists; never create competing suffix branches silently.
- `main`, the production deployment and aliases, historical PR #1 and PR #2, every non-owned PR branch, and every other worktree are read-only.
- Never reset, clean, stash, rebase, force-push, rewrite history, switch another worktree, merge to `main`, or change a production alias.
- Preserve V1 projects, all 12 recipes, `/p/{slug}`, ZIP export, current connections, checkpoints, and session-only BYOK behavior. Project V2 extends the canonical workspace through explicit adapters and migrations; it does not replace V1 in place.

### Work-package ownership

- The lead owns sequencing, shared contracts, cross-package integration, dependency manifests and lockfiles, final git operations, PR creation, and preview deployment.
- Project model owns versioned schemas, path and file validation, deterministic hashes, migration, templates, diffs, checkpoints, and persistence.
- Runtime owns `ProjectRuntimeAdapter`, Vercel Sandbox lifecycle, processes, ports, logs, limits, cleanup, network policy, and runtime audit evidence.
- Agent loop owns AI SDK orchestration, strict tool schemas, permissions, approvals, bounded outputs, repair limits, and request-only provider access.
- Studio owns the current unified workspace UI, real file/editor/preview/log/history states, Storybook, accessibility, and browser flows. It must not restore obsolete panels.
- Crypto integrations own typed DropsTab and Drops Bot proxies, provider evidence, fixtures, Telegram boundaries, and truthful unavailable or setup-required states.
- QA/release owns adversarial tests, CI parity, preview verification, and the final evidence table. It cannot waive a failing gate.
- Parallel agents receive disjoint files. Only the lead edits shared types, configs, manifests, and integration points. Subagents do not commit, push, deploy, or change branches.

### Plugin-first workflow

- Read every applicable `SKILL.md` completely before task actions.
- Use `agyb-essentials:concise-planning` for the implementation graph and context-mode for the long-running execution when callable.
- Use `vercel:vercel-sandbox`, `vercel:ai-sdk`, `vercel:ai-gateway`, `vercel:nextjs`, `vercel:deployments-cicd`, and `vercel:verification` for runtime, deployment, and agent work.
- Use `build-web-apps:frontend-app-builder`, `build-web-apps:frontend-testing-debugging`, `build-web-apps:react-best-practices`, `build-web-apps:shadcn`, and relevant `agyb-aas-web-app-builder` skills for Studio implementation.
- Use `product-design:index` and `product-design:audit` for visible UX; use Creative Production intake/produce for reference-driven final design QA.
- Use Playwright MCP or repository Playwright for every rendered or interactive change. Its global output directory must remain Drops-specific and must never point at a ColdMath workspace.
- Use `github:github`, `github:gh-fix-ci`, and `github:yeet` or verified `gh` fallback for repository operations.
- Use CodeRabbit after the bounded local gate with `coderabbit review --agent --base main`; verify every finding before editing and never weaken tests to satisfy it.
- Use OpenAI Developers only for OpenAI API work. Use Sites only for `.openai/hosting.json` or an explicitly requested secondary preview. Use Remotion only for actual video output and Visualize only when a diagram or data visualization materially helps.
- Do not invoke unrelated skills merely to claim plugin usage.

### Runtime and security boundary

- Multi-file source is canonical for Project V2; `GeneratedProjectSpec` remains product metadata. Preserve independently versioned store, workspace, spec, and provider-record envelopes.
- Untrusted build, install, test, server, and command execution occurs only in Vercel Sandbox. Browser-safe legacy preview may continue in its sandboxed iframe, and published deployments execute on their declared host.
- `run_command` is a policy-validated argv or declared-task tool, never a free-form host shell. `install_package` accepts exact public-registry versions, keeps lifecycle scripts disabled, and records an audit event.
- No provider or platform secret may enter generated files, Sandbox environment or filesystem, logs, checkpoints, Blob snapshots, ZIPs, prompts, or tool output.
- Every external or destructive tool has explicit approval, timeout, quota, audit record, bounded output, and idempotency behavior.
- DropsTab quota-bearing tests use fixtures and cache boundaries. Live Sandbox or provider smoke tests run only behind explicit flags and never use production user accounts implicitly.
- Never promote preview or browser telemetry into provider evidence.

### Validation and preview-only release

- Reproduce inherited default-branch failures before feature work. Fix their root cause without changing visual baselines or weakening thresholds.
- During implementation run narrow owner-specific tests. Run the full CI-equivalent gate once at the final boundary:

```bash
npm audit --omit=dev --audit-level=high
npm run guardrails:ui
npm run lint
npm run typecheck
npm run build:vercel
npm run test:unit
npm run build-storybook
npm run test:storybook
npm run test:storybook:visual
npm run test:e2e:prepared
npm run test:lighthouse:prepared
npm run build
```

- Never update visual baselines, weaken thresholds, skip tests, or consume live DropsTab quota to make a gate pass.
- After green gates, the only authorized release is: commit the dedicated branch, push it, open one separate PR, and create a provider-confirmed preview deployment.
- Do not merge, promote, alias, or deploy to production. Record `main`, production, and protected PR state before and after release and prove they did not change.
