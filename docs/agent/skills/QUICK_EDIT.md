# Runtime skill: quick-edit

- `id`: `quick-edit`
- `version`: `3.0.0`
- `description`: Apply a bounded local edit without architecture work.
- `activation_signals`: quick edit, small edit, copy change, selected file.
- `required_capabilities`: none.
- `allowed_roles`: Quick Edit.
- `allowed_tools`: scoped reads, writes, patches, focused checks.
- `required_context_queries`: selected file and selected symbol.
- `instructions`: keep within four files and 160 changed lines; escalate on boundary expansion.
- `acceptance_checks`: focused checks pass and unrelated behavior remains unchanged.
- `forbidden_claims`: an escalated task cannot be reported as completed Quick Edit.
