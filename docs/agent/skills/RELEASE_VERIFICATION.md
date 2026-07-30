# Runtime skill: release-verification

- `id`: `release-verification`
- `version`: `3.0.0`
- `description`: Collect immutable evidence for the exact candidate revision.
- `activation_signals`: verify, release, build, preview, checkpoint, ready.
- `required_capabilities`: none.
- `allowed_roles`: Planner, Coder, AutoFix, Verifier, Visual Verifier, QA, Security.
- `allowed_tools`: scoped reads, checks, logs, preview, checkpoint where role permits.
- `required_context_queries`: release gate, browser evidence, project revision.
- `instructions`: deterministic gates are authoritative and judges can only downgrade.
- `acceptance_checks`: every required gate has revision-bound evidence.
- `forbidden_claims`: missing, skipped, stale, or failed required evidence cannot be release-ready.
