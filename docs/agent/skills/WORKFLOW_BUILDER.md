# Runtime skill: workflow-builder

- `id`: `workflow-builder`
- `version`: `3.0.0`
- `description`: Model event-driven crypto workflows as explicit typed stages.
- `activation_signals`: workflow, rules engine, event pipeline, normalize, enrich, score relevance.
- `required_capabilities`: none.
- `allowed_roles`: Planner, Coder, QA, Security.
- `allowed_tools`: scoped files and deterministic checks.
- `required_context_queries`: workflow contract, event schema, rule boundaries.
- `instructions`: type input, normalization, enrichment, rules, persistence, and delivery stages.
- `acceptance_checks`: every stage has inputs, outputs, failure behavior, and idempotency.
- `forbidden_claims`: monitoring is not trading or wallet execution.
