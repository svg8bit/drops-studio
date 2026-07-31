# Managed Platform Security

- Every request is organization/workspace/project/environment scoped.
- Public constructors reject secret-bearing source and unsafe project paths.
- Tokens are hashed or encrypted; values are absent from API listings and logs.
- Webhooks use signatures, timestamps and replay protection.
- Mutations use revisions/idempotency and bounded payload/query limits.
- Production migrations, restore, deployment and external delivery require approval.
- Sandbox code receives no production environment or provider credentials.
- D1/Postgres configuration is not readiness; health evidence is mandatory.

Focused suites cover tenant isolation, role denial, invitation replay, OIDC replay, policy precedence, audit integrity, backup checksums and secret scanning.
