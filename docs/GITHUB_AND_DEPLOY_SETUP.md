# GitHub and Vercel preview setup

Drops Studio has bounded server integrations for GitHub and Vercel. Both are
implemented against the providers' official REST APIs. They are disabled
honestly when credentials are absent, require explicit approval for mutations,
and require confirmed provider evidence. GitHub inspect/import/publish and
Vercel preview deployment are connected to the V2 Deploy surface. Production
alias promotion is not.

## Credential principles

- Prefer a GitHub App over a user token.
- A user-connected GitHub or Vercel token is supplied only in the explicit
  request header for that operation.
- Session tokens are never written to Project V2, generated source, Vercel
  Sandbox, logs, Blob snapshots, checkpoints or ZIP exports.
- Platform credentials belong only in the deployment's encrypted environment.
- Readiness is not success. GitHub success requires confirmed provider objects;
  Vercel success requires a `READY` deployment with a URL.
- GitHub push/PR, deployment creation/cancellation and checkpoint redeployment
  require explicit user approval.
- Vercel deployment also requires a private server-issued Sandbox release
  receipt; editable Project V2 evidence cannot authorize deployment by itself.

## GitHub integration

### GitHub App configuration

The preferred server configuration uses these environment-variable names:

```text
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_APP_INSTALLATION_ID
GITHUB_APP_ALLOWED_REPOSITORIES
```

Configure the App with the least repository permissions represented by the
implementation:

- Contents: read and write;
- Pull requests: read and write;
- Metadata: read.

Install the App only on repositories the operator intends Drops Studio to
access. Set `GITHUB_APP_ALLOWED_REPOSITORIES` to an exact comma-separated
`owner/repository` allowlist. `GITHUB_APP_PRIVATE_KEY` must remain in the
server environment. The integration creates a short-lived installation token
scoped to the selected allowed repository server-side; it does not send the
private key to the browser or generated app.

The current server configuration selects one fixed installation ID. Requests
cannot override that installation. Platform App access additionally requires a
signed Studio member session and an exact repository allowlist match. The route
does not contain a GitHub App installation-selection UI or OAuth callback flow.

### Session-token mode

When the complete GitHub App configuration is absent, readiness reports
`session-token-required`. An explicit request can pass a connected token in:

```text
x-github-access-token
```

The token is validated as bounded non-whitespace credential material and used
only for that provider request. The Studio UI accepts it into
`drops-studio:github-access-token` in browser `sessionStorage`, can disconnect it,
and forwards it only as the request header above. No personal token environment
variable is read by this module, and no token is copied into project state.

### GitHub route contract

`GET /api/integrations/github` returns provider readiness, credential mode,
supported session-token behavior, required permissions and the list of external
actions that require approval.

`POST /api/integrations/github` requires same-origin `application/json`. It is
limited to 20 requests per actor per hour in the normal server configuration and
fails closed when durable rate limiting is unavailable.

Supported actions:

| Action | Required input | External effect | Approval |
| --- | --- | --- | --- |
| `inspect` | `owner`, `repo` | Read repository metadata | no |
| `import` | `owner`, `repo`, optional `branch` | Read a repository tree and text blobs | `approved: true` |
| `publish` | `owner`, `repo`, actor-owned `studioProjectId`, conversation/description and optional base branch | Create/update conversation branch, commit and non-draft PR from the stored Project V2 snapshot | `approved: true` |

The request body is capped at 3.3 MB. Import accepts 1–140 regular text files
totaling at most 3,000,000 UTF-8 bytes. Publish does not trust client-supplied
source: the route resolves the signed Studio actor and loads the canonical
`studioProjectId` snapshot, whose stricter Project V2 limits apply. Paths are
normalized and checked for traversal/protected locations; binary/NUL files and
credential-like source are rejected.

`import` returns repository metadata and files. It does **not** automatically
create or overwrite a Project V2 record. The caller must validate/materialize
the returned files and obtain the current optimistic revision before saving.

`publish` creates the branch:

```text
drops-studio/<safe-conversation-id>
```

It creates Git blobs, a tree and commit, updates the ref with `force: false`, and
opens a non-draft pull request. The result is considered confirmed only after
GitHub returns a branch, commit SHA and pull-request number/URL. This code does
not merge or close the PR, delete a branch, change repository settings or deploy
the repository.

### GitHub rollback and recovery

GitHub history is the rollback record. If an approved publish was wrong:

1. Do not merge the PR.
2. Inspect the returned branch and commit in GitHub.
3. Correct the Project V2 source or restore a Studio checkpoint.
4. Publish a reviewed follow-up commit/PR through an explicitly approved flow.

The integration uses non-force ref updates and has no destructive rollback
endpoint. If a branch already exists, branch creation may return a GitHub 422;
the implementation then attempts a non-force update. An incompatible existing
branch or duplicate PR remains a provider error that requires operator review.

## Vercel preview deployment

### Configuration

A platform-managed deployment credential uses both:

```text
VERCEL_DEPLOY_TOKEN
VERCEL_GENERATED_PROJECT_ID
```

`VERCEL_TEAM_ID` selects the server-owned team when that generated-app project
is team scoped. This is the same name used in the complete local Sandbox
credential trio; configure it once for the intended Drops Studio Vercel scope.

An explicit request may instead provide a team/project identifier and a
session-only access token in:

```text
x-vercel-access-token
```

The server token is used only for signed Studio members and is always restricted
to the server-owned generated-app project; request-supplied team/project values
cannot redirect it. Guests must connect their own session-only token. Otherwise
readiness reports `session-required`.
This deployment token is distinct from Vercel Sandbox OIDC configuration; see
[Sandbox operations](SANDBOX_OPERATIONS.md).

For the connected V2 Deploy action, trusted browser setup may place that
request-only token under `drops-studio:vercel-access-token` in
`sessionStorage`; the surface reads it only while constructing the approved
request header. The repository does not currently provide a Vercel OAuth/token-
acquisition screen, so the platform token is the complete built-in setup path
unless another trusted connection surface supplies the session value.

Grant the token access only to the intended team and generated-app project. The
current API performs direct source upload and does not need a GitHub token.

### Vercel route contract

`GET /api/deployments/vercel` returns readiness, credential source, session-token
support, the explicit-approval requirement and `disabled-until-provider-confirms`
claim semantics.

`POST /api/deployments/vercel` requires a signed Studio actor, an actor-owned
`studioProjectId`, same-origin `application/json` and bounded input. It is
limited to 12 requests per actor per 24 hours in the normal server configuration
and fails closed when durable rate limiting is unavailable.

| Action | Required input | Approval |
| --- | --- | --- |
| `status` | `studioProjectId`, owned current `deploymentId`, session-only Vercel token | no |
| `logs` | `studioProjectId`, owned current `deploymentId`, session-only Vercel token | no |
| `cancel` | `studioProjectId`, owned current `deploymentId`, session-only Vercel token | `approved: true` |
| `deploy` | `studioProjectId`; optional target IDs only with the visitor's session token | `approved: true`, a complete current release gate and its exact private release receipt |
| `rollback` | `studioProjectId`, owned `checkpointId`; optional target IDs only with the visitor's session token | `approved: true` and the selected checkpoint's exact private release receipt |

The request body is capped at 3.9 MB. The deployment library can upload 1–160
regular text files totaling at most 3,500,000 UTF-8 bytes, but the public route
does not accept a client file graph. It loads current files or an owned
checkpoint from the canonical Project V2 snapshot, so the stricter 64-file and
1,500,000-byte Project V2 limits normally apply. Unsafe paths, binary/NUL files
and secret-like source are rejected before contacting Vercel.

Deployment creation calls the official Vercel deployments API with:

- framework `nextjs`;
- install command `npm install --ignore-scripts`;
- build command `npm run build`;
- source metadata identifying Drops Studio V2 and, when provided, the sanitized
  Project V2 revision hash.

Only a preview deployment is created. This module never assigns, promotes or
changes a production domain/alias.

By default, the route polls every two seconds for up to 150 seconds. Library
limits permit a 1–240 second wait and a 0.1–10 second poll interval. It returns
`confirmedReady: true` only when the provider state is `READY` and a deployment
URL exists. `ERROR` returns a blocking response with bounded logs; a nonterminal
timeout returns a timeout error rather than claiming deployment.

Provider logs are read from the deployment events endpoint, capped at 100
events, 8,000 characters per event and 96,000 bytes total. Values are returned
as provider evidence, not a simulated terminal.

### Project Studio wiring

The V2 Deploy view asks for explicit confirmation and submits only the current
`studioProjectId` with `approved: true`; the server loads the actor-owned
validated file graph. The route rejects deployment unless the current revision
has a matching verified build checkpoint, successful declared checks, ready
Sandbox preview and browser evidence **and** the exact private release receipt
minted by the successful builder route. The receipt binds actor, project,
revision, content hash, checkpoint ID and snapshot hash; it is stored separately
from Project V2 and never accepted from the browser. The surface waits for the
provider result, renders real status/URL/bounded logs, sets `ready` only from
`confirmedReady: true`, then saves current deployment metadata through the
Project V2 optimistic repository.

The canonical project contains the current deployment state. The surface also
shows up to 20 deployment receipts accumulated during the current mounted
Studio session; that list is not a durable provider-history store. The server
route supports checkpoint redeployment, cancellation, status and log actions,
but the current V2 surface does not expose rollback/redeployment or cancellation
controls.

### Rollback semantics

The route's `rollback` action is a **checkpoint redeployment**. The caller
supplies an owned `studioProjectId` and `checkpointId`; the server loads the
complete checkpoint files from the canonical actor-owned snapshot. It then
requires the exact private release receipt for that checkpoint before creating
another preview deployment labelled `checkpoint-redeployment`. A manual or
forged checkpoint without that receipt is not deployable.

It does not roll a production alias back to an older Vercel deployment. A future
production promotion/rollback implementation must have its own explicit
approval, release gate, target verification and audit record.

Recommended recovery:

1. Select a known-good Project V2 checkpoint that has an exact private release
   receipt and call `rollback` with its `checkpointId` and explicit approval.
2. If no receipt exists, restore the checkpoint in Studio, run the complete
   Sandbox release gate again to create a new verified checkpoint/receipt, then
   use normal `deploy` for that current revision.
3. Wait for Vercel `READY` and verify the returned preview URL.
4. Leave all production aliases unchanged.

## Disabled/setup-required states

| Missing prerequisite | Honest behavior |
| --- | --- |
| GitHub App variables and no request token | GitHub operations fail with configuration/session-token required |
| GitHub App not installed on the repository | Provider authorization/not-found failure; no success state |
| Vercel deployment token and no request token | Deployment operations require a session connection |
| Vercel team/project permission missing | Provider error; no deployment claim |
| Durable rate-limit storage missing in production | Mutating integration route returns 503 |
| Explicit approval missing | Route returns HTTP 409 approval required |
| GitHub App/OAuth setup absent | Studio offers a tab-scoped session-token field; without an App or connected token, inspect/import/publish remain disabled |
| Vercel session-token acquisition missing | The Deploy view can consume a request-only session value but cannot create one; configure the platform token or supply a trusted connection flow |
| Vercel rollback/cancel UI missing | The server actions remain available to trusted approved callers; the current Deploy view exposes only new preview deployment |
| Matching private release receipt missing/unavailable | Deployment fails closed; rebuild after private storage recovers |
| Vercel deployment not `READY` | `confirmedReady` remains false; status/logs expose the real provider state |

## Verification checklist

Before declaring the connected GitHub/Vercel path release-ready:

1. Call each readiness endpoint and display the returned mode without inventing
   a connected state.
2. Exercise provider failures with mocked API responses and verify redacted,
   bounded errors.
3. Import a small private test repository and validate the result before saving
   Project V2.
4. Publish to a disposable repository only after approval; confirm branch,
   commit and PR on GitHub.
5. Deploy a known-good starter only after the Sandbox release gate; wait for
   `READY` and load the returned preview URL.
6. Verify deployment rejects forged/stale Project V2 evidence and requires the
   exact private receipt for both current source and checkpoint redeployment.
7. Verify logs, cancel behavior and checkpoint redeployment.
8. Confirm no credential or release receipt appears in source, logs, Project V2,
   browser responses, private project snapshots,
   checkpoints or the ZIP.

## Implementation references

- [GitHub integration](../lib/github-integration.ts)
- [GitHub API route](../app/api/integrations/github/route.ts)
- [Vercel deployment integration](../lib/vercel-deployment.ts)
- [Vercel deployment API route](../app/api/deployments/vercel/route.ts)
- [Private Project V2 release receipts](../db/project-v2-release-receipts.ts)
- [Project V2 security model](V2_SECURITY_MODEL.md)
