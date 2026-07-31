# Drops Studio Release Design QA

## Current release verdict

**Approved release candidate.** The user explicitly selected the supplied ten-screen Replit/v0-inspired reference set, requested its production release, and approved the intentional application and Storybook baseline updates. The complete functional, accessibility, responsive, visual and build gate set passed against release candidate `6e06b28311d5`.

## Reference contract

- Start from the approved light preset carousel; enter the full studio only after choosing a recipe or describing a custom product.
- Match Replit/v0 interaction clarity: persistent run/share/publish actions, visual canvas, contextual AI chat, device preview, code/source access and reversible history.
- Generated outputs must look and behave like their category. Telegram output uses a Telegram-native phone preview, games use an illustrated playable scene, radio uses an audio player and rundown, and data products use their own rankings, graphs or feeds.
- DropsTab is the sourced data/research layer. Drops Bot is the alert, action and Telegram handoff layer. Preview UI must never claim an external channel or trade exists before the user completes the real setup.
- Readability overrides reference-scale microcopy: body text is at least 16px, control text is at least 14px, helper and metadata text is at least 12px, and visible interactive targets are at least 44 x 44 CSS pixels.

## Visual comparison contract

The rejected game state had a static template composition, mascot/CTA overlap and no useful object inspector. A releasable state must separate the player from the CTA, keep the illustrated game world dominant, and expose the selected canvas object with editable copy, typography, color, size, position, layer, visibility and version controls.

The current references are recorded in `DESIGN.md`. Before visual status can change to Pass, Playwright must compare an actual capture and its approved baseline at the same viewport and state for 1440 x 900, 1024 x 768 and 390 x 844. Storybook component-state screenshots require the same explicit approval rule.

## Release checklist

`Pass` means the check completed against the recorded release candidate or its unchanged working tree immediately before commit.

| Area | Acceptance check | Status |
| --- | --- | --- |
| Hierarchy | Primary canvas dominates; editor navigation and actions remain clear | Pass |
| Typography | Body text is at least 16px; controls are at least 14px; helper and metadata text are at least 12px; no 5-11px source or computed text remains | Pass |
| Interactive targets | Buttons, links, inputs, selects, switches and other visible controls render at least 44 x 44 CSS pixels and primary controls are not clipped or occluded | Pass |
| Game | Illustrated scene, separate moving player, Play/replay, keyboard/touch controls, score/lives/round state | Pass |
| Telegram | Telegram-native phone preview with honest `PREVIEW - NOT PUBLISHED` state plus real account/channel setup | Pass |
| Radio | Audio player, working Web Speech playback toggle, editable rundown and schedule surface | Pass |
| Element editing | Text, image, type, color, fill, alignment, width, spacing, radius, X/Y, opacity, layer and visibility | Pass |
| Inline editing | Double-clicking a leaf text element enables direct typing on canvas | Pass |
| AI editing | Selected element context is sent to Director; free fallback keeps changes scoped to that exact element | Pass |
| Reversibility | Every saved edit creates a checkpoint; Reset and Undo restore previous output | Pass |
| Responsive | 1440, 1024 and 390px at browser zoom 100%; no horizontal overflow, clipping, occlusion, target or typography regression | Pass |
| Category coverage | All 12 presets compile into distinct runnable surfaces and pass serious/critical Axe checks | Pass |
| Source ownership | Runnable ZIP contains the HTML, config, deployment files and referenced assets without credentials | Pass |
| Visual baselines | Application and Storybook `toHaveScreenshot()` baselines exist, match and were explicitly approved | Pass |

## Same-commit evidence required

Record the commit SHA and UTC timestamp only after all commands complete without changes between them:

```bash
npm run guardrails:ui
npm run lint
npm run typecheck
npm run test:unit
npm run build-storybook
npm run test:storybook
npm run test:storybook:visual
npm run test:e2e
npm run test:lighthouse
npm run build
```

- Release candidate SHA: `6e06b28311d5`
- UTC verification time: `2026-07-31T07:27:09Z`
- UI guardrails, lint and TypeScript: pass
- Unit tests: 709 total, 707 pass, 2 explicit opt-in skips, 0 fail
- Storybook build/tests: pass; 47 interaction tests and 42 visual cases pass
- Application Playwright: 201 total, 161 pass, 40 intentional project/viewport skips, 0 fail
- Application visual baselines: 6/6 pass at the approved states and viewports
- Lighthouse: three pessimistic-budget runs pass; performance 0.92-0.94, accessibility/best-practices/SEO 1.00
- Vercel Next.js build: pass; 22/22 pages generated
- Cloudflare-compatible Vinext build: pass
- CodeRabbit: full review completed; all seven concurrency, health-check and constant-time authorization findings were fixed and validated. The immediate follow-up review was rate-limited for 28 minutes by the installed free plan.
- Release decision: approved

## Evidence boundaries

- Focused browser checks or screenshots are useful working evidence, but do not establish a release pass.
- Lighthouse currently audits the representative start-builder URL `/` for three runs and applies the pessimistic result. It does not claim to measure authenticated editor state, every generated standalone runtime, Telegram provider latency or third-party hosting. Those product journeys are covered separately by Playwright functional, accessibility and visual checks.
- The 12-preset Playwright suite uses deterministic provider fixtures for repeatability. It validates category-native behavior and truthfulness boundaries, not live-provider availability or production account permissions.
- A Telegram-shaped preview is not evidence of a real channel. Only verified Telegram provider evidence can establish channel creation or delivery.
