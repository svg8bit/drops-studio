# Runtime skill: security-review

- `id`: `security-review`
- `version`: `3.0.0`
- `description`: Review immutable source and runtime evidence for security blockers.
- `activation_signals`: security, secret, permission, webhook, SSRF, auth, release.
- `required_capabilities`: none.
- `allowed_roles`: Planner, Coder, AutoFix, Verifier, QA, Security.
- `allowed_tools`: read and bounded log tools only for reviewer roles.
- `required_context_queries`: security policy, permissions, secret scan.
- `instructions`: block secret, permission, injection, SSRF, replay, and approval failures.
- `acceptance_checks`: findings include evidence IDs and affected scope.
- `forbidden_claims`: deterministic security failures cannot be downgraded.
