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

### Full repository and release authority

- Before planning, inspect `git status -sb`, `git branch -vv`, `git worktree list`, recent commits, open PRs, and the latest default-branch CI so every mutation starts from verified current state.
- `codex/drops-studio-v2-sandbox-builder` is the prepared starting worktree, not an access boundary. The lead may inspect, create, switch, repair, or retire any Drops Studio branch or worktree needed to complete the product.
- The lead has full read/write/admin and release authority across the complete Drops Studio surface: `main`, every branch and worktree, historical and active PRs/issues, GitHub Actions and repository settings, Vercel project settings and environment variables, previews, production deployments, domains and aliases, Drops Studio VPS/runtime/services/storage, Sandbox resources, provider configuration, and product integrations.
- Commit, push, fetch, rebase, cherry-pick, merge, close or supersede PRs, update `main`, deploy, promote, roll back, and change the production alias when useful to finish or recover the product. These operations do not require another approval within the Drops Studio task.
- Historical PR #1 and PR #2 are normal repository history, not protected read-only state. Reuse, supersede, close, or modify their remaining branches when the verified current architecture benefits.
- Access includes reading and updating protected provider or deployment configuration through their proper interfaces. Never print secrets, place them in source/generated files/logs, or commit them.
- Preserve V1 projects, all 12 recipes, `/p/{slug}`, ZIP export, current connections, checkpoints, and session-only BYOK behavior as product outcomes. Migrate or replace internals when necessary, but verify compatibility before release.
- `/opt/coldmath`, ColdMath services, and the ColdMath repository remain outside this task because they are a separate product. Using the saved ColdMath VPS host as the task entry point does not authorize ColdMath changes.

### Work-package ownership

- The lead owns sequencing, shared contracts, cross-package integration, dependency manifests and lockfiles, final git operations, PR creation, and preview deployment.
- Project model owns versioned schemas, path and file validation, deterministic hashes, migration, templates, diffs, checkpoints, and persistence.
- Runtime owns `ProjectRuntimeAdapter`, Vercel Sandbox lifecycle, processes, ports, logs, limits, cleanup, network policy, and runtime audit evidence.
- Agent loop owns AI SDK orchestration, strict tool schemas, permissions, approvals, bounded outputs, repair limits, and request-only provider access.
- Studio owns the current unified workspace UI, real file/editor/preview/log/history states, Storybook, accessibility, and browser flows. It must not restore obsolete panels.
- Crypto integrations own typed DropsTab and Drops Bot proxies, provider evidence, fixtures, Telegram boundaries, and truthful unavailable or setup-required states.
- QA/release owns adversarial tests, CI parity, preview verification, and the final evidence table. It cannot waive a failing gate.
- Parallel agents normally receive disjoint files. The lead coordinates shared types, configs, manifests, integration points, and may explicitly delegate branch, commit, push, PR, deployment, or production operations when that accelerates delivery without creating conflicting ownership.

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

### Validation and production release

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

- Visual baselines, thresholds, fixtures, and test configuration are editable when an intentional product change requires it; document the reason and never use the change to conceal a regression. Do not consume live DropsTab quota in routine tests.
- After the bounded gates, choose and execute the complete release path needed for the task: commit and push, open/update/merge PRs, update `main`, deploy or promote the verified Vercel build, change the production alias, configure runtime resources, and verify the public product.
- Record the before/after Git, CI, deployment, alias, migration, and smoke-test evidence. Maintain a tested rollback path, but do not stop at a preview when a production release is required to complete the product.
