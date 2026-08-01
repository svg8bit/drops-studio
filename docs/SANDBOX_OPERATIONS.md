# Vercel Sandbox operations

This runbook covers the implemented
[`VercelSandboxRuntimeAdapter`](../lib/vercel-sandbox-runtime-adapter.ts). The
adapter uses the stable `@vercel/sandbox` package pinned to `2.9.0`; generated
code is never executed by the Drops Studio host shell.

## Runtime contract

Each actor/project pair receives a deterministic named Sandbox:

```text
ds2-<hashed-actor>-<hashed-project>
```

Raw member, guest and project identities are not placed in the provider name.
`getOrCreate` resumes the persistent Sandbox when it exists. Project source is
written below a hashed, revision-specific directory under
`/vercel/sandbox/.drops-studio/projects`; the active revision is changed only
after staging, validation and rename complete.

The requested provider configuration is:

| Setting | Implemented value |
| --- | --- |
| Runtime | Node.js 24 |
| Persistence | named and persistent, with resume enabled |
| CPU | 2 vCPU |
| Memory | not explicitly requested by the SDK call; status uses provider memory or a 2,048 MB/vCPU display fallback, so 2 vCPU is shown as 4,096 MB when the provider omits memory |
| Exposed ports | 3000 and 8080 |
| Sandbox lifetime | 30 minutes by default; constructor input is clamped to 1–60 minutes |
| Initial network | deny all |
| Initial environment | empty |
| Provider snapshot policy | 24-hour expiration, keep last three and delete evicted snapshots |

The 4 GB figure is therefore status metadata inferred when necessary, not an
explicit provider allocation guarantee. Treat the provider-returned resource
record as authoritative.

## Authentication

In a Vercel deployment the Sandbox SDK resolves Vercel OIDC automatically. The
local-development OIDC name is:

```text
VERCEL_OIDC_TOKEN
```

The adapter also supports an explicit local credential set, but only when all
three names are present together:

```text
VERCEL_TOKEN
VERCEL_TEAM_ID
VERCEL_PROJECT_ID
```

Do not place any of these values in generated source, Project V2 environment
definitions, runtime command environment, ZIP files, checkpoints or logs. A
partial explicit credential set is rejected rather than silently mixed with
OIDC.

## Lifecycle

### Ensure or resume

`ensure(context)` derives the safe name, calls `getOrCreate` with `resume: true`,
verifies a persistent Node 24 Sandbox with at least 2 vCPU, reapplies the bounded
ports/lifetime/network policy, and returns a runtime handle. A new adapter
instance can retrieve an existing Sandbox by name.

The public server contract is `POST /api/builder/runtime` with action `ensure`
or `status`. It first authorizes the signed guest/member against the requested
Project V2 snapshot. `status`, `logs`, `stop` and `destroy` use `resume` and do
not create or synchronize a missing Sandbox just to answer an existing-runtime
operation.

### Synchronize files

`writeProject` validates all regular text files and writes a new revision into a
staging directory. It rejects traversal, malformed paths, symlinks, secret-like
content and oversized graphs. The staging directory is renamed into place and
an `active.json` marker is updated only after every file succeeds. A failed
write removes the staging directory and leaves the prior revision addressable.

The Project V2 model limits are 64 files, 512,000 bytes per file and 1,500,000
bytes total. The lower-level runtime guard also enforces an independent ceiling
of 256 files, 1,500,000 bytes per file and 8,000,000 bytes total. A normal
Project V2 project therefore reaches the stricter model limit first.

### Install dependencies

Dependency installation is a dedicated adapter method. It temporarily permits
only these default hosts plus separately validated registry/source hosts:

- `registry.npmjs.org`
- `*.npmjs.org`
- `github.com`
- `codeload.github.com`
- `raw.githubusercontent.com`

Local/private IP addresses and malformed hosts are rejected. The exact command
is an argv call, not a shell string:

```text
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
```

The environment also sets npm's ignore-scripts, audit, funding and update
notifier controls. The install timeout defaults to three minutes and is capped
at five minutes. Whether installation succeeds or fails, network access then
switches to the runtime allowlist supplied by trusted server context. With the
current default route that allowlist is empty, which restores deny-all.

Lifecycle install scripts are never enabled. A package that requires a native
postinstall step may fail and must be replaced or handled as a blocking build
error; do not weaken this boundary to make the package install.

### Run checks and tasks

Commands are launched directly through the Sandbox SDK with an argv array. The
runtime accepts declared npm tasks and a narrowly validated Node command form;
shell metacharacter expansion, arbitrary host shell execution, inline Node
evaluation/import flags, traversal paths and undeclared package installation are
blocked. User code has no inherited production environment.

Every command receives only a small fixed environment:

- CI mode;
- `NODE_ENV=production` for a production build, `NODE_ENV=test` for a test task,
  and `NODE_ENV=development` for typecheck, lint, custom tasks and preview;
- disabled Next.js telemetry;
- disabled npm audit, funding, lifecycle scripts and update notifier;
- the selected preview `PORT`, when applicable.

Normal commands default to 60 seconds. Install defaults to three minutes;
typecheck, lint, tests and build use five minutes. Runtime command input is
clamped to at most five minutes. A timeout or provider failure sends `SIGKILL`
to the command before returning a redacted error.

Each start/result/failure records an audit event containing a hashed actor,
project ID, request ID, command kind and bounded argv. It never records a
provider key or inherited environment.

### Start preview

`startPreview` launches the configured npm dev script detached, binds it to
`0.0.0.0`, and restricts the port to 3000 or 8080. Readiness is polled for 30
seconds by default and at most 60 seconds. The returned URL must be an HTTPS URL
from `sandbox.domain(port)`; otherwise the process is killed and preview startup
fails.

The preview command is allowed to run until near the Sandbox lifetime. Starting
a replacement preview through the same adapter instance first stops the prior
preview process. `stopProcess` sends `SIGTERM`.

The public runtime route returns the real preview result, including its command
ID and URL. The adapter also stores the bounded preview command ID and port in
Sandbox tags. A later route invocation uses `resume` and those tags to recover
the actual `sandbox.domain(port)` URL without creating or resynchronizing a
Sandbox merely to answer `status`. Callers should still retain command IDs for
targeted log reads, and Project V2 preview metadata remains useful for durable
history after the Sandbox itself expires or is destroyed.

`BuilderAgentSession.startPreview` saves ready preview metadata (Sandbox ID,
HTTPS URL, port, source revision and start time) through the authorized Project
V2 repository using compare-and-swap. The runtime `preview` action returns that
saved state. After a manual Dev/Preview task, the mounted Studio surface reloads
the remote snapshot before switching to Preview, so a route invocation is not
lost as client-only metadata.

### Browser verification

The release gate uses a separate `@agent-browser/sandbox` runtime, not the
generated application's process. It requires the server-side name:

```text
AGENT_BROWSER_SNAPSHOT_ID
```

The checker accepts only an HTTPS `*.vercel.run` preview, launches a 2 vCPU
browser Sandbox from that prebuilt snapshot for at most 55 seconds, supplies an
empty environment, restricts network access to the preview hostname, and stops
the browser Sandbox after the check. Missing snapshot configuration is a
blocking check, not a skipped or mocked result.

### Logs

Completed command stdout and stderr are bounded to 64,000 bytes in total and
include an `outputTruncated` flag. Streaming reads accept only a validated
command ID, read for at most two seconds, return at most 256 chunks, and bound
each chunk to 8,000 bytes. Secret-like output is replaced by a generic safe
message rather than emitted.

Commands run through `BuilderAgentSession` persist bounded Project V2 run
records and log metadata through the authorized optimistic repository. The
metadata records task/revision/status/timing/exit, log/audit IDs, stream, byte
count and truncation; it does not store the stdout/stderr text itself. Browser
verification adds the same bounded metadata to the associated preview run.

`POST /api/builder/runtime` action `logs` requires `commandId`; it returns only
provider command output. There is no fabricated terminal transcript.

### Checkpoint and restore

Project checkpoints are canonical source snapshots managed by Drops Studio.
The adapter captures the requested regular files and can atomically write the
snapshot into a revision directory. `restore` creates a new Project V2 revision,
resynchronizes the files and clears the cached preview. The route requires both
`checkpointId` and `confirm: true`.

This is distinct from the Sandbox provider's automatic snapshot-retention
setting. Project correctness and rollback use the validated Project V2
checkpoint; they do not rely on opaque VM state containing dependencies or
processes.

### Stop and destroy

- `stop` stops the persistent Sandbox and removes local preview/handle caches.
- `destroy` deletes the provider Sandbox and removes local caches.
- Runtime action `destroy` requires `confirm: true`; `stop` does not.

Stopping is the normal idle/cost-control action because the named Sandbox can be
resumed. Destroying is for an intentionally abandoned project and is not
recoverable from the Sandbox itself. The Project V2 source and checkpoints may
still exist in private storage.

The mounted V2 Preview surface exposes the real runtime state, active duration,
expiry and a working Stop action. `DELETE /api/projects/v2` now resumes and
destroys the deterministic actor/project Sandbox before removing the private
snapshot. If provider cleanup fails, deletion returns 503 and retains the source
for a safe retry. A successful response reports whether a provider Sandbox was
actually found and destroyed.

## Idle cleanup

`cleanupIdle({ idleBefore, limit })` lists only names with the `ds2-` prefix and
stops records whose provider `updatedAt` predates the cutoff. One invocation
inspects 25 records by default and at most 100, returning separate stopped and
failed name lists.

`GET` or `POST /api/builder/cleanup` is the bounded scheduled-caller contract.
It requires `Authorization: Bearer <CRON_SECRET>` and fails closed when the
secret is absent; in production the secret must be at least 32 characters. The
idle cutoff uses:

```text
DROPS_STUDIO_SANDBOX_IDLE_MINUTES
```

The cutoff defaults to 20 minutes, accepts only an integer from 5 through 240,
and otherwise falls back to 20. The route processes at most 100 records and has
a 300-second function duration. It returns counts/names from the bounded adapter
result and a completion timestamp; it does not destroy Project V2 source.

[`vercel.json`](../vercel.json) schedules this route every 15 minutes with
`*/15 * * * *`. Vercel must have the same server-only `CRON_SECRET` configured;
without it the scheduled request fails closed with 503 and automatic cleanup is
not operational. Other runtime limits are code-level validated constants rather
than operator-supplied environment overrides. The scheduled operation should:

1. choose an idle cutoff shorter than the provider lifetime;
2. call cleanup in bounded batches;
3. record inspected, stopped and failed counts without raw user identity;
4. retry failures with backoff;
5. never delete project source because a Sandbox was idle.

## Operator checklist

Before enabling the runtime:

1. Confirm the deployed app has working Vercel OIDC or the complete explicit
   local credential set.
2. Confirm private Project V2 storage and durable rate limiting are configured.
3. Verify `@vercel/sandbox` remains the pinned stable version expected by the
   adapter.
4. Run the mocked adapter contract tests.
5. Run `npm run test:live:sandbox` only in an isolated account/project. This
   external matrix creates a real, billable Sandbox and requires working Vercel
   runtime credentials. It is intentionally not discovered by `test:unit`.
6. Confirm `AGENT_BROWSER_SNAPSHOT_ID` names a maintained prebuilt
   `@agent-browser/sandbox` snapshot. Run
   `npm run test:live:builder` for the full external
   install/check/build/preview/browser/checkpoint proof only in an isolated
   account/project. `npm run test:live` runs both credentialed proofs.
7. Verify the returned runtime status says Node 24, persistent and at least
   2 vCPU.
8. Install a starter, run its declared checks/build, start preview, read real
   logs, stop the process and stop the Sandbox.
9. Exercise checkpoint restore and confirm the file hashes match.
10. Configure a production-strength `CRON_SECRET`, choose the optional idle
   cutoff, verify the declared Vercel Cron is active and observe the bounded
   cleanup result.

## Troubleshooting

### Sandbox provisioning failed

- Check that OIDC is available in the deployed Vercel function.
- For local explicit auth, check that all three credential names are configured;
  never print their values.
- Confirm the Vercel project/account has Sandbox access and supports Node 24.
- Inspect the structured server audit event and provider error code, not the
  user's generated source or credentials.

### Dependency installation failed

- Read the bounded stderr using the returned command ID.
- Check that dependencies use public exact versions accepted by Project V2.
- Check whether the package requires a blocked lifecycle script.
- Add only a narrowly required public registry/source host through trusted
  adapter configuration; never accept an arbitrary host from generated code.
- Keep the failure blocking if it cannot be resolved inside five minutes.

### Preview did not become ready

- Confirm `package.json` contains the selected dev script.
- Confirm it binds to the injected host/port and supports 3000 or 8080.
- Read the preview command's stderr.
- Confirm build/runtime requests do not require a host unavailable under the
  post-install deny/allowlist policy.
- Stop the failed process before retrying.

### Logs appear truncated

This is expected after 64 KB of combined command output, 256 streaming chunks
or 8 KB in one chunk. Use targeted checks and smaller diagnostic output. Do not
raise limits to expose unbounded application logs.

### A stale preview survives

Stop it by the command ID returned by preview/status, or stop the named Sandbox.
If provider tags are missing or stale, stop the Sandbox and resume it for a
clean session. Destroy only after confirming the canonical Project V2 snapshot
and checkpoint rollback path.

## Rollback procedure

1. Stop the preview process or the Sandbox.
2. Select the last known-good Project V2 checkpoint.
3. Call runtime `restore` with explicit confirmation.
4. Reinstall dependencies under the restricted install network phase.
5. Rerun typecheck, lint, tests and production build.
6. Start a new preview and run the real browser check.
7. Keep the prior external deployment untouched until the restored preview is
   confirmed.

Rollback restores source, not provider credentials, production environment,
dependency cache or active processes.
