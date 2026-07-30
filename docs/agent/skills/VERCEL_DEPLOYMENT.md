# Runtime skill: vercel-deployment

- `id`: `vercel-deployment`
- `version`: `3.0.0`
- `description`: Create and verify Vercel delivery only after release approval.
- `activation_signals`: Vercel, deployment, deploy, preview deployment, rollback.
- `required_capabilities`: `vercel-deployment`.
- `allowed_roles`: Planner, Coder, Verifier, Security.
- `allowed_tools`: read state and approval-gated publish/log capabilities.
- `required_context_queries`: release receipt, deployment state, approval state.
- `instructions`: require exact verified receipt and wait for provider READY.
- `acceptance_checks`: provider deployment ID, state, and URL are recorded.
- `forbidden_claims`: queued or building is never ready.
