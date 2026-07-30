# Integration contract

The product works without requiring new backend development from DropsTab or Drops Bot.

## DropsTab

Live market mode uses the documented coins endpoint:

```text
GET https://public-api.dropstab.com/api/v1/coins?page=0&pageSize=10
x-dropstab-api-key: <key>
accept: application/json
```

Pagination is strictly zero-based. The client accepts all documented list
shapes: a top-level array, `data` as an array, `data.content`, and top-level
`content`. It never adds undocumented sorting parameters to the base request.

The local `/api/dropstab` route is the visitor-connected BYOK path. It forwards
the key only for the explicit connection or refresh request, uses private
`no-store` responses, never shares its cache with another visitor, and never
persists the credential. A deployment may separately set the platform-owned
`DROPSTAB_API_KEY`; `/api/public-data` then uses it server-side without exposing
it. Platform and visitor-connected credentials never cross paths. If no
platform key is configured, the runtime labels its public feed as a fallback
rather than presenting it as DropsTab data.

Every runtime and release artifact records one explicit provider-evidence
value: `dropstab`, `fallback`, or `unverified`. Only an adapter response whose
payload contains `provider=dropstab` passes the live DropsTab provider check.
The separate critical adapter-contract check proves that the generated product
has a real endpoint, refresh path, source label, and connection/BYOK handoff.
Therefore an honestly labelled fallback can keep a web-native product runnable
and publishable, while the provider check remains visibly pending; Coinbase,
test fixtures, generic public-price data, and `unverified` never count as live
DropsTab evidence.

The platform feed uses a 15-minute warm-runtime cache, in-flight request
de-duplication and stale-while-revalidate CDN delivery. Its steady-state target
is one `/coins` request per warm cache window, but serverless cold starts,
regions and bounded retries mean this is intentionally documented as a budget
policy rather than a false global hard cap. Generated products request the
adapter on initial load and explicit refresh only; they never poll DropsTab.
In-flight platform requests are de-duplicated. Transient `429`, `5xx`, and
timeout/network failures use at most three attempts with 1-second then 2-second
backoff. `400`, `401`, `403`, and `404` are terminal; the known `400 page does
not exist` response is classified as an end-of-pages signal rather than retried.
The request timeout is 30 seconds per attempt.

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

There are two distinct real flows:

1. **New channel through MTProto.** The Studio wizard connects the user's
   Telegram account with `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, seals the
   session with `TELEGRAM_SESSION_ENCRYPTION_KEY`, and only after explicit user
   approval creates a broadcast channel, adds the configured bot as an admin,
   publishes the first post, and returns Telegram provider evidence. The
   preferred platform bot variable is `DROPS_STUDIO_TELEGRAM_BOT_TOKEN`.
2. **Existing-channel fallback.** A generated/exported product accepts a
   visitor's BotFather token and owned `@channel` or `-100…` ID for that browser
   session, then verifies the bot identity, channel identity, administrator
   permission, and optionally sends a test post through the Bot API. It does not
   create or select an existing channel through the MTProto wizard and does not
   persist the token.

`BLOB_READ_WRITE_TOKEN` or the provider combination `BLOB_STORE_ID` plus
`VERCEL_OIDC_TOKEN` supplies durable production request/rate-limit state. These
are variable names only; credentials must be configured in the deployment
secret store and never copied into generated products.

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

Free Auto first uses a platform-funded Vercel AI Gateway route with a signed
three-build daily guest quota and several free-model fallbacks. When that
capacity is unavailable, a deterministic category-aware planner still creates a
working product. `Continue with OpenRouter` uses PKCE: the returned stable
OpenRouter user identity is signed into an HttpOnly Drops Studio member session,
while its generated API key remains only in the initiating browser tab. A
signed-in member can use ten platform-funded planning attempts per UTC day when
the durable quota backend is available. The same signed member identity owns a
private, revisioned project collection in Vercel Blob when that backend is
configured. The cloud collection stores validated specs, checkpoints and
Director proposals only; executable HTML and model credentials remain outside
the account record. Connected OpenAI, Anthropic, OpenRouter and Kimi accounts can
improve planning through `/api/agent/plan` and bounded product configuration
through `/api/generate`. OpenRouter defaults to `openrouter/free`; availability
and limits remain controlled by OpenRouter. Custom endpoints are called directly
from the visitor's browser, so the hosting service does not become an
unrestricted request proxy.

Models never generate executable HTML. The server and browser compile the same validated project specification, so model output cannot inject scripts or credentials into a published product.

## Publishing and source ownership

Free publishing stores a validated specification and freshly compiled standalone HTML in Cloudflare D1 on Sites or Vercel Blob on the public fallback, then returns an anonymous `/p/{slug}` URL. The public route is the product itself and contains no editor chrome. The Hobby Blob path is capped by the provider's free quota rather than silently creating charges.

Publishing is fail-closed at the server boundary. The server recompiles the
validated specification, parses every executable inline script, verifies the
category-native runtime marker, interaction contract, truthful delivery mode,
adapter and Drops Bot handoffs, approval-safe actions, and credential safety,
then rejects the release with `422` if any critical check fails. This server
artifact smoke is recorded separately from the browser-executed sandbox smoke;
it is not presented as proof that an external provider completed setup.

Before persistence, the complete incoming specification (including the full
prompt and nested values) and the generated HTML are scanned for BotFather
tokens, JWTs, GitHub tokens, AWS access keys, provider API keys, bearer tokens,
and generic secret assignments. A match returns a redacted error and no
artifact is stored. Credentials belong in the session-only Connections vault,
never in prompts, project values, source, or published HTML.

The ZIP export contains:

- the same runnable `index.html`;
- editable `project.json` without credentials;
- `drops.config.json` with the honest data/action/AI integration manifest;
- `quality-report.json` from the same release gate used before publishing;
- `tests/smoke.mjs` for source-owned runtime checks;
- Vercel, Cloudflare, Netlify and GitHub Pages configuration;
- a run and deployment README.

Archive creation applies the same secret policy to **every ZIP entry**, even an
entry with a binary-looking extension. It also converts root-relative game
assets and included API paths to relative URLs. The downloaded application is
tested from a nested deployment path, so its artwork and interactive runtime do
not depend on being hosted at `/`. `drops.config.json`, `quality-report.json`,
and the root HTML attribute preserve `dropstab | fallback | unverified`
provider evidence without upgrading fallback data into a DropsTab claim.

Paid-hosting cards are honest export handoffs. Only Drops Studio Cloud reports `Published` after persistence confirms success.

## Execution safety

Generated-product actions either change local product state, create an explicitly labelled paper action, open an official external product, copy a share link, or prepare a Drops Bot handoff. They do not execute a transaction. This preserves an honest boundary around wallet signatures, Telegram configuration and trading approvals.
