# Runtime skill: project-inspection

- `id`: `project-inspection`
- `version`: `3.0.0`
- `description`: Inspect the current Project V2 before planning or mutation.
- `activation_signals`: inspect, existing project, current files, build, edit, repair.
- `required_capabilities`: none.
- `allowed_roles`: Planner, Coder, Quick Edit, AutoFix, Design Agent, QA, Security.
- `allowed_tools`: file read and search tools only.
- `required_context_queries`: project manifest, target symbols, current revision.
- `instructions`: read the smallest relevant current file set and bind observations to its revision.
- `acceptance_checks`: target paths and revision recorded; unrelated source omitted.
- `forbidden_claims`: never claim a file was inspected without read evidence.
