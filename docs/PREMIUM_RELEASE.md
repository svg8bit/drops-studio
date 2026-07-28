# Drops Studio Premium Release Contract

## Product correction

Drops Studio is not a preset gallery and does not stop at a blueprint. It is a
vertical prompt-to-product platform for people who want to create a real crypto
product without assembling data, automation, AI, runtime and hosting by hand.

The mass-market promise is:

> Describe or choose a crypto product, run it immediately, publish it for free,
> share the live URL, and keep the source.

DropsTab is the intelligence and market-context layer. Drops Bot is the alert,
automation, Telegram distribution and action layer. AI models, public market
feeds, onchain services and hosting providers are modular extensions around
that foundation.

## Two product surfaces

### 1. Start / recipe builder

The existing light Drops Studio home remains the entry experience:

- natural-language project prompt;
- 12-product carousel;
- recipe-specific setup controls;
- Free Auto and bring-your-own AI selection;
- live recipe preview;
- `My Projects` navigation.

`Build` must compile and save a runnable project, then navigate to its Project
Studio. It must never open a success-only modal or save a dead preset record.

### 2. Project Studio

Every generated project opens on its own `/studio/{project-id}` route with:

- editable project, data, product-logic, AI and branding controls;
- a category-aware Experience Director with editable archetype, layout, data
  presentation, engagement model, audience, primary loop and product modules;
- Design Mode block selection, variants and visibility, curated visual kits,
  responsive preview and optimized custom artwork for every category;
- contextual chat proposals with an explicit review/apply step, checkpoints
  and undo;
- a large sandboxed runtime showing the actual running product;
- rebuild/regenerate controls;
- source inspection and ZIP export;
- one-click free publishing;
- a shareable standalone URL;
- Vercel, Cloudflare, GitHub Pages, Netlify and self-hosted export choices;
- visible runtime, data-adapter and model status.

The visual source of truth is
[`docs/design/project-studio-spec.png`](design/project-studio-spec.png).

## Public runtime

`Publish Free` stores a validated project specification and server-compiled
standalone HTML in platform persistence. It returns a public `/p/{slug}` URL.
That route shows the product itself, never the Drops Studio editor.

Published products must:

- open without a Drops Studio account;
- work on desktop and mobile;
- keep their own interactive state;
- use live public data where an unauthenticated source exists;
- preserve a connected DropsTab snapshot and DropsTab research links;
- continue Drops Bot setup/actions through official Telegram surfaces;
- never expose API keys or claim an unexecuted trade was executed.

## Generation system

The generator is specification-driven rather than arbitrary model-authored
HTML. This keeps every output runnable and prevents a model from publishing
unsafe scripts.

1. Intent router selects or confirms a product recipe.
2. Recipe graph selects data, triggers, interactions, AI and output modules.
3. Free Auto creates a deterministic, high-quality project specification.
4. A connected model may improve naming, copy, theme and feature configuration
   through a strictly validated JSON response.
5. The project compiler produces a standalone HTML/CSS/JS product.
6. The same compiler powers Studio preview, public hosting and source export.

Supported brains:

- Free Auto, no key and no usage fee;
- OpenRouter Free (`openrouter/free`) with the user's OpenRouter key;
- OpenAI;
- Anthropic;
- Kimi/Moonshot;
- any user-controlled OpenAI-compatible HTTPS endpoint.

## Real recipe acceptance criteria

Every recipe has a unique product runtime and at least one meaningful stateful
interaction.

1. **Intelligence-to-Action Engine** — thesis, live signal board, decision and
   action log.
2. **Alpha Channel Money Machine** — filterable sourced feed, share/copy and
   Drops Bot channel continuation.
3. **AI Morning Alpha** — configurable brief, live prices, refresh, share and
   browser narration.
4. **Prediction-to-Crypto Impact Trader** — live prediction context, asset
   impact map and alert/trade handoffs.
5. **Smart Money Copy** — public-wallet rules, risk sizing and explicitly
   labelled paper-copy workflow.
6. **Crypto Aggregator** — searchable live market table, favourites and
   DropsTab research links.
7. **Crypto Game** — timed playable prediction round, selection, scoring,
   streak and restart.
8. **Personal Crypto Companion** — editable interests and feedback-driven
   recommendation feed.
9. **Portfolio Tamagotchi** — persistent health state, portfolio care actions
   and explainable risk signals.
10. **Crypto Product Hunt** — search, filter, vote and local submission flow.
11. **Crypto Radio** — real browser speech playback, queue and transport state.
12. **Crypto Siri** — text query, optional browser voice input, live market
   answers and Drops Bot alert handoff.

### Universal professional depth

Crypto Game is the visual benchmark, not the only product with advanced
controls. Every recipe must expose and honor the same professional editing
layers:

- **Experience:** category archetype, layout, audience, primary loop and
  engagement model;
- **Information design:** cards, table, timeline, graph or relationship map
  where the product contract supports them;
- **Modules:** add, rename, reorder, hide and remove product modules;
- **Visual system:** curated design kit, typography, radius, density, motion,
  palette, selected-block variants and visibility;
- **Art direction:** an optimized user-supplied hero/background asset included
  in preview, publishing and ZIP without being sent to an AI provider;
- **Direction:** preset-specific quick prompts plus free or BYO model proposals
  that are reviewed before Apply;
- **Recovery:** a checkpoint for every applied direction and one-click undo.

Each category still retains deeper settings of its own: risk and audit for
decision/copy tools; editorial rhythm for briefs and channels; ranking and
watchlists for aggregators; memory and personality for assistants; care state
for Tamagotchi; voting/submission for Product Hunt; and real media transport
for Radio.

## Integration hierarchy

### Core

- DropsTab Public API: market intelligence, categories, unlocks, funding and
  research links when the user connects access.
- Drops Bot: alerts, wallet monitoring, Telegram delivery, Polymarket tracking
  and action continuation through documented product surfaces.

### Included extensions

- Polymarket Gamma API for public prediction context;
- a public price adapter for no-login runtime continuity;
- Telegram Mini App-compatible static exports;
- OpenRouter Free and paid BYOK model routing;
- OpenAI, Anthropic, Kimi and custom OpenAI-compatible models;
- Web Speech APIs for audio and voice products.

### Hosting

- Drops Studio Cloud: free public subpath, immediate and real;
- static source ZIP: runs locally or on any static host;
- Vercel / Cloudflare / GitHub Pages / Netlify export targets;
- production self-hosted package with provider config files.

Provider-specific buttons must either complete a real deployment or clearly
state that they export and continue to the provider. The UI must never display
`Published` before a provider confirms success.

## Security and trust rules

- AI providers produce bounded JSON specifications, not executable code.
- Server publishing recompiles from the validated specification.
- Public projects contain no provider or DropsTab credentials.
- Keys stay session-only and are not copied into projects or ZIP files.
- Generated runtimes are sandboxed inside Project Studio.
- Trading buttons are planning, paper mode or official-product handoffs unless
  a future signed execution connector is explicitly added.
- Published content has strict size, field and recipe validation.

## Release gate

The premium release is complete only when automated and browser checks prove:

- all 12 Build buttons create distinct runnable products;
- every My Projects item reopens its Project Studio;
- Crypto Game can complete and restart a round;
- source ZIP contains a runnable `index.html` plus deployment files;
- free publishing returns a public URL and that URL works anonymously;
- the public page contains no editor chrome;
- model-enhanced generation has a verified Free and paid path;
- desktop and mobile have no clipped primary controls or horizontal overflow;
- production console and worker logs contain no relevant errors.
