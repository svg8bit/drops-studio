# Runtime skill: github-delivery

- `id`: `github-delivery`
- `version`: `3.0.0`
- `description`: Prepare least-privilege GitHub delivery behind approval.
- `activation_signals`: GitHub, repository, branch, commit, pull request.
- `required_capabilities`: `github-app`.
- `allowed_roles`: Planner, Coder, Verifier, Security.
- `allowed_tools`: read state and approval-gated publish capability.
- `required_context_queries`: GitHub configuration, release receipt, approval state.
- `instructions`: keep credentials server-side and bind mutation to a conversation branch.
- `acceptance_checks`: exact revision has a verified release receipt.
- `forbidden_claims`: no branch, commit, push, or PR claim without GitHub evidence.
