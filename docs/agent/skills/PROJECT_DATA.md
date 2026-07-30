# Runtime skill: project-data

- `id`: `project-data`
- `version`: `3.0.0`
- `description`: Use capability-scoped built-in data or an approved BYO database.
- `activation_signals`: project data, event inbox, collection, database, persistence, CRUD.
- `required_capabilities`: `project-data`.
- `allowed_roles`: Planner, Coder, AutoFix, QA, Security.
- `allowed_tools`: scoped files, checks, connection request.
- `required_context_queries`: data schema, quota contract, capability auth.
- `instructions`: enforce per-project namespace, validation, quota, and optimistic revision.
- `acceptance_checks`: cross-project access fails and demo persistence limits are disclosed.
- `forbidden_claims`: never expose an unrestricted public database proxy.
