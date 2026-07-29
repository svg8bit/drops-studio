# Drops Studio Release Design QA

## Reference contract

- Start from the approved light preset carousel; enter the full studio only after choosing a recipe or describing a custom product.
- Match Replit/v0 interaction clarity: persistent run/share/publish actions, visual canvas, contextual AI chat, device preview, code/source access and reversible history.
- Generated outputs must look and behave like their category. Telegram output uses a Telegram-native phone preview, games use an illustrated playable scene, radio uses an audio player and rundown, and data products use their own rankings, graphs or feeds.
- DropsTab is the sourced data/research layer. Drops Bot is the alert, action and Telegram handoff layer. Preview UI must never claim an external channel or trade exists before the user completes the real setup.

## Visual comparison

The rejected game state had a static template composition, mascot/CTA overlap and no useful object inspector. The corrected state separates the player from the CTA, keeps the illustrated game world dominant, and exposes the selected canvas object with editable copy, typography, color, size, position, layer, visibility and version controls.

## Release checklist

| Area | Acceptance check | Result |
| --- | --- | --- |
| Hierarchy | Primary canvas dominates; editor navigation and actions remain clear | Pass |
| Typography | Editor inputs are 13px; generated product content has a 10px minimum for secondary labels and larger body copy | Pass |
| Game | Illustrated scene, separate moving player, Play/replay, keyboard/touch controls, score/lives/round state | Pass |
| Telegram | Telegram-native phone preview with honest `PREVIEW - NOT PUBLISHED` state plus real account/channel setup | Pass |
| Radio | Audio player, working Web Speech playback toggle, editable rundown and schedule surface | Pass |
| Element editing | Text, image, type, color, fill, alignment, width, spacing, radius, X/Y, opacity, layer and visibility | Pass |
| Inline editing | Double-clicking a leaf text element enables direct typing on canvas | Pass |
| AI editing | Selected element context is sent to Director; free fallback keeps changes scoped to that exact element | Pass |
| Reversibility | Every saved edit creates a checkpoint; Reset and Undo restore previous output | Pass |
| Mobile | 418px runtime preview, no horizontal page overflow | Pass |
| Category coverage | All 12 presets compile into distinct runnable surfaces with 38-78 editable objects | Pass |
| Source ownership | Runnable ZIP contains the HTML, config, deployment files and referenced game assets | Pass |

## Browser evidence

- Element edit persisted across reload, then Undo restored the generated title.
- Crypto Game exposed 57 editable canvas objects and editable image assets.
- Mobile preview rendered at 418px with zero horizontal shell overflow.
- All 12 presets were generated and their category-critical controls were found in the rendered runtime.
- Runtime and editor console error scan was clean during the release pass.
