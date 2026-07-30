# Runtime skill: dropstab-integration

- `id`: `dropstab-integration`
- `version`: `3.0.0`
- `description`: Use documented DropsTab operations through the server adapter.
- `activation_signals`: DropsTab, market cap, FDV, token unlock, funding round, coin search.
- `required_capabilities`: `dropstab-proxy`.
- `allowed_roles`: Planner, Coder, AutoFix, QA, Security.
- `allowed_tools`: scoped files, connection request, checks; no direct credential transport.
- `required_context_queries`: endpoint registry, provider evidence, cache policy.
- `instructions`: preserve attribution, freshness, rate limits, and honest demo fallback.
- `acceptance_checks`: provider evidence or labeled fallback is visible.
- `forbidden_claims`: never expose a key or call fallback data live.
