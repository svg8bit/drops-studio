# Project V2 cost controls

Builder V2 bounds model calls, Sandbox lifetime, commands, network access,
storage and external provider requests. These are safety/capacity controls, not
pricing promises. Provider billing and quotas remain authoritative.

## Current state

The controls below are implemented in the server/runtime modules. Project Studio
mounts the native V2 workspace with Files, Preview, Integrations, Data, Logic,
Test, Logs, History and Deploy. The Preview surface displays the real Sandbox
state, active duration/expiry and Stop control. Deploy uses the bounded Vercel
route and exposes GitHub readiness, repository inspect/import and approved PR
creation. GitHub/Vercel credentials remain server-only or browser-session-only.
The Data view shows the starter's real `project-data: setup-required` manifest
state; it does not claim durable records.

For a native Next.js project without a ready preview, a newly mounted surface
automatically starts at most one build and records the project ID/revision in a
`sessionStorage` marker to suppress a duplicate remount build. Later source
edits deliberately require the user or Director to request the rebuild. This
client de-duplication improves UX but is not an entitlement or security
boundary; the authoritative route limits below still apply.

The existing access-tier flow still applies its own platform-funded daily
allowances (guest 3, member 10, Pro 100) to the legacy planning path and keeps
BYOK outside that funded quota. Those tier counters are not currently wired into
the new `/api/builder/agent` and `/api/builder/runtime` route limits below.

## Request-rate controls

Production request limits use private Blob state and optimistic updates. When
durable rate-limit storage or a trusted request identity is unavailable, the
new builder/integration routes fail closed. Explicit local proof mode uses
process-memory counters with higher test limits.

| Route/action | Normal limit | Window | Notes |
| --- | ---: | ---: | --- |
| `POST /api/builder/agent` session | 20 | 24 h | Applied together with the minute limit |
| `POST /api/builder/agent` burst | 4 | 1 min | Applied together with the daily limit |
| `POST /api/builder/runtime` | 120 | 1 h | Every runtime action, including status/logs |
| `GET /api/projects/v2` | 600 | 1 h | Separate read namespace |
| `PUT`/`DELETE /api/projects/v2` | 600 | 1 h | Shared write namespace |
| `POST /api/integrations/github` | 20 | 1 h | Inspect/import/publish all consume a request |
| `POST /api/deployments/vercel` | 12 | 24 h | Status/logs/cancel/deploy/redeploy all consume a request |
| `GET /api/project-data` | 600 | 1 h | Per capability subject/project/nonce |
| `POST`/`PUT`/`DELETE /api/project-data` | 240 | 1 h | Per capability subject/project/nonce |
| Drops Bot callback ingestion | 120 | 1 min | Keyed by connection plus request identity |
| Current `/api/generate` build route | 60 | 1 h | Existing user-facing generation path |
| Legacy `/api/workspace/run` | 12 | 1 h | Existing isolated workspace path |

`GET`/`POST /api/builder/cleanup` is not a user quota endpoint. It is protected
by `CRON_SECRET`, processes a maximum of 100 named Sandboxes per invocation and
uses the configured/default idle cutoff described below.

In `DROPS_STUDIO_LOCAL_PROJECT_STORE` proof mode outside Vercel, builder limits
are raised to at least 1,000 per window, Project V2 sync to 5,000, GitHub to 100
and Vercel deployment to 100. These values are for local automated proofs, not a
production entitlement.

The `/api/project-data` route has data/body quotas and the per-capability request
limits above. It still remains unavailable in production until hosting wires a
durable backend and trusted capability issuance; rate limiting alone is not a
persistence or authorization bootstrap.

## AI-agent bounds

| Control | Limit |
| --- | ---: |
| Prompt | 20,000 characters |
| Tool-loop steps per agent call | 24 |
| Model output | 12,000 tokens |
| Agent call timeout | 4 minutes |
| Automatic repairs | 3 after the initial attempt |
| Retries inside the AI SDK agent | 0 |
| Per-tool returned output | 32,000 bytes |

The orchestrator stops after one initial attempt and at most three repair
attempts. A failed release gate remains blocking. It does not continue spending
until a model happens to produce a passing result.

Free deterministic generation remains available through the current product
path. The new agent route also wires a deterministic `build` fallback: it keeps
the already materialized V2 starter and runs the same real Sandbox release gate
without consuming a model. Free `edit` and `repair` are rejected because those
operations require a connected model provider. Sandbox and browser verification
still consume provider compute and require their external configuration.

BYOK OpenAI, Anthropic, OpenRouter, Kimi and custom-provider calls use the
visitor's provider account for that explicit request. Drops Studio adds no
separate model billing flow. Vercel AI Gateway uses the server's configured
Gateway/OIDC capacity and provider limits.

## Sandbox resource bounds

| Control | Implemented value |
| --- | --- |
| Runtime | persistent named Node.js 24 Sandbox |
| CPU | 2 vCPU |
| Memory status | provider value, or 4,096 MB inferred for display from 2 vCPU; not an explicit allocation request |
| Ports | 3000 and 8080 only |
| Sandbox lifetime | default 30 min; minimum 1 min; maximum 60 min |
| Normal command timeout | 60 s |
| Install timeout | default 3 min, maximum 5 min |
| Typecheck/lint/test/build timeout | 5 min |
| Preview readiness | default 30 s, maximum 60 s |
| Provider snapshots | last 3, 24-hour expiration |
| Command output | 64,000 bytes combined |
| Streaming logs | 256 chunks maximum, 8,000 bytes/chunk, 2 s read window |

The Sandbox starts with no production environment and deny-all networking.
Install temporarily permits only the npm registry and enumerated source hosts,
with lifecycle scripts disabled, then switches to the runtime allowlist (empty
by default). This prevents a failed or malicious generated project from becoming
an unrestricted network/compute workload.

Runtime status exposes state, vCPU, reported/inferred memory, creation/update/
expiry timestamps, active duration and known preview metadata. The mounted
Preview surface shows these values and enables Stop while the Sandbox is
running.

The release browser check creates a separate, stop-on-completion 2 vCPU Agent
Browser Sandbox for at most 55 seconds. It reuses the prebuilt snapshot named by
`AGENT_BROWSER_SNAPSHOT_ID`, disables bootstrap and allows network access only
to the selected `*.vercel.run` preview hostname. A missing snapshot blocks the
check before browser compute is started.

### Idle and abandoned Sandbox control

The adapter implements bounded idle cleanup: it scans only `ds2-` names, 25 by
default and at most 100, and stops records older than a trusted cutoff. There is
a protected HTTP route that uses `CRON_SECRET`, a fixed batch limit of 100 and
`DROPS_STUDIO_SANDBOX_IDLE_MINUTES` for a 5–240 minute cutoff (20 minutes by
default). `vercel.json` invokes it every 15 minutes. Project V2 deletion also
resumes and destroys its deterministic Sandbox before removing source, and fails
closed if provider cleanup fails. Other runtime resource, command and output
limits are validated code constants rather than environment overrides. The Cron
route fails closed until the deployed environment has a production-strength
`CRON_SECRET`.

Recommended production policy:

- stop, do not destroy, after a conservative idle window shorter than the
  provider lifetime;
- destroy only after explicit project deletion and source/checkpoint retention
  verification;
- run cleanup in bounded batches and alert on failures;
- preserve a provider/audit trail without raw member identity;
- cap concurrent builds at the hosting layer if real usage exceeds the current
  request-counter protection.

## Source, storage and history bounds

### Project V2

| Item | Limit |
| --- | ---: |
| Files | 64 |
| Per file | 512,000 bytes |
| Total source | 1,500,000 bytes |
| Atomic operations/revision | 64 |
| Tasks | 32 |
| Runs metadata | 256 |
| Log metadata records | 2,048 |
| Checkpoints | 50 |
| Private snapshot envelope | 8,000,000 bytes |

Checkpoints contain a full canonical source snapshot, so the 8 MB private
envelope is an effective combined history ceiling. A write that exceeds it
returns 413 and preserves the prior durable revision. Each task, check and
preview command executed through `BuilderAgentSession` appends a bounded Project
V2 run plus stdout/stderr/browser log metadata through optimistic persistence;
only IDs, status/timing/exit, byte counts and truncation are retained. Runtime
stdout/stderr text is not embedded in the canonical checkpoint.

The V2 snapshot route stores one private Blob per actor/project but does not
currently enforce a maximum number of V2 project IDs per actor. Rate limits and
the Blob provider quota are not a substitute for an explicit record-count
entitlement; add one before exposing material untrusted storage capacity.

The browser project store retains at most 50 current product records. Its
`localStorage` fallback is device/browser-local and should not be presented as
cloud backup.

### Project Data

| Item | Default limit |
| --- | ---: |
| Namespaces/project | 16 |
| Documents/namespace | 500 |
| Document | 64 KiB |
| Complete project data snapshot | 2 MiB |
| JSON depth | 20 |
| JSON nodes/document | 4,096 |
| Capability lifetime | 24 h maximum |
| Request body | 72 KiB |

The local server backend is process-memory only. The optional browser backend
uses Web Storage. Neither is a paid external dependency or a durable production
database, so every materialized starter advertises Project Data as
`setup-required` rather than connected.

### Drops Bot callback inbox

- callback body: 64 KiB;
- connection-management body: 4 KiB;
- callback burst: 120/minute;
- events: at most 1,000 per connection;
- private Blob fallback state: at most 500 connections and 4 MiB total;
- exact payload replays: de-duplicated by SHA-256 content hash.

The documented provider allowance is informational provider context only; Drops
Studio does not invent additional remote wallet/webhook capacity.

## DropsTab request budget

The server proxy uses a 15-minute shared cache and in-flight de-duplication. One
cache fill performs one required coins request and up to three independent
enrichment requests for unlocks, funding and activities. Each operation is
bounded by a 30-second overall request budget and at most three attempts with
bounded backoff. Generated apps do not automatically poll the provider.

Without a platform key/provider result, the route switches to a clearly labelled
public price fallback and marks DropsTab-native capabilities false. This avoids
spending provider quota while preserving an honest demo state.

## GitHub and deployment bounds

| Integration | Limit |
| --- | ---: |
| GitHub request body | 3.3 MB |
| GitHub imported/published files | 140 |
| GitHub file content total | 3,000,000 bytes |
| Vercel deployment request body | 3.9 MB |
| Vercel uploaded files | 160 |
| Vercel source total | 3,500,000 bytes |
| Vercel wait | 150 s default, 240 s maximum |
| Vercel poll interval | 2 s default |
| Vercel log events | 100 provider events |
| Vercel log output | 96,000 bytes total, 8,000 characters/event |

GitHub creates a reviewable branch/commit/PR and never force-updates a ref.
Vercel creates only preview deployments. No automatic PR merge, production alias
promotion or production rollback can incur an unreviewed external change.
The V2 Deploy view can initiate a new approved preview and show provider evidence;
checkpoint redeployment/rollback and cancellation are still server-only actions.
The public GitHub publish and Vercel deployment routes load canonical actor-owned
Project V2 files rather than trusting a client source graph. Their effective
source ceiling is therefore normally the stricter 64 files/1,500,000 bytes,
while the larger values above remain defense-in-depth library limits and import
limits.

## Storage and rate-limit prerequisites

Private Blob project snapshots and durable request counters use either
`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` plus `VERCEL_OIDC_TOKEN`. If these
are absent in production, protected routes return unavailable rather than using
unbounded process memory.

Local proof toggles are:

```text
DROPS_STUDIO_LOCAL_PROJECT_STORE
DROPS_STUDIO_LOCAL_PROJECT_DATA
```

They are development/test controls, must not be enabled as production
persistence, and do not survive process replacement.

Scheduled idle cleanup additionally requires the server-only name
`CRON_SECRET`; `DROPS_STUDIO_SANDBOX_IDLE_MINUTES` is its optional bounded
cutoff. Neither value is forwarded to generated code or a Sandbox process.

## Monitoring

At minimum, aggregate these secret-free signals:

- agent sessions by provider mode, attempt count and final status;
- release-gate check duration/failure by check name;
- Sandbox create/resume/stop/destroy, active duration and cleanup failures;
- command timeout, exit status and output-truncation count;
- dependency-install and preview-readiness failures;
- HTTP 429/503 by route and rate-limit namespace;
- Project V2 snapshot conflicts and 8 MB capacity failures;
- DropsTab cache fills/retries/rate-limit evidence/fallback mode;
- Drops Bot accepted/duplicate/capacity events;
- GitHub provider operations and confirmed PR evidence;
- Vercel deployment terminal states, wait time and bounded log volume.

Do not attach prompts, full source, provider tokens, raw actor identity, callback
capabilities or Telegram credentials to telemetry.

## Capacity incident response

1. Stop new external mutations and return a truthful limited/unavailable state.
2. Stop idle Sandboxes in bounded batches; do not destroy canonical project
   source.
3. Inspect aggregate duration, command and storage evidence without secrets.
4. Fix the narrow bottleneck or raise a documented product limit only after
   provider cost review.
5. Re-run one known-good project through install, checks, build, preview and
   browser verification.
6. Re-enable traffic gradually and retain the prior limits as rollback values.

Never weaken lifecycle-script, network, secret, output or approval controls to
work around a cost/capacity incident.
