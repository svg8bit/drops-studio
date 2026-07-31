# Managed Platform Operations

1. Configure one durable provider adapter (`d1` or `postgres`) in the server runtime.
2. Run its health check; do not activate production state from environment markers alone.
3. Configure encrypted secret and signed capability issuers outside generated projects.
4. Verify tenant isolation, migrations, backup and restore in preview.
5. Configure the first-party collaboration URL and OIDC issuer/client/signing values separately, then require their authenticated health evidence.
6. Run release gates and browser E2E before production promotion.

`/api/platform/capabilities` is the safe operational summary. `/backend` and `/enterprise` consume it without exposing secret values. If a provider degrades, return `unavailable` and preserve the labelled local/demo fallback where safe.

Production defaults:

- `DROPS_COLLABORATION_TRANSPORT_URL=https://<studio-origin>/api/collaboration/transport`
- `DROPS_ENTERPRISE_OIDC_ISSUER=https://<studio-origin>/api/enterprise/oidc`
- `DROPS_ENTERPRISE_OIDC_REDIRECT_URIS` is a comma-separated exact HTTPS allowlist; no wildcards.
- `DROPS_ENTERPRISE_OIDC_CLIENT_SECRET`, `DROPS_ENTERPRISE_OIDC_SIGNING_SECRET` and `DROPS_ENTERPRISE_OIDC_SUBJECT_SALT` are independent 32+ byte secrets.
- Rotate signing material independently. Rotating the subject salt changes pairwise user identifiers and therefore requires an explicit identity migration.
- External OIDC issuers receive a bounded public discovery/JWKS health probe only; Drops Studio does not send their client secret during health verification.
