# Drops Studio Builder V2

This document describes the Project V2 and builder code that is present in this
repository. It intentionally distinguishes implemented server contracts from
features that are connected to the current user-facing Studio.

## Current integration status

| Surface | Current state |
| --- | --- |
| Project V2 schema, validation, hashing, atomic file revisions, diffs, checkpoints, V1 migration, starter materialization and ZIP creation | Implemented |
| Current prompt and recipe flow | `/api/generate` produces the existing product result, then the browser materializes and stores a Project V2 snapshot |
| Existing Project Studio | Loads an attached Project V2 project or migrates V1 data, attempts private cloud sync, and mounts the V2 surface for native Next.js projects inside the current code workspace |
| V2 workspace component | Mounted with Files, Preview, Integrations, Data, Logic, Test, Logs, History and Deploy views backed by canonical project/runtime/provider state |
| Builder agent API | Called by the V2 surface for automatic first build and explicit build/edit/repair requests; Project Studio Director also uses `edit` for a native V2 project |
| Sandbox control API | Called by the V2 surface for status, declared tasks, live preview, logs, checkpoint restore and stop; command run/log metadata is saved to Project V2 |
| Default builder browser check | Implemented with `VercelAgentBrowserChecker`; it requires a prebuilt `AGENT_BROWSER_SNAPSHOT_ID` |
| Default builder-agent `request_connection` / `publish_project` dependencies | Not configured; those agent tools return `setup-required` or unavailable until hosting code injects the services. The separately approval-gated Studio GitHub/Vercel actions below are connected |
| Free deterministic fallback inside the new agent route | Wired for `build`: it verifies an already materialized deterministic V2 starter through the full Sandbox release gate. Free `edit`/`repair` still requires a connected model provider |
| GitHub API and Studio UI | The Deploy surface reads readiness, accepts a tab-scoped session token when the GitHub App is unavailable, inspects/imports repositories and opens an explicitly approved branch/commit/PR from the actor-owned Project V2 snapshot |
| Vercel preview API | The V2 Deploy view performs an explicitly confirmed preview deployment, waits for provider evidence, displays real status/logs and persists the current deployment metadata |

The native V2 prompt-to-live-preview path is therefore connected in Project
Studio when its infrastructure prerequisites are configured. A successful
agent response is still release-gated: a missing browser snapshot, provider
credential, Sandbox configuration or durable storage is a blocking/setup-
required state rather than simulated success. Connection and agent-level
publishing tools remain disabled until their server dependencies are injected.

## Project V2 is the source of truth

[`ProjectV2`](../lib/project-v2-types.ts) stores the real text-file graph and the
metadata needed to operate it:

- manifest, npm scripts and exact dependency records;
- framework/runtime metadata (`nextjs` or `legacy-html`, Node.js 24);
- `files`, each with language, role, provenance, byte count and SHA-256 hash;
- the existing `GeneratedProjectSpec` as product metadata;
- integrations, environment-variable definitions and permissions;
- tasks, runs and log metadata;
- complete checkpoints, preview and deployment state;
- V1/V2 migration metadata and optimistic `revision`.

The file graph, not compiled HTML, is authoritative for a native V2 project.
Generated, AI-edited and manually edited files use distinct provenance values.
Canonical JSON ordering and SHA-256 produce deterministic file, snapshot and
project-state hashes.

The validated source boundary is stricter than the lower-level runtime boundary:

| Boundary | Limit |
| --- | ---: |
| Project V2 files | 64 |
| Per-file UTF-8 content | 512,000 bytes |
| Total Project V2 source | 1,500,000 bytes |
| Path | 240 UTF-8 bytes |
| File operations in one atomic revision | 64 |
| Checkpoints retained in the model | 50 |

Paths are normalized NFC relative POSIX paths. Absolute paths, Windows paths,
empty segments, `.`/`..`, null bytes, protected `.git`/`node_modules` segments
and `.env*` files are rejected. The model accepts regular text files only; the
Sandbox writer also verifies with `lstat` that an existing target is not a
symlink. Public constructors validate the complete payload and reject
credential-like material.

Every mutation supplies the current revision. A mismatch raises a conflict;
all operations in an accepted revision are applied together, revalidated and
rehash the canonical state. A checkpoint contains the complete canonical file
snapshot plus manifest, product, integration, environment, permission, task and
migration state. Restoring it creates a new revision rather than rewriting
history.

## Starter projects and V1 compatibility

[`materializeProjectV2Template`](../lib/project-template-materializer.ts)
creates a local editable Next.js/React/TypeScript project with npm scripts,
components, tests, README, Vercel configuration, integration metadata and an
environment schema. The existing 12-recipe catalog and custom generated specs
can be materialized through this common path. Every materialized starter marks
`project-data` as `setup-required`; browser-local/demo behavior is usable only
when the generated product labels it honestly.

[`LegacyProjectV2MigrationAdapter`](../lib/project-v2-migration.ts) preserves
old projects:

- a valid V1 source workspace is copied with exact file fidelity;
- an older HTML-only project is reconstructed around its standalone HTML;
- old publish slug and URL metadata are retained;
- migration records whether fidelity is `exact` or `reconstructed`;
- the result selects the `legacy-html` compatibility runtime.

[`LegacyHtmlRuntimeAdapter`](../lib/legacy-html-runtime-adapter.ts) can read,
checkpoint, restore and optionally preview legacy HTML through an injected HTTPS
publisher. It deliberately cannot install packages or claim typecheck, lint,
test or build execution. Existing `/p/{slug}` publishing remains a separate
legacy path.

## Current prompt and build paths

### User-facing native V2 path

1. The user selects a recipe or enters a prompt.
2. Planning and generation use the existing routes and the selected Free/BYOK
   provider behavior.
3. `POST /api/generate` returns the generated product data.
4. The client materializes `projectV2` and saves its browser copy.
5. Project Studio validates an attached Project V2 record or migrates V1 data,
   then performs revisioned private sync and mounts `ProjectV2StudioSurface` for
   a native Next.js project.
6. When the mounted project has no ready preview, the surface starts one
   automatic `build`, recording its project ID/revision in `sessionStorage` to
   suppress a duplicate remount build. The request calls the builder agent and
   its real Sandbox release gate; Free Auto uses the deterministic build
   fallback for the already materialized project.
7. Passing checks update the real Files/diff, Test, Logs, preview URL, runtime
   status and checkpoint state. The Preview iframe uses the verified
   `sandbox.domain(port)` URL.
8. A saved manual file operation uses optimistic Project V2 persistence, marks
   release evidence stale and requires a rebuild. Director edits call the agent
   in `edit` mode and reload the resulting multi-file snapshot.
9. The Deploy view requests explicit confirmation and submits the Project V2 ID.
   The server reloads the actor-owned canonical source, uploads it to Vercel,
   waits for `READY`, then the Studio persists and displays the confirmed preview
   deployment metadata.

Legacy HTML projects retain the legacy runtime/publish path and are not
silently sent through the native Next.js agent flow.

### Project Studio surface

The mounted V2 surface is a controller over `ProjectV2Workspace`, not a mock
terminal or static preview. It currently provides:

- Files: collapsible tree, cross-file search, lazy CodeMirror editor, unsaved
  state, save, create, rename, delete, diff and file revert;
- Preview: real sandbox URL, desktop/tablet/mobile frames, refresh, runtime
  state, active duration and Stop;
- Data: the declared Project Data namespace/capability and canonical data/schema
  files; starters remain `setup-required` and the view does not fabricate
  collections, records or durable persistence;
- Logic: declared tasks/scripts, permission policy and framework entrypoints;
- Test and Logs: declared runtime tasks, check results, command stdout/stderr,
  browser diagnostics and deployment logs; bounded run/log metadata survives in
  Project V2 while full command text remains runtime evidence;
- Integrations: integration/capability state and required environment names,
  without credential values or fabricated provider evidence;
- History: canonical checkpoints, comparison and confirmed restore;
- Deploy: release readiness, explicit preview deployment, current provider
  receipt and receipts from the current Studio session; the same surface exposes
  GitHub readiness, session-token connect/disconnect, repository inspect/import
  and an explicitly approved pull-request action.

The Data and Logic views are inspectors/controllers over real manifest, source
and runtime declarations. They are not claims that a durable generated-app
database, arbitrary connection broker or unrestricted execution environment is
present. In particular, every starter declares `project-data` as
`setup-required` until a durable adapter and trusted capability issuer are
configured.

### Builder-agent contract

The intended executable path is available through
[`POST /api/builder/agent`](../app/api/builder/agent/route.ts):

1. Resolve the signed member or signed guest actor and load only that actor's
   Project V2 snapshot.
2. Validate a bounded `build`, `edit` or `repair` request.
3. Resolve the selected AI provider from request-only credentials.
4. Let the Vercel AI SDK `ToolLoopAgent` inspect and edit real project files
   through strict tools.
5. Persist each file revision with compare-and-swap and synchronize it to the
   isolated runtime.
6. Install dependencies and run typecheck, lint, tests and production build.
7. Start a detached preview, run the configured real browser check and inspect
   errors.
8. Repair verified failures up to three times.
9. Create a checkpoint only after the complete release gate passes.
10. Persist a separate private server-issued release receipt bound to the signed
    actor, project ID, revision, content hash, checkpoint ID and snapshot hash.

The release receipt is minted only after `releaseGate.ok`. It is not part of
`ProjectV2`, the checkpoint, the browser response or an export. If private
receipt persistence fails, the builder route fails closed with HTTP 503 even
though the runtime checks passed; the project must be rebuilt after storage
recovers before it can be deployed.

The model is limited to 24 tool-loop steps, 12,000 output tokens and a four-minute
agent call. The orchestrator performs one initial attempt plus at most three
automatic repair attempts. It never changes a failure into success merely
because the repair budget is exhausted.

## Agent tools and policy

All tool inputs and outputs use strict Zod schemas. Inputs are secret-scanned;
outputs are secret-scanned, redacted/bounded and capped at 32 KB. Every call
checks a permission and records a server-side audit event with a hashed actor
identity.

| Tools | Permission | Timeout | Approval |
| --- | --- | ---: | --- |
| `list_files`, `read_file`, `read_files`, `search_files` | `files:read` | 10 s | automatic |
| `write_file`, `apply_patch` | `files:write` | 20 s | automatic |
| `delete_file`, `rename_file` | `files:write` | 20 s | explicit user approval |
| `install_package` | `runtime:network` | 300 s | automatic, external registry access is restricted |
| `run_command`, typecheck, lint, tests, build | `runtime:execute` | 300 s | automatic |
| `start_preview` | `preview:start` | 90 s | automatic |
| `read_logs` | `runtime:execute` | 10 s | automatic |
| `browser_check` | `browser:check` | 60 s | automatic |
| `create_checkpoint` | `checkpoint:write` | 30 s | automatic |
| `restore_checkpoint` | `checkpoint:restore` | 60 s | explicit user approval |
| `request_connection` | `connection:request` | 30 s | automatic; it may only report connected evidence or `setup-required` |
| `publish_project` | `project:publish` | 300 s | explicit user approval |

Approval evidence is resolved by trusted server code. Tool names are not
accepted as approvals in the public JSON request, so the model cannot approve
its own destructive or external action.

## Release gate

[`BuilderAgentSession.runReleaseGate`](../lib/builder-agent/workspace.ts) checks
the following real operations in order:

1. dependency installation when requested;
2. typecheck, lint and tests when their scripts exist;
3. mandatory production build;
4. detached live preview;
5. configured browser check.

The browser result must report a rendered page, a checked primary interaction,
no unexpected page errors and an overall successful result. Command output and
browser errors are returned as evidence. The default checker accepts only an
HTTPS `*.vercel.run` Sandbox domain, first performs a real HTTP request, then
uses an isolated `@agent-browser/sandbox` session restricted to that hostname.
It checks render/accessibility evidence, activates the first safe visible
interaction, and reads page, console and failed-network evidence. A production
build failure or missing `AGENT_BROWSER_SNAPSHOT_ID` is blocking. The gate does
not treat a static mockup, an iframe message or a guessed URL as preview evidence.

This product release gate is separate from the repository release gate in
`AGENTS.md`. After the bounded local commands, repository review uses
`coderabbit review --agent --base main`; CodeRabbit is not a generated-project
runtime check and introduces no application environment variable.

## AI providers and credentials

The builder resolver supports Vercel AI Gateway, OpenAI, Anthropic, OpenRouter,
Kimi and a custom OpenAI-compatible public HTTPS endpoint. BYOK keys are read
only from explicit request headers for that invocation. They are not included
in the project, Sandbox environment, audit detail or response.

Gateway resolution uses the request-scoped `x-vercel-oidc-token` supplied by the
Vercel function, server-side `AI_GATEWAY_API_KEY`, or `VERCEL_OIDC_TOKEN`. Custom
base URLs reject credentials in the URL, query/hash components, localhost,
literal private addresses and DNS results that resolve to private/local ranges.

Guests keep provider keys in `sessionStorage`, so their connection remains
tab/session-local. A user who explicitly signs in with Google may choose to
remember a verified connection: the server stores an account-bound AES-256-GCM
envelope using `DROPS_CONNECTION_VAULT_KEY`, while all public account responses
contain status/model/endpoint-host metadata only. Decrypted credentials are
resolved only for an explicit user-triggered plan or edit request and never
enter project files, Sandbox environment, logs, checkpoints, exports or API
responses. Consumer ChatGPT or Claude subscriptions are not API credentials.

Google profile sign-in uses OIDC Authorization Code + PKCE, a signed bounded
transaction cookie, nonce verification and the exact callback
`/api/auth/google/callback`. Configure `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`; this login is independent from model-provider billing.

## Ownership and persistence

`GET`, `PUT` and `DELETE /api/projects/v2` use a signed member identity when
available, otherwise a signed guest identity. Client-supplied owner IDs are not
trusted. Blob keys contain a SHA-256 actor namespace and project ID. Writes use
both a storage revision and the validated Project V2 revision; stale writes
return HTTP 409 with the current server copy.

Private Vercel Blob uses the dedicated `BLOB_STORE_ID` plus the runtime-injected
`VERCEL_OIDC_TOKEN`. The unrelated `BLOB_READ_WRITE_TOKEN` selects the public
legacy publication store and is passed explicitly only by `/p/{slug}` storage.
`DROPS_STUDIO_LOCAL_PROJECT_STORE` enables an explicit non-production,
process-memory fallback. The browser project store uses `localStorage` and Web
Locks when available. IndexedDB is not implemented.

Verified release receipts use a separate private Blob namespace (or the same
explicit local proof backend) and are never embedded in Project V2 JSON. A
receipt lookup must match actor/project/revision/content/checkpoint/snapshot
identity exactly. Project deletion removes the project's release receipts before
deleting its canonical snapshot and fails closed if that cleanup is unavailable.

Sandbox commands executed through `BuilderAgentSession` append bounded canonical
run records (task/revision/status/runtime/timing/exit/log/audit IDs) and stdout,
stderr or browser log metadata to the same optimistic snapshot. The model keeps
at most 256 runs and 2,048 log-metadata records. Full stdout/stderr and browser
payloads remain bounded runtime/UI evidence and are not copied into checkpoints.

## Export and publication

[`createProjectV2Archive`](../lib/project-v2-export.ts) creates a runnable ZIP
from validated `project.files`. It adds only a name-only `.env.example` and
sanitized export instructions/metadata, applies deterministic ordering and ZIP
timestamps, and secret-scans every entry. Runtime handles, logs, preview state,
deployment state and checkpoint history are not included.

Legacy standalone publishing remains `/p/{slug}`. V2 Vercel preview deployment
is an explicit-confirmation action in the V2 Deploy view and is described in
[GitHub and deployment setup](GITHUB_AND_DEPLOY_SETUP.md). The default builder
route itself still has no publisher dependency, so its `publish_project` tool is
unavailable until one is wired.

Vercel deployment additionally requires the exact private release receipt for
the current verified checkpoint; checkpoint redeployment requires the exact
receipt for the selected historical checkpoint. User-editable checkpoint labels,
run metadata or preview fields cannot substitute for that server evidence.

## Server route contracts

All mutation routes require same-origin JSON, return no-store responses and fail
closed when durable rate limiting or required storage is unavailable.

| Route | Contract |
| --- | --- |
| `POST /api/builder/agent` | `{ projectId, prompt, mode, provider }`; request-only provider headers; result is `completed`, `fallback`, `approval-required` or `blocked`; a passing gate is deployable only after its private release receipt is persisted |
| `POST /api/builder/runtime` | `{ projectId, action, ... }`; actions: `ensure`, `status`, `sync`, `install`, `run`, `typecheck`, `lint`, `tests`, `build`, `preview`, `logs`, `checkpoint`, `restore`, `stop`, `destroy` |
| `GET`/`POST /api/builder/cleanup` | Cron-secret-protected idle cleanup; stops at most 100 named Sandboxes older than the configured 5–240 minute cutoff |
| `GET /api/projects/v2?id=...` | Read the actor-owned snapshot |
| `PUT /api/projects/v2` | `{ project, expectedStorageRevision }`; atomic compare-and-swap |
| `DELETE /api/projects/v2?id=...` | Resume/destroy the actor/project Sandbox, then delete the owned snapshot; provider cleanup failure returns 503 and retains source |
| `GET/POST/PUT/DELETE /api/project-data` | Capability-scoped JSON document service with per-capability read/write limits; starter state remains `setup-required` until a durable adapter and trusted issuer exist |
| `GET/POST /api/integrations/github` | Read readiness, inspect/import a repository, or create an approved branch/commit/PR from the actor-owned `studioProjectId` snapshot |
| `GET/POST /api/deployments/vercel` | Read readiness or perform owned status/log/cancel and approved preview/checkpoint-redeployment operations for an actor-owned `studioProjectId` snapshot with an exact private release receipt |

For the runtime route, `run` requires `taskId`, `logs` requires `commandId`, and
`restore` requires `checkpointId`. `restore` and `destroy` additionally require
`confirm: true`. Preview ports are restricted to 3000 and 8080.

## Setup-required and known incomplete wiring

The following states are intentionally not represented as working:

- The default agent route has a real browser checker and deterministic build
  fallback, but still lacks a connection requester and publisher.
- Real browser verification is setup-required until
  `AGENT_BROWSER_SNAPSHOT_ID` identifies a prebuilt browser snapshot.
- `vercel.json` schedules protected idle cleanup every 15 minutes. The route is
  disabled until production configures `CRON_SECRET`; the optional
  `DROPS_STUDIO_SANDBOX_IDLE_MINUTES` controls the bounded cutoff.
- Project Data has per-capability request limits but no built-in durable
  production adapter or public capability-minting endpoint. Its generated-app
  starter and Data view therefore remain visibly `setup-required`; the route is
  unavailable unless hosting injects an adapter and trusted issuance.
- GitHub inspect/import/publish is wired into the Deploy surface. It can use a
  configured, allowlisted GitHub App or a token held only in browser
  `sessionStorage`; App installation selection and GitHub OAuth/token acquisition
  are not implemented.
- The V2 Deploy view consumes a request-only Vercel token if trusted setup has
  already placed it in session storage, but it does not acquire that token.
- The current deployment is persisted and the current Studio session shows its
  receipts; durable multi-deployment history and the route's checkpoint-
  redeployment/rollback action are not wired into the V2 surface.
- The Vercel deployment route creates preview deployments only. It does not
  promote a production alias.
- External wallet, webhook, Telegram, GitHub, database and deployment mutations
  require explicit approval and confirmed provider evidence where applicable.
- No private-key custody, wallet signing, automated trading or unrestricted
  database/network proxy is implemented.

## Key implementation files

- [Project V2 types](../lib/project-v2-types.ts)
- [Project V2 validator](../lib/project-v2-validator.ts)
- [Atomic file revisions](../lib/project-v2-files.ts)
- [Diff engine](../lib/project-file-diff.ts)
- [Checkpoint engine](../lib/project-checkpoint-v2.ts)
- [V1 migration](../lib/project-v2-migration.ts)
- [Starter materializer](../lib/project-template-materializer.ts)
- [Runtime adapter contract](../lib/project-runtime-adapter.ts)
- [Vercel Sandbox adapter](../lib/vercel-sandbox-runtime-adapter.ts)
- [Builder orchestrator](../lib/builder-agent/orchestrator.ts)
- [Builder tool definitions](../lib/builder-agent/tools.ts)
- [Vercel Agent Browser checker](../lib/vercel-agent-browser-checker.ts)
- [Project snapshot storage](../db/project-v2-snapshots.ts)
- [Private release-receipt storage](../db/project-v2-release-receipts.ts)
