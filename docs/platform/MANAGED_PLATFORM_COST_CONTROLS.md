# Managed Platform Cost Controls

- Keep browser-local demo persistence available when cloud storage is absent.
- Scope quotas by organization, project and environment.
- Bound rows, query complexity, object bytes, jobs, realtime subscriptions and events.
- Use Sandbox idle shutdown, command timeouts and at most three repair rounds.
- Separate development, preview and production to avoid accidental production load.
- Require approval for external delivery, deployment and destructive database work.
- Prefer user BYOK model spend; never persist provider keys.

Reference defaults are 10,000 rows/environment, 12 query-complexity units, 10 MiB/object, 2,000 realtime events, 100 subscriptions and 1,000 jobs/environment. Provider pricing and limits must be reviewed before enabling a durable adapter.
