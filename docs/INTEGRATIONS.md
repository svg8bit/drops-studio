# Integration contract

The product is designed so the current MVP can work without requiring new backend development from DropsTab or Drops Bot.

## DropsTab

Live market mode uses the visitor's API key and the documented coins endpoint:

```text
GET https://public-api.dropstab.com/api/v1/coins
```

The local `/api/dropstab` route acts as a narrow proxy. It forwards the key only for that request, normalizes the response for the preview, and never persists the credential.

Relevant official references:

- <https://api-docs.dropstab.com/>
- <https://api-docs.dropstab.com/llms.txt>

The broader product recipes are based on documented DropsTab resources such as coins, price history, token unlocks, funding rounds, investors, activities, exchanges and pairs. A recipe remains in sample mode until a visitor connects access that supports its live data needs.

## Drops Bot

Drops Bot is integrated through the official Telegram surface and documented setup concepts:

- wallet tracking and filters
- price, swap, funding and token alerts
- Polymarket monitoring
- channel and group profiles
- Caller Mode
- Solana trading surfaces
- wallet event webhooks where available to the connected account

The MVP opens `https://t.me/Drops` for the final setup and approval. It does not claim that every Telegram configuration can be created remotely because a complete public remote-configuration API is not documented.

Relevant official references:

- <https://t.me/Drops>
- <https://etherdrops.gitbook.io/etherdrops-bot/>
- <https://etherdrops.gitbook.io/etherdrops-bot/llms.txt>

## Polymarket

The `/api/polymarket` route reads active public events from the official Gamma endpoint, removes terminal probabilities, prioritizes crypto and macro-impact topics, and exposes a compact read-only object to the preview.

No Polymarket order is placed by this MVP.

## AI providers

The Vault verifies a key against the provider's official models endpoint:

- OpenAI: `https://api.openai.com/v1/models`
- Anthropic: `https://api.anthropic.com/v1/models`
- OpenRouter: `https://openrouter.ai/api/v1/models`
- Kimi/Moonshot: `https://api.moonshot.ai/v1/models`
- Custom: a user-supplied public HTTPS OpenAI-compatible chat-completions endpoint

Free Auto is a deterministic local planner. Connected OpenAI, Anthropic, OpenRouter and Kimi accounts can replace it as the blueprint-planning brain through `/api/plan`. Custom endpoints are called directly from the visitor's browser, so the hosting service does not become an unrestricted request proxy.

## Execution safety

Preview buttons either open an official external product, copy a share link, or add an action to the local blueprint. They do not execute a transaction. This keeps the UI useful while preserving an honest boundary around wallet signatures, Telegram configuration and trading approvals.
