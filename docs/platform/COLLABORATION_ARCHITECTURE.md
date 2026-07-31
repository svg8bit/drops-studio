# Collaboration Architecture

`lib/enterprise-platform/collaboration.ts` provides deterministic concurrent text operations, authenticated bounded presence, comments, replies and resolve/reopen permissions. `AiBranchManager` isolates AI task branches, detects stale canonical revisions, returns explicit conflicts and creates checkpoints on successful merge.

The two-actor tests prove convergence without lost edits, viewer mutation denial, presence expiry and stale AI work not overwriting canonical files.

The production transport is exposed at `/api/collaboration/transport`. Normal reads and writes require a signed Studio member, team workspace membership and shared-project scope. Owners and editors may append; viewers are read-only. Writes are same-origin, rate-limited, secret-scanned, payload-bounded, CAS revisioned and idempotent.

The durable room log uses the existing project-data backend, so the active provider is Neon Postgres or private Vercel Blob. The operator-only `?health=1` probe proves two-actor ordering, replay idempotency, durable read and isolated cleanup before the capability becomes `working`; configuration markers alone never activate it. The HTTP transport is intentionally bounded rather than presented as a permanent WebSocket process.
