# Runtime skill: dropsbot-integration

- `id`: `dropsbot-integration`
- `version`: `3.0.0`
- `description`: Build documented Drops Bot monitoring and webhook workflows.
- `activation_signals`: Drops Bot, tracked wallet, wallet monitor, wallet event, webhook.
- `required_capabilities`: `dropsbot-proxy`.
- `allowed_roles`: Planner, Coder, AutoFix, QA, Security.
- `allowed_tools`: scoped files, connection request, checks; remote writes remain gated.
- `required_context_queries`: capability registry, webhook contract, provider evidence.
- `instructions`: implement only documented capabilities and return setup-required otherwise.
- `acceptance_checks`: verification/replay checks and provider confirmation exist.
- `forbidden_claims`: no wallet, webhook, or alert success without provider evidence.
