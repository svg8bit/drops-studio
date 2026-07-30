# Export portability contract

Drops Studio source downloads are runnable product archives, not links back to the editor.

## Required local assets

Every archive includes the exact repository-owned brand files:

- `brand/dropstab-mark.svg`
- `brand/drops-bot-avatar.jpg`

Crypto Game archives additionally include:

- `assets/market-catcher-retro.png`
- `assets/market-wolf-catcher.png`

`createProjectArchive` accepts these files through one explicit `ProjectArchiveAssets` object. Export fails with the missing archive path when a required byte array is absent or empty. It never emits an HTML file that points to a missing required asset.

## URL rules

Before packaging, the exporter:

- rewrites `/assets/*` and `/brand/*` references to subpath-safe `./assets/*` and `./brand/*` references, including CSS URLs and `srcset` entries;
- replaces the official remote DropsTab mark with the bundled local mark;
- converts loopback origins to relative URLs;
- sends the explicit new-channel action to the canonical Drops Studio Telegram wizard instead of a nonexistent path on the archive host;
- rejects unresolved root-relative asset URLs, remote brand assets and browser-only `blob:` dependencies.

External product actions such as opening DropsTab or Drops Bot remain explicit HTTPS links. They are not required for the exported interface to render or for saved-snapshot interactions to run.

## Verification

Each archive carries `tests/smoke.mjs`. After extraction, run:

```bash
node tests/smoke.mjs
```

The smoke test verifies the product marker, provider evidence, asset portability, absence of loopback/blob/remote-brand dependencies, and the presence of every referenced local file. Repository tests also extract an archive into a temporary directory, execute this smoke test, and compare bundled asset bytes to the canonical files under `public/`.
