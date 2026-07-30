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

