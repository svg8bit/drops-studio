# Runtime skill: managed-backend

- `id`: `managed-backend`
- `version`: `3.1.0`
- `purpose`: Generate an environment-isolated backend manifest, migration plan, typed SDK, capability scopes, and verification tests.
- `truth boundary`: An adapter is working only when its runtime returns evidence; otherwise generated apps and Studio show `Setup required`.
- `security boundary`: Control-plane credentials, database URLs, provider keys, and vault values never enter Project V2, Sandbox, logs, checkpoints, or exports.
- `acceptance`: Development, preview, and production remain isolated and production mutation stays approval-gated.
