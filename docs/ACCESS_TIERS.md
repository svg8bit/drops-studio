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
- Isolated sandbox execution has a separate three-run daily counter. Running a
  generated revision therefore does not consume the guest's model-generation
  allowance, while the funded compute boundary remains enforced.
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
- The same member receives a separate allowance of ten isolated sandbox task
  runs per UTC day when Vercel Sandbox and the durable quota backend are ready.
- The authoritative production quota is keyed by the signed member identity in
  Vercel Blob. A signed display cookie reports the remaining allowance without
  becoming the enforcement source of truth.
- When private Blob storage is configured, the signed member identity owns up
  to 50 cloud project records through `GET | PUT | DELETE /api/projects`.
  Writes use optimistic per-project revisions, so a stale browser receives the
  current record instead of overwriting newer work.
- Cloud records contain validated specs, checkpoints, reviewed Director
  proposals and the canonical multi-file source graph. Manually edited source
  follows the same optimistic project revision path instead of being silently
  left browser-only.
- Compiled HTML, runtime receipts, terminal output, publish capabilities and
  model/provider keys are rejected and never persisted. The browser remains
  the offline copy and materializes runnable HTML from the validated workspace
  (or the returned spec for a legacy record).

### BYOK

- OpenRouter, OpenAI, Anthropic and Kimi API keys are held in browser
  `sessionStorage` and forwarded only for the explicit planning request.
- A custom OpenAI-compatible HTTPS endpoint is called directly by the browser.
- OpenRouter OAuth exchanges an authorization code for an OpenRouter API key;
  the same provider response also creates the signed Studio member session. It
  is not a login to a consumer ChatGPT or Claude subscription.
- Provider usage is billed by the provider to the user. Drops Studio does not
  add a model markup in this path.

### Pro

- A signed Studio member can open Stripe Checkout and the Stripe billing portal
  through same-origin server routes. Browser input cannot select a price or
  assert an entitlement.
- Pro activates only when a verified Stripe subscription webhook records an
  `active` or `trialing` subscription for the exact configured Pro Price.
  Duplicate and stale webhook events do not overwrite newer entitlement state.
- Pro includes up to 100 platform-funded AI builds and a separate 100 isolated
  sandbox task runs per UTC day, 500 private project records, 10 team
  workspaces and 25 collaborators per workspace.
- Billing failures, a different Price, an expired subscription period, an
  unpaid/canceled status, unavailable durable storage, or missing provider
  configuration all fail closed to the signed-in Member limits.

### Team workspaces

- Pro members can create revisioned team workspaces with `owner`, `editor` and
  `viewer` permissions.
- Invites are one-time signed capabilities. Accepted workspaces remain visible
  to the invited member after a reload without copying project data or tokens
  into the member index.
- Shared projects contain the validated project draft plus its canonical
  multi-file source graph. The boundary re-applies the workspace file, path,
  package, size and secret rules and rejects provider keys, runtime receipts,
  terminal output and compiled HTML.
- Owners and editors write against both workspace and project revisions so a
  stale browser receives a conflict instead of overwriting another
  collaborator. Viewers can read and explicitly apply a verified shared source
  revision to their local editor, but cannot create a team revision.
- The current private owner envelope has an explicit 3 MB capacity across all
  owned teams. A write that would cross it leaves the last durable revision
  unchanged and returns `413 TEAM_SOURCE_CAPACITY_REACHED`, so the UI can ask
  the owner to replace or archive a large shared revision.
- Team writes require current provider-confirmed Pro entitlement. Reading a
  workspace already joined remains available to its member when billing state
  later changes.

## Not implemented and therefore not advertised as active

### Full account administration

Authenticated private project sync is implemented, but email/profile editing,
account recovery, data export across every service and identity-provider
migration are not yet implemented. Those features must not be implied by the
OpenRouter member session.

Consumer ChatGPT and Claude subscriptions still cannot be used as generic API
credentials. OpenAI and Anthropic API projects, or an explicitly supported
provider OAuth flow, are required.

### External provider setup

The implementation includes billing and team collaboration, but a deployment
must configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRO_PRICE_ID`, `DROPS_TEAM_INVITE_SECRET`, the signed account secret and
durable D1 or private Blob storage. Stripe Customer Portal must be enabled and
the webhook endpoint must receive the supported subscription lifecycle events.
Until those external prerequisites exist, the UI and routes report billing and
teams as unavailable; they do not display an active Pro tier.

## Machine-readable status

`GET /api/access` returns the current honest capability metadata, recognizes a
signed OpenRouter member session and otherwise creates the signed anonymous
identity when signing is configured. Planner responses include the same
`access` object. `access.account.projectSync` becomes `true` only when the
private project backend is actually configured; clients can therefore show the
real guest/member/BYOK boundary without inventing cloud sync or Pro availability.
`GET /api/billing/status` returns the provider-backed tier, entitlements and
subscription lifecycle state for a signed account. `GET /api/teams` returns the
owned and joined team workspaces plus the signed account identity used for
role-aware controls.
