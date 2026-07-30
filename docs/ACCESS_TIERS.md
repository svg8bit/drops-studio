# Access and model tiers

This document records what the current release actually provides. It is a
runtime contract, not a pricing promise.

## Working now

### Guest

- No registration is required.
- The server issues a random, signed, HttpOnly anonymous identity. Client
  supplied IDs are not trusted for Gateway attribution.
- The platform funds up to three successful AI plans per UTC day and browser
  identity when `DROPS_GUEST_COOKIE_SECRET` and Vercel AI Gateway credentials
  are configured.
- The deterministic category-aware compiler remains available when the AI
  quota is exhausted or the Gateway is unavailable.
- Deleting browser cookies creates a new anonymous identity. The current
  cookie quota is a product limit, not fraud-grade abuse prevention; a durable
  account/rate-limit service is required before material paid capacity is
  exposed.

### Signed-in member

- `Continue with OpenRouter` uses OpenRouter's PKCE flow and its stable
  `user_id` to create a signed, HttpOnly Drops Studio member session.
- The OpenRouter API key returned by that flow remains only in browser
  `sessionStorage`; the server persists neither the key nor a provider token.
- A signed-in member receives up to ten platform-funded AI planning attempts
  per UTC day when AI Gateway and the durable rate-limit backend are available.
- The authoritative production quota is keyed by the signed member identity in
  Vercel Blob. A signed display cookie reports the remaining allowance without
  becoming the enforcement source of truth.
- When private Blob storage is configured, the signed member identity owns up
  to 50 cloud project records through `GET | PUT | DELETE /api/projects`.
  Writes use optimistic per-project revisions, so a stale browser receives the
  current record instead of overwriting newer work.
- Cloud records contain validated specs, checkpoints and reviewed Director
  proposals only. Compiled HTML, source artifacts, publish capabilities and
  model/provider keys are rejected and never persisted. The browser remains
  the offline copy and materializes runnable HTML from the returned spec.

### BYOK

- OpenRouter, OpenAI, Anthropic and Kimi API keys are held in browser
  `sessionStorage` and forwarded only for the explicit planning request.
- A custom OpenAI-compatible HTTPS endpoint is called directly by the browser.
- OpenRouter OAuth exchanges an authorization code for an OpenRouter API key;
  the same provider response also creates the signed Studio member session. It
  is not a login to a consumer ChatGPT or Claude subscription.
- Provider usage is billed by the provider to the user. Drops Studio does not
  add a model markup in this path.

## Not implemented and therefore not advertised as active

### Full account administration

Authenticated private project sync is implemented, but email/profile editing,
account recovery, data export across every service and identity-provider
migration are not yet implemented. Those features must not be implied by the
OpenRouter member session.

Consumer ChatGPT and Claude subscriptions still cannot be used as generic API
credentials. OpenAI and Anthropic API projects, or an explicitly supported
provider OAuth flow, are required.

### Pro

No billing product, checkout, subscription webhook or paid entitlement store
is configured. A Pro badge or higher quota must not be enabled until those
provider-confirmed states exist. At minimum this needs Stripe (or another
billing provider) credentials, product/price identifiers, webhook verification,
an entitlement table and cancellation/refund handling.

## Machine-readable status

`GET /api/access` returns the current honest capability metadata, recognizes a
signed OpenRouter member session and otherwise creates the signed anonymous
identity when signing is configured. Planner responses include the same
`access` object. `access.account.projectSync` becomes `true` only when the
private project backend is actually configured; clients can therefore show the
real guest/member/BYOK boundary without inventing cloud sync or Pro availability.
