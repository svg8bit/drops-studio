# Integration contract

The product works without requiring new backend development from DropsTab or Drops Bot.

## DropsTab

Live market mode uses the visitor's API key and the documented coins endpoint:

```text
GET https://public-api.dropstab.com/api/v1/coins
```

The local `/api/dropstab` route acts as a narrow proxy. It forwards the key only for that request, normalizes the response for the preview, and never persists the credential.

Relevant official references:

- <https://api-docs.dropstab.com/>
- <https://api-docs.dropstab.com/llms.txt>

The broader product recipes are based on documented DropsTab resources such as coins, price history, token unlocks, funding rounds, investors, activities, exchanges and pairs. A user-connected response becomes the safe initial snapshot of a generated project. Public and exported apps refresh through the no-secret public market adapter while keeping DropsTab attribution and research handoffs.

## Drops Bot

Drops Bot is integrated through the official Telegram surface and documented setup concepts:

- wallet tracking and filters
- price, swap, funding and token alerts
- Polymarket monitoring
- channel and group profiles
- Caller Mode
- Solana trading surfaces
- wallet event webhooks where available to the connected account

Generated products open `https://t.me/Drops` for the final setup and approval. They do not claim that every Telegram configuration can be created remotely because a complete public remote-configuration API is not documented.

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

Free Auto is a deterministic local planner and product compiler. Connected OpenAI, Anthropic, OpenRouter and Kimi accounts can improve planning through `/api/plan` and bounded product copy/theme values through `/api/generate`. OpenRouter defaults to `openrouter/free`; availability and limits remain controlled by OpenRouter. Custom endpoints are called directly from the visitor's browser, so the hosting service does not become an unrestricted request proxy.

Models never generate executable HTML. The server and browser compile the same validated project specification, so model output cannot inject scripts or credentials into a published product.

## Publishing and source ownership

Free publishing stores a validated specification and freshly compiled standalone HTML in Cloudflare D1, then returns an anonymous `/p/{slug}` URL. The public route is the product itself and contains no editor chrome.

The ZIP export contains:

- the same runnable `index.html`;
- `project.json` without credentials;
- Vercel, Cloudflare, Netlify and GitHub Pages configuration;
- a run and deployment README.

Paid-hosting cards are honest export handoffs. Only Drops Studio Cloud reports `Published` after persistence confirms success.

## Execution safety

Generated-product actions either change local product state, create an explicitly labelled paper action, open an official external product, copy a share link, or prepare a Drops Bot handoff. They do not execute a transaction. This preserves an honest boundary around wallet signatures, Telegram configuration and trading approvals.
