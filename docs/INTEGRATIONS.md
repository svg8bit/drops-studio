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

There are three distinct real flows. The first two are Telegram transport flows,
not proof that the official Drops Bot API was configured:

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
3. **Wallet-event webhook receiver MVP.** A signed Studio account may create one secret
   callback URL for a project it owns, and only after explicit consent. The user
   registers that URL manually through the official `@drops` product because the
   public documentation does not publish a webhook-registration REST path,
   authentication header, payload schema, signature header, or retry contract.
   Studio therefore does not invent any of them. The receiver authenticates the
   capability embedded in the URL, accepts only JSON up to 64 KiB, removes
   credential-like fields and values before persistence, and de-duplicates exact
   deliveries by the SHA-256 hash of the raw body. The secret itself is returned
   once and only its hash is stored. Event reads require the same signed project
   owner.

The official Drops Bot API page currently lists a free allowance of 20 tracked
wallets and 10,000 webhook calls per month. Drops Studio shows that provider
allowance as informational context only; it does not invent or locally override
the account limit reported by `@drops`.

Creating a callback leaves callback evidence at `pending`; it does not mean that
`@drops` accepted the URL. Evidence changes to `callback-received` only after a
valid capability-authenticated callback is actually persisted. The URL is also
known to the user who created it, so this receipt proves neither provider identity
nor provider configuration. It is never described as a Drops Bot verification or
provider-signature verification because the public docs define neither a signature
scheme nor a provider-only secret. Cloudflare D1 is used when bound. When D1 is
absent and Vercel Blob credentials are configured, the receiver uses one private,
CAS-protected Blob state; if neither durable backend is configured, production
fails closed with an unavailable response. The local in-memory path exists only
in the repository proof mode.

The documented Profile flow remains a guided Telegram operation rather than a
fabricated REST call. The user opens their active Drops Bot and sends `/profiles`
in the private chat, adds that same bot instance to the destination, then sends
`/use_thread <Profile>` in the group, channel or topic. Only the user who added
the bot may link that user's Profiles, and one Drops Bot instance is allowed per
destination. Drops Studio copies the command for the user; it does not send the
command or inspect the bot's reply. Even a future Telegram message receipt would
prove only that the command was sent, not that Drops Bot applied the Profile.

`BLOB_READ_WRITE_TOKEN` or the provider combination `BLOB_STORE_ID` plus
`VERCEL_OIDC_TOKEN` supplies durable production request/rate-limit state. These
are variable names only; credentials must be configured in the deployment
secret store and never copied into generated products.

Relevant official references:

- <https://t.me/Drops>
- <https://etherdrops.gitbook.io/etherdrops-bot/>
- <https://etherdrops.gitbook.io/etherdrops-bot/advanced-tools/api>
- <https://etherdrops.gitbook.io/etherdrops-bot/bot-for-groups-and-channels/linking-profiles>
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

The visual Director still returns a validated design object. The source
workspace route is a separate bounded code-generation path: a provider may
return only strict create/update/delete operations against the current optimistic
revision. It cannot directly submit an execution command, lifecycle install
script, lockfile, dot-env file, secret or traversal path; generated source files
also reject `eval`, dynamic functions and direct child-process imports. Validated
`index.html` keeps one inert `application/json` project payload, one exact local
stylesheet and one exact local runtime script. Extra scripts, import maps, link
loads, frames, objects, embeds, base URLs, meta refreshes, inline event handlers,
script-scheme URLs and outbound form actions fail the complete revision.
Validated manifest scripts are derived into explicit package task buttons and run only
after the user selects one inside the isolated sandbox. The server applies file
operations atomically, validates the exact dependency and task contract,
recompiles the canonical runtime and rejects category changes before returning
the revision. Platform-funded generation tries GPT-5.6 Sol first and then the
configured free fallback; BYOK credentials are request-only and do not consume
the platform quota or receive a Drops Studio markup.

### Bounded multi-package workspaces

The canonical root remains a directly previewable and publishable static product:
`index.html`, `src/styles.css` and `src/app.js` are required even when backend or
tooling packages are added. The root `package.json` may declare at most six
explicit one-level directories matching `packages/<safe-name>`. Globs, traversal,
URLs, nested workspace declarations and a missing child `package.json` fail the
entire revision.

Every root or child manifest must set `private: true`. Dependencies and
devDependencies must use exact public npm registry versions. Install lifecycle
scripts, lockfiles, custom registry configuration, overrides, resolutions,
optional/bundled dependencies and package-manager escape hatches are rejected.
The AI patch boundary permits at most 24 aggregate dependency entries across all
manifests; the independently validated sandbox boundary permits at most 64.
Canonical source and sandbox input share a 1.5 MB total file-content limit (the AI
route additionally keeps its existing 512 KB per-generated-file limit).

Declared npm tasks may use the root or one of the declared package directories as
their `cwd`, and the selected task must exist in that directory's manifest. Raw
commands and package-install tasks remain blocked. Vercel Sandbox writes the full
file graph, runs the one root npm install with `--workspaces` and
`--ignore-scripts` while outbound access is limited to the npm registry, then
switches the Firecracker microVM to deny-all networking before any user task.
Package servers therefore run as isolated task/preview processes with provider
receipts; publishing `/p/{slug}` still publishes the required validated web
runtime and does not pretend an ephemeral backend is durable hosting.

## Publishing and source ownership

Free publishing stores a validated specification and freshly compiled standalone HTML in Cloudflare D1 on Sites or Vercel Blob on the public fallback, then returns an anonymous `/p/{slug}` URL. The public route is the product itself and contains no editor chrome. The Hobby Blob path is capped by the provider's free quota rather than silently creating charges.

Publishing is fail-closed at the server boundary. The server recompiles the
validated specification, parses every executable inline script and statically
inspects the category-native marker, interaction contract, truthful delivery
mode, adapter and Drops Bot handoffs, approval-safe actions, and credential
safety, then rejects the release with `422` if any critical check fails. The
result is recorded as `server-inspection` with `executed: false`: it is syntax
and contract evidence, not a claim that the app ran in a sandbox or that an
external provider completed setup. Editable iframe messages remain untrusted
browser telemetry and cannot mint provider evidence.

Before persistence, the complete incoming specification (including the full
prompt and nested values) and the generated HTML are scanned for BotFather
tokens, JWTs, GitHub tokens, AWS access keys, provider API keys, bearer tokens,
and generic secret assignments. A match returns a redacted error and no
artifact is stored. Credentials belong in the session-only Connections vault,
never in prompts, project values, source, or published HTML.

The ZIP export contains:

- the same runnable `index.html`;
- the complete canonical source under `workspace/`, including `src/`, the safe
  Node server, exact package manifest and declared Check/Test/Build/Start tasks;
- editable `project.json` without credentials;
- `drops.config.json` with the honest data/action/AI integration manifest;
- an evidence-sanitized `quality-report.json` from the same release gate used
  before publishing;
- `tests/smoke.mjs` for source-owned runtime checks;
- Vercel, Cloudflare, Netlify and GitHub Pages configuration;
- a run and deployment README.

Archive creation applies the same secret policy to **every ZIP entry**, even an
entry with a binary-looking extension. It also converts root-relative game
assets and included API paths to relative URLs. The downloaded application is
tested from a nested deployment path, so its artwork and interactive runtime do
not depend on being hosted at `/`. Client-created ZIPs always stamp
`data-provider-evidence="unverified"` and write the same value to
`drops.config.json`; browser runtime telemetry is never copied into an archive
as provider proof.

The root archive embeds a restrictive CSP and repeats it in Vercel and Netlify
headers: inline compiled code is allowed, but active subresources and connections
are same-origin only, while frames, objects, workers, base URLs, inline event
handlers and form submission are blocked. The canonical workspace preview uses
a separate HTML response policy that allows only its local `src/app.js` and
`src/styles.css`. Normal HTTPS anchor handoffs remain available because they do
not grant remote code access to the product document.

Paid-hosting cards are honest export handoffs. Only Drops Studio Cloud reports `Published` after persistence confirms success.

## Billing and team collaboration

Stripe is the sole authority for Pro access. Checkout always uses the
server-configured Price; subscription state is accepted only from a verified
webhook and stored with duplicate-event and out-of-order protection. Only an
`active` or `trialing` subscription for that exact Price and an unexpired
subscription period enables the Pro quota and team-write entitlements. Billing
storage or provider failure falls back to Member access instead of trusting
client metadata. AI generation and isolated sandbox execution use separate
tier-derived daily counters, so a generate-then-run flow does not double-charge
the model allowance.

Team workspaces are signed-account resources persisted in D1 or private Vercel
Blob state. Owners manage one-time editor/viewer invites and roles; editors can
write shared projects; viewers are read-only. Shared project writes validate the
same bounded project-draft schema used by cloud sync and compare both workspace
and project revisions. Model keys, executable artifacts, publish capabilities
and Telegram session material are never copied into team records.

Required deployment variables are `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`,
`DROPS_TEAM_INVITE_SECRET` and the existing signed-account and durable-storage
configuration. Missing prerequisites keep these surfaces unavailable and are
not presented as completed billing or collaboration.

## Execution safety

Generated-product actions either change local product state, create an explicitly labelled paper action, open an official external product, copy a share link, or prepare a Drops Bot handoff. They do not execute a transaction. This preserves an honest boundary around wallet signatures, Telegram configuration and trading approvals.
