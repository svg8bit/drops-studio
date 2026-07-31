# Runtime skill: managed-auth

- `id`: `managed-auth`
- `version`: `3.1.0`
- `purpose`: Build project-scoped passwordless users, roles, invitations, sessions, revocation, and audit events.
- `truth boundary`: Test codes work only in the local/test adapter. Production without a configured delivery adapter displays `Auth setup required`.
- `security boundary`: Studio member identity and generated-app user identity remain separate; CSRF, replay, fixation, rate-limit, and role checks are server-enforced.
