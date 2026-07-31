# Project V2 security model

This document records the trust boundaries and enforced controls in the current
Project V2 implementation. The native V2 workspace and builder/runtime path are
connected to Project Studio; this is not a claim that every external integration
or production operation is enabled. Known gaps are listed explicitly.

## Assets and trust boundaries

Drops Studio protects:

- signed guest/member identity and project ownership;
- AI, DropsTab, Drops Bot, Telegram, GitHub and Vercel credentials;
- canonical Project V2 source and checkpoint history;
- command, browser and provider evidence;
- external repositories, deployments, channels, webhooks and data stores;
- platform compute and provider quotas.

The main boundaries are:

1. **Browser to Studio API.** Browser state, model output, iframe messages,
   prompts and submitted files are untrusted.
2. **Studio API to private persistence.** Only validated, owner-scoped,
   secret-free snapshots may be stored.
3. **Studio API to Vercel Sandbox.** Generated code crosses into an isolated,
   empty-environment Node 24 runtime through a bounded file/command contract.
4. **Studio API to external providers.** Credentials are request-only or
   server-only, mutations require approval, and provider responses are the only
   source of completion evidence.
5. **Generated application to data/integrations.** A generated app receives a
   narrow server proxy or capability, never a general secret-bearing proxy.

## Identity and authorization

Project V2 snapshot and builder routes resolve an actor from signed HttpOnly
cookies. A signed account identity is preferred; otherwise a signed guest
identity is used. Required signing-secret names are:

```text
DROPS_GUEST_COOKIE_SECRET
DROPS_ACCOUNT_COOKIE_SECRET
```

Production secrets must meet the implementation's minimum strength. A
client-supplied guest ID, member ID, actor ID or project owner is not an
authorization source.

Private Blob keys use a SHA-256 actor namespace plus project ID. The API loads
and saves a project only inside that namespace. A stale storage revision returns
HTTP 409 with the current copy; it does not overwrite a concurrent edit.
Same-origin checks protect project mutations, builder requests, GitHub actions,
Vercel actions and project-data mutations. Cross-site requests fail before the
external action.

## Project file boundary

[`validateProjectV2`](../lib/project-v2-validator.ts) validates the complete
strict schema and checks that metadata matches the actual `package.json` and
file graph. The source limits are:

- 64 files;
- 512,000 UTF-8 bytes per file;
- 1,500,000 UTF-8 bytes in total;
- 240 UTF-8 bytes per path;
- 64 file operations in one revision.

Paths must be normalized relative POSIX paths. Absolute/drive paths,
backslashes, null bytes, empty or dot segments, traversal, `.git`,
`node_modules` and `.env*` are rejected. Only text-file records are accepted;
the Sandbox writer verifies regular-file status with `lstat` and rejects
symlinks.

Files carry SHA-256 hashes. The project `contentHash` covers the canonical
manifest, files and file contents, product metadata, integrations, environment
schema, permissions, tasks, migration metadata and revision. Array/object key
ordering is canonicalized for deterministic validation.

Mutations are optimistic and atomic. Each operation starts from an expected
revision, applies all changes to a copy, validates the complete result, updates
file provenance/timestamps/hashes and commits one new revision. Required files
cannot silently disappear. Checkpoint restore also creates a new revision.

## Secret handling

Credential values are not valid project data. The shared artifact scanner
rejects provider API keys, bearer credentials, Telegram BotFather tokens,
GitHub tokens, Vercel tokens, JWTs, AWS-style access keys, private-key material
and common secret assignments before persistence/export/runtime execution.
Nested metadata is scanned, not only filenames.

Builder tool inputs are scanned before execution. Tool outputs, audit details,
runtime error messages, stdout/stderr/log chunks and provider errors are bounded
and scanned/redacted before returning. Secret-looking output is replaced with a
generic safe message rather than partially displayed.

Canonical command history stores only bounded run and log metadata, including
IDs, status, timing, exit code, byte count and truncation. It does not persist
stdout/stderr or browser payload text in Project V2/checkpoints. The full bounded
evidence is shown only from the current authorized runtime/response.

BYOK provider keys are held in browser `sessionStorage` and forwarded only for
an explicit user-triggered request. The builder API accepts them in bounded
request headers; it never includes them in the result. The Project V2
environment array is a **schema of names and requirements**, not a store for
values.

Private Vercel Blob, Sandbox, GitHub App, Vercel deployment, Telegram MTProto
and project-data signing credentials remain server environment variables. Their
names are documented, but their values must never be copied into prompts,
source, logs, ZIPs or support output.

## Sandbox isolation

Generated code executes only through the
[`ProjectRuntimeAdapter`](../lib/project-runtime-adapter.ts) contract. The
Vercel implementation provisions a named persistent Firecracker Sandbox with
Node 24, 2 vCPU, ports 3000/8080 and an empty environment. It does not inherit
the Studio production environment.

The Sandbox begins with deny-all network access. Dependency installation
temporarily allows the npm registry and narrowly enumerated source hosts, runs
`npm install` with lifecycle scripts disabled, then switches to the trusted
runtime allowlist (deny-all by default).

Commands are structured argv calls. Arbitrary shell strings, traversal paths,
undeclared package installation and Node eval/import escape flags are rejected.
Normal execution is time-bounded; build-class commands are capped at five
minutes. Timeouts/failures kill the process. Output is capped at 64 KB, streaming
logs at 256 chunks and each chunk at 8 KB. Every command has a hashed-actor audit
record.

Idle cleanup is exposed only through the bounded builder cleanup route. It uses
constant-time comparison of the Bearer credential named `CRON_SECRET`, requires
at least 32 characters in production, accepts a 5–240 minute idle cutoff from
`DROPS_STUDIO_SANDBOX_IDLE_MINUTES`, and stops only `ds2-` Sandboxes. The route
does not authorize project deletion or provider-Sandbox destruction.

See [Sandbox operations](SANDBOX_OPERATIONS.md) for exact lifecycle and
troubleshooting behavior.

## AI-agent permissions and approvals

Every builder tool has a strict Zod input/output schema, one permission, a
timeout, a 32 KB tool-output bound, a secret rule and an approval policy.
Read/write/check/build/preview tools are automatic within their granted scope.
These tools require explicit user approval:

- `delete_file`;
- `rename_file`;
- `restore_checkpoint`;
- `publish_project`.

The trusted server resolves approval evidence separately from the public JSON
body. A model cannot include an approval flag in its tool arguments to approve
itself. `request_connection` may report `connected` only from an injected
connection service with evidence; without one it reports `setup-required`.

The orchestrator never claims completion without a production build, running
preview and successful configured browser check. It performs at most three
automatic repair iterations.

## External-action approvals

The following external/destructive actions have additional route-level consent:

| Action | Control |
| --- | --- |
| GitHub repository import | `approved: true` |
| GitHub branch, commit and pull request | `approved: true`; non-force ref update |
| Vercel preview deployment or checkpoint redeployment | `approved: true` |
| Vercel deployment cancellation | `approved: true` |
| Project checkpoint restore/Sandbox destroy | runtime `confirm: true` |
| Drops Bot callback create/rotate/revoke | signed account, owned project, same origin and `consent: true` |
| Telegram verification/test delivery | explicit request; real Bot API verification/result |
| Telegram MTProto/channel creation | explicit guided account flow and provider result |

No route may infer approval from the prompt or an AI message. Readiness,
accepted, queued and setup-required are not relabeled as completed.

## Server-issued release evidence

Project JSON is user-editable, so checkpoint labels, run metadata, browser log
metadata and preview fields are not sufficient deployment authorization. After a
real Sandbox release gate succeeds, the builder route writes a separate private
release receipt with `verification: sandbox-release-gate`. The receipt is bound
to all of:

- signed actor identity;
- project ID and revision;
- Project V2 content hash;
- verified checkpoint ID;
- checkpoint snapshot hash.

Receipts are stored under an actor/project-scoped private Blob prefix, or in the
explicit non-production local proof backend. They are never added to Project V2,
checkpoint JSON, browser responses, logs or ZIPs. Receipt storage is fail-closed:
if a passing build cannot persist its receipt, the builder returns 503 and the
source is not deployable. Vercel deploy requires an exact receipt for the current
verified checkpoint; checkpoint redeployment requires the exact receipt for the
selected checkpoint. Copying verified-looking metadata to another revision,
project or actor cannot satisfy this lookup.

Project deletion removes all actor/project release receipts before removing the
canonical snapshot. If receipt cleanup cannot be confirmed, deletion fails and
retains the project for a safe retry.

## Private Project V2 persistence

Snapshots use a dedicated private Vercel Blob store selected by:

```text
BLOB_STORE_ID
VERCEL_OIDC_TOKEN
```

Vercel injects the short-lived OIDC token at runtime. The independent
`BLOB_READ_WRITE_TOKEN` is scoped to the public legacy publication store and is
never used for private snapshots or mutable control-plane state.

The storage envelope is capped at 8,000,000 bytes and revalidates the complete
Project V2 object before write/read. Blob ETags provide compare-and-swap. A
local-only, process-memory path exists behind `DROPS_STUDIO_LOCAL_PROJECT_STORE`
and is never durable production storage. The browser fallback is `localStorage`
with optional Web Locks, not IndexedDB.

Storage unavailability returns 503 and leaves the browser project available. It
does not silently claim cloud sync.

## Realtime collaboration and first-party OIDC

The collaboration transport stores bounded room envelopes in the same durable
project-data backend. A signed Studio member, workspace membership and shared
project scope are required for normal requests. Writes additionally require
same-origin proof and owner/editor RBAC. CAS revisions, idempotency keys,
retention limits, rate limits and credential scanning fail closed.

The first-party OIDC issuer derives an Ed25519 key from dedicated server-only
signing material. Its JWKS contains only the public key. Authorization codes are
random, short-lived, PKCE-bound, exact-redirect-bound and consumed once through
private Blob ETag CAS. Client and signing secrets must differ. Token, provider
secret and member-cookie material are excluded from project files, ZIPs,
checkpoints, logs and public health responses.

## Built-in project data

`/api/project-data` uses an HMAC bearer capability signed with:

```text
PROJECT_DATA_CAPABILITY_SECRET
```

The signing secret must be at least 32 bytes. A capability is restricted to one
project, at most 16 named namespaces, selected `read`/`write`/`delete`
permissions, a subject, a nonce and a lifetime no longer than 24 hours. Mutation
requests are same-origin and use per-document optimistic revisions.

Documents must be plain JSON objects. Prototype keys, non-finite numbers,
excessive nesting/nodes and credential-like data are rejected. Default quotas
are 16 namespaces/project, 500 documents/namespace, 64 KiB/document, 2 MiB per
project, depth 20 and 4,096 JSON nodes.

Current deployment limitations are security-significant:

- the route has no built-in production durable backend; hosting must inject a
  `durable-adapter`;
- `DROPS_STUDIO_LOCAL_PROJECT_DATA` enables only process-memory demo storage;
- a `WebStorageProjectDataBackend` exists for an explicitly labelled browser
  fallback, but the server route does not select it;
- there is no public capability-minting route in this repository;
- the route limits each capability to 600 reads or 240 mutations per hour, but
  those counters do not replace durable storage or trusted capability issuance;
- the signed nonce is not maintained as a one-time replay registry.

Until a durable adapter, trusted capability issuance and abuse control are
wired, production Project Data must remain `setup-required`/unavailable.

## DropsTab boundary

DropsTab server-side platform access uses `DROPSTAB_API_KEY`. The key remains on
the server. Generated applications use `/api/public-data`, which returns typed
normalized coins, unlocks, funding and activities with source/capability
evidence. The platform result is cached for 15 minutes, in-flight calls are
deduplicated and provider requests are retried at most three times within a
30-second request budget.

When the key or provider data is absent, the proxy returns a labelled public
price fallback with DropsTab capabilities set false. It is never called live
DropsTab data. `/api/dropstab` is a separate explicit BYOK refresh path whose
key is sent in `x-dropstab-api-key` and whose response is private/no-store.

Only documented official endpoint paths in the typed registry are used:
`/coins`, `/tokenUnlocks`, `/fundingRounds` and `/cryptoActivities`.

## Drops Bot and Telegram boundary

The Drops Bot SDK describes documented/observed capabilities and provider
evidence. It does not invent wallet-write endpoints. Wallet CRUD and remote
configuration remain an honest manual handoff when the official surface does
not expose a documented API.

The callback route creates a 32-byte random capability embedded in a secret URL,
returns it once, and stores only its SHA-256 hash. Creation/rotation/revocation
requires a signed Studio account, an owned stored project, same-origin request
and explicit consent. Callback payloads are bounded to 64 KiB, parsed as strict
JSON, recursively redacted, secret-scanned and deduplicated by the SHA-256 hash
of the raw body. Durable webhook state uses the existing D1 binding or private
Blob path; production fails closed without either.

The public Drops Bot documentation does not define a provider signature scheme
for this callback. A valid secret URL proves possession of the capability, not
provider identity. Receipt changes evidence to `callback-received`; it is never
labelled provider-signature verified or registered until actual provider
evidence exists.

Telegram MTProto account/channel setup retains its encrypted server session
contract using `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` and
`TELEGRAM_SESSION_ENCRYPTION_KEY`. Bot API fallback may use
`DROPS_STUDIO_TELEGRAM_BOT_TOKEN`; a user-supplied BotFather token is verified
against real Telegram methods for that explicit request and is not persisted in
the project.

Every outbound Telegram/Drops Bot delivery remains approval-gated. A copied
command or pending callback is `Setup required`, not a completed delivery.

## GitHub and Vercel deployment boundary

GitHub uses a least-privilege GitHub App or a request-only session token. Import
and publish limit text paths/count/bytes, reject secrets, use non-force branch
updates and require approval. Vercel deployment accepts only bounded, validated,
secret-free source; it creates previews and confirms success only from a
provider `READY` state plus URL. Neither integration sends its credentials into
Sandbox or generated files.

See [GitHub and deployment setup](GITHUB_AND_DEPLOY_SETUP.md).

The mounted V2 Deploy surface performs an explicit-confirmation preview
deployment and persists only a provider-confirmed current receipt. It also
exposes GitHub readiness, a tab-scoped session-token field when the GitHub App is
unavailable, repository inspect/import and an explicitly approved pull-request
action. GitHub App installation/OAuth, Vercel session-token acquisition,
checkpoint redeployment/rollback and production alias promotion are not
connected UI actions.

GitHub publish and Vercel deployment do not trust a client-submitted source
graph. Each route resolves the signed Studio actor and loads the owned canonical
`studioProjectId` snapshot; platform credentials cannot be redirected to a
client-selected installation, repository outside the configured allowlist,
team or generated-app project. Vercel deploy additionally requires both a
complete release gate for the current revision and its exact private release
receipt; checkpoint redeployment requires the selected checkpoint's exact
receipt. Session-token mode remains request-only and may target only the scope
authorized by that visitor-owned token.

## ZIP and checkpoint safety

V2 ZIP creation starts from a fully validated Project V2 file graph, rejects
collisions with reserved export paths, adds a name-only `.env.example`, and
secret-scans every archive entry. It excludes runtime handles, logs, preview and
deployment state, and checkpoint history.

Project checkpoints include source and canonical metadata, so their complete
payload is also secret-scanned before private persistence. A checkpoint never
contains provider keys or Sandbox process environment.

## HTML and browser safety

Legacy V1 generation/publish retains its existing compiler, source workspace
validator and publication release gate. Those paths reject unsafe runtime
shapes and secret-bearing artifacts before compiling/publishing standalone
HTML. Project V2 does not rely on static source inspection as its only code
execution boundary: generated Next.js code runs only in Sandbox and still must
pass the real build, preview and browser checks before release.

Browser telemetry and iframe messages are untrusted evidence. The default
server-side `VercelAgentBrowserChecker` accepts only HTTPS `*.vercel.run`
preview hosts, makes an initial bounded HTTP request, then creates a separate
empty-environment browser Sandbox whose network allowlist contains only that
preview hostname. It reads accessibility/render evidence, activates one safe
visible interaction and checks page, console and failed-network evidence. The
prebuilt browser runtime is selected only by the server environment name:

```text
AGENT_BROWSER_SNAPSHOT_ID
```

Without a valid snapshot ID, the release gate blocks instead of substituting a
mock browser result.

## Non-goals

Drops Studio does not implement:

- private-key, seed-phrase or exchange-secret custody;
- wallet signing or automated trading;
- an unrestricted shell or outbound network proxy;
- an unrestricted public database proxy;
- automatic GitHub merge or force push;
- automatic production-domain promotion;
- unapproved Telegram/Drops Bot publication;
- simulated webhook registration, provider connection, deployment or test
  success.

Generated products may prepare a transaction/handoff or simulate a clearly
labelled paper action, but execution remains in the user's wallet/provider.

## Known gaps before a production Builder V2 claim

- The default builder route injects a browser checker and deterministic build
  fallback, but no publisher or connection service.
- Browser verification remains setup-required without a valid
  `AGENT_BROWSER_SNAPSHOT_ID`.
- Project deletion fail-closes if its deterministic Sandbox cannot be destroyed.
  The every-15-minute idle cleanup schedule fails closed until a production-
  strength `CRON_SECRET` is configured and remains an operational dependency.
- Private release-receipt storage is an operational dependency. A passing gate
  remains undeployable if its exact server receipt cannot be written or read.
- Project Data lacks a built-in durable backend and trusted issuance route. The
  route has capability-scoped rate limits, but every starter still declares the
  integration `setup-required` until the missing production pieces exist.
- GitHub inspect/import/publish and a browser-session token flow are present in
  Studio. GitHub App installation selection and OAuth/token acquisition are not.
- The V2 Deploy view creates real approved previews and can consume a preloaded
  request-only Vercel token, but there is no Vercel token-acquisition UI,
  checkpoint-redeployment/rollback control or durable multi-deployment history.
- The Integrations view reports manifest/capability/environment-schema state,
  but it does not inject the builder connection requester or perform external
  wallet, webhook, Telegram or database mutations.
- Optional BYO Postgres/Neon/Supabase setup and deployment-environment approval
  are not implemented by these V2 modules.
- No general capability broker exists for arbitrary generated-app API access;
  only the explicitly implemented proxies/capabilities are safe to expose.

These gaps must remain visible as disabled/setup-required states.

## Incident and rollback procedure

If a credential-like value is suspected in any artifact:

1. Stop the preview and Sandbox.
2. Do not print or copy the suspected value into an issue/log.
3. Revoke/rotate it at the provider.
4. Delete the affected private snapshot or external preview only after
   confirming the exact target and retaining a safe source rollback.
5. Restore a known-good checkpoint, rerun secret scans and the full release gate.
6. Audit GitHub, Vercel, Telegram/Drops Bot and Blob provider activity.

If only generated code is faulty, stop the preview, restore a known-good source
checkpoint, rerun install/checks/build/browser verification, and create a new
preview. Never promote an unverified rollback.
