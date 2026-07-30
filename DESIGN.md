# Drops Studio Design Contract

This is the only current design source of truth for Drops Studio. Historical notes may exist under other filenames, but they cannot override this file.

## Product position

Drops Studio combines a Replit/v0-style prompt-to-product workflow with category-aware crypto primitives. DropsTab supplies market intelligence and research context; Drops Bot supplies monitoring, alerts, and Telegram automation; the Studio turns those capabilities into editable, runnable, publishable products.

The interface must feel calm, premium, legible, and outcome-led. Technical implementation details stay behind progressive disclosure. The main surface answers four questions: what will be built, what real data/actions it uses, what it looks like, and how to run or publish it.

## Approved current-state references

The current rebuilt product architecture is the source of truth. Do not restore an earlier mockup, earlier four-column editor, earlier standalone publish sidebar, or old preset-card composition.

### Current start builder structure

- Reference: `docs/design/current-home-structure-reference.png`
- Native size: 1440 x 900
- SHA-256: `44968f3fd9b2494f067b2344eda70e937db642b88b6488db5b2fb0c3494484f4`
- Captured from the current production implementation on 2026-07-29 before the premium UI correction.
- Preserve: the already rebuilt prompt-first flow, current recipe carousel, current progressive setup section, current connections entry, and current output-native preview relationship.
- Correct in place: typography, targets, spacing, hierarchy, preview truthfulness, responsive behavior, and component quality. Do not replace it with the earlier concept layout.

### Current Project Studio structure

- Reference: `docs/design/current-studio-structure-reference.png`
- Native size: 1280 x 790
- SHA-256: `8781ecdb749449b31f48935a8918c852ebeeeb6f5e59686cfa91aa5df1ec26c6`
- Captured from the current rebuilt editor on 2026-07-29 before the premium UI correction.
- Preserve: one unified left workspace navigation with its contextual inspector, the central live product canvas, the current Design Mode/direct element editing, Director inside the existing left tool (or an intentional overlay/sheet), top Run/Connections/Share/Publish actions, and the persistent status bar.
- Correct in place: unreadable microcopy, cramped controls, contextual-surface sizing, responsive collapse, proposal quality, category-specific editing depth, and publish/connection clarity.
- Do not restore the earlier separate fixed publish sidebar or the older Project/AI brain/Branding rail. Publish and connections remain current actions and contextual surfaces.
- Never render Director as a persistent right-side column at any viewport width. A wide viewport may enlarge the canvas, but it must not make the right-side panel reappear.

The older `docs/design/project-studio-spec.png` and `docs/screenshots/*` files are historical evidence only. They are explicitly forbidden as new visual baselines. Current-state references define architecture; the accessibility and readability rules below intentionally change their undersized text.

### Project V2 capability references

The user-provided ten-screen pack under `docs/design/v2-reference/` is the
approved capability and visual-polish direction for the V2 builder. Its screen
map and SHA-256 manifest live in `docs/design/v2-reference/README.md`.

- Apply its calm white/blue hierarchy, compact developer-tool affordances,
  explicit build stages, real file tree, device preview, logs, checkpoint diff,
  integration evidence, and release receipts to the current product.
- Treat every provider badge and status in the pack as a layout reference only.
  Drops Studio may render `Live`, `Connected`, `Passed`, `Deployed`, or a real
  URL only after the corresponding Sandbox, Drops, GitHub, or Vercel response
  has been verified.
- The current prompt-first homepage and unified Project Studio architecture
  still control layout. Do not recreate a permanent right Director column,
  obsolete four-column shell, or permanent publish sidebar from a concept.
- Use DropsTab market intelligence, Drops Bot monitoring/delivery, the existing
  twelve recipes, and honest setup-required states wherever a generic concept
  uses interchangeable DeFi or third-party examples.

## Drops Studio brand profile

Brand tokens live only in `app/styles/drops-studio.tokens.css`.

- Canvas: cool white `#f8fbff`; surfaces `#ffffff`; soft blue surface `#f1f6ff`.
- Ink: `#07142f`; secondary ink `#52617a`; quiet ink `#71809a`.
- Primary: Drops blue `#316cff`; hover `#1e55e8`; focus ring `rgba(49,108,255,.28)`.
- Success: `#139a62`; warning: `#ad6b0a`; danger: `#c83d4d`.
- Borders: `#dbe4f1`; stronger border `#b9ccff`.
- Radii: 10 px controls, 16 px cards, 24 px major canvases.
- Shadows: soft blue ambient shadows only; no muddy grey overlays.
- Typography: Geist Sans for UI, Geist Mono only for code, identifiers, and logs.

## Typography and targets

- Default body: 16 px, line-height 1.55–1.65.
- Dense workspace body: never below 14 px; ordinary content remains 16 px.
- Controls, labels, buttons, tabs, and selects: at least 14 px.
- Helper text, timestamps, badges, and metadata: at least 12 px.
- Page title: 48–76 px on desktop, 38–48 px on tablet, 34–42 px on mobile.
- Section titles: 24–32 px; card titles: 18–22 px.
- All visible interactive targets: minimum 44 x 44 CSS px.

No 5–11 px text is permitted in source or computed styles.

## Layout

### 1440+

- Start builder: two balanced columns, builder 56–60%, preview 40–44%, maximum content width 1500 px.
- Project Studio: one 72–540 px unified left navigation/context surface depending on the selected tool and a flexible live canvas. Director occupies that existing left tool or an intentional overlay/sheet; it is never a persistent right column. Publish remains a contextual dialog/sheet.
- Never scale the entire UI down to fit. Panels scroll independently where appropriate.

### 1024

- Keep builder and preview visible when useful; secondary inspector becomes a sheet or tab.
- Preserve 44 px targets and 14–16 px control text.

### 390

- One primary task per screen.
- Preview follows the selected preset configuration and is reachable without horizontal scrolling.
- Rails and secondary panels become accessible sheets; never squeeze desktop panels into unreadable columns.

## Core interaction model

1. User chooses a recipe or writes any product request.
2. The AI Director returns an editable plan with product type, real DropsTab/Drops Bot capabilities, model choice, required connections, cost boundary, and a truthful preview.
3. Build opens Project Studio with a runnable category-native product, not a generic card template.
4. User edits by chat, direct manipulation, local primitives, design kits, data/logic controls, and source code.
5. Tests run in the workspace; publish creates a real public application; export contains the runnable product and source.

## Category-native output contract

- Telegram channel: connect a Telegram user account, create/select a real channel, add/configure the bot where supported, show the native Telegram post preview, and verify delivery.
- Game: playable loop, real visual assets, animation, score/state, controls, and DropsTab-driven mechanics. A dashboard with buttons is not a game.
- Radio: playable audio/speech experience with queue, now playing, controls, and sourced crypto segments.
- Aggregator: searchable/sortable market product with real DropsTab-backed data and attribution.
- Action/Prediction/Copy: research-to-action workflow with evidence, explicit approvals, and honest execution boundaries.
- Companion/Tamagotchi/Siri/Hunt: each keeps its own interaction loop, visual language, persisted state, and useful DropsTab/Drops Bot role.

## Components

New components use Base UI 1.6 via shadcn CLI v4 and remain editable under `components/ui`. Use Lucide icons. Existing Radix Dialog, Select, and Switch may remain only until their bounded migration passes keyboard, Axe, and visual tests.

`app/globals.css` is an import-only manifest and must remain below 4 KiB. New
product surfaces belong in local React components using Tailwind CSS v4 and the
shared Base UI primitives; do not add another monolithic hand-written CSS file.
The release guardrail rejects any source declaration below 12 px and any manual
style block added back to `globals.css`. It also rejects any individual manual
stylesheet above 48 KiB so a new monolithic CSS surface cannot silently return.

`app/styles/project-studio.runtime.css` is a bounded legacy exception for the
existing Studio runtime canvas and portalled publish dialog. Targeted
accessibility and regression fixes may update those existing selectors, but no
new product surface or component may be added there; new UI stays in local
Tailwind CSS v4 and Base UI components. The file remains subject to the 48 KiB
stylesheet cap and is migrated only in reviewed, browser-tested slices.

Storybook 10.5.5 must cover primitives and important product states: default, hover, focus, disabled, loading, error, connected, disconnected, empty, populated, desktop, and mobile.

## Motion

Motion is limited to 120–240 ms state transitions, sheet/dialog entry, progress changes, and direct manipulation feedback. Disable nonessential motion under `prefers-reduced-motion`. Never animate layout continuously or use motion to hide loading latency.

## Release quality gates

- Playwright visual comparisons at 1440 x 900, 1024 x 768, and 390 x 844 with device scale factor 1.
- Zero unexpected console errors and page errors.
- Zero horizontal overflow.
- Zero serious or critical Axe violations.
- Lighthouse: accessibility 1.00, performance >= 0.90, best practices >= 0.95, SEO >= 0.95, LCP <= 2.5 s, CLS <= 0.10, TBT <= 300 ms.
- Storybook 10.5.5 builds and its accessibility tests pass.
- Approved screenshots never update automatically.
- Final delivery shows the reference and actual screenshot at the same viewport.
