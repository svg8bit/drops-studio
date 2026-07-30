# Drops Studio Release Design QA

## Current release verdict

**Not approved for release.** This document records the acceptance contract, not a self-certified pass. Every item remains pending until the full gate set runs against one recorded commit and the user explicitly approves the reference-versus-actual visual comparison. Missing or changed screenshot baselines block release; they are never created or updated automatically.

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

`Pending` means the contract exists but has not yet passed as part of the same recorded commit. Historical or focused checks cannot promote an item to Pass.

| Area | Acceptance check | Status |
| --- | --- | --- |
| Hierarchy | Primary canvas dominates; editor navigation and actions remain clear | Pending same-commit verification |
| Typography | Body text is at least 16px; controls are at least 14px; helper and metadata text are at least 12px; no 5-11px source or computed text remains | Pending same-commit verification |
| Interactive targets | Buttons, links, inputs, selects, switches and other visible controls render at least 44 x 44 CSS pixels and primary controls are not clipped or occluded | Pending same-commit verification |
| Game | Illustrated scene, separate moving player, Play/replay, keyboard/touch controls, score/lives/round state | Pending same-commit verification |
| Telegram | Telegram-native phone preview with honest `PREVIEW - NOT PUBLISHED` state plus real account/channel setup | Pending same-commit verification |
| Radio | Audio player, working Web Speech playback toggle, editable rundown and schedule surface | Pending same-commit verification |
| Element editing | Text, image, type, color, fill, alignment, width, spacing, radius, X/Y, opacity, layer and visibility | Pending same-commit verification |
| Inline editing | Double-clicking a leaf text element enables direct typing on canvas | Pending same-commit verification |
| AI editing | Selected element context is sent to Director; free fallback keeps changes scoped to that exact element | Pending same-commit verification |
| Reversibility | Every saved edit creates a checkpoint; Reset and Undo restore previous output | Pending same-commit verification |
| Responsive | 1440, 1024 and 390px at browser zoom 100%; no horizontal overflow, clipping, occlusion, target or typography regression | Pending same-commit verification |
| Category coverage | All 12 presets compile into distinct runnable surfaces and pass serious/critical Axe checks | Pending same-commit verification |
| Source ownership | Runnable ZIP contains the HTML, config, deployment files and referenced assets without credentials | Pending same-commit verification |
| Visual baselines | Application and Storybook `toHaveScreenshot()` baselines exist, match and were explicitly approved | Pending explicit approval |

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

- Commit SHA: not recorded
- UTC verification time: not recorded
- Application visual baselines: pending explicit approval
- Storybook visual baselines: pending explicit approval
- Release decision: blocked

## Evidence boundaries

- Focused browser checks or screenshots are useful working evidence, but do not establish a release pass.
- Lighthouse currently audits the representative start-builder URL `/` for three runs and applies the pessimistic result. It does not claim to measure authenticated editor state, every generated standalone runtime, Telegram provider latency or third-party hosting. Those product journeys are covered separately by Playwright functional, accessibility and visual checks.
- The 12-preset Playwright suite uses deterministic provider fixtures for repeatability. It validates category-native behavior and truthfulness boundaries, not live-provider availability or production account permissions.
- A Telegram-shaped preview is not evidence of a real channel. Only verified Telegram provider evidence can establish channel creation or delivery.
