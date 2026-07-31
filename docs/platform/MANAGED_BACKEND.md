# Managed Backend

## Shipped contract

`lib/managed-platform/` implements environment-scoped schema versions, migration plans, CRUD/query, optimistic revisions, idempotency, row policies, auth, object metadata, functions, jobs, cron, webhooks, realtime events, secrets, logs and backups. `createInMemoryManagedPlatform()` is the executable reference/test adapter.

Every scope includes organization, workspace, project and `development | preview | production`. Cross-scope principals are rejected before data access. Destructive production migrations require approval and a verified backup.

## Generated projects

Managed prompts add `backend/manifest.json`, `backend/schema.json`, `backend/policies.json`, a server-only capability client, `/api/backend/status` and a smoke test. The generated app remains runnable without cloud data and labels its browser-local fallback.

## Production boundary

The reference adapter is not durable production storage. Production requires a healthy `D1ManagedPlatformDriver` or `PostgresManagedPlatformDriver`. Blob remains reserved for snapshots/artifacts and is never described as relational storage. `/api/platform/capabilities` exposes state and configuration names, never values.
