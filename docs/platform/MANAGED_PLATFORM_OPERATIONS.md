# Managed Platform Operations

1. Configure one durable provider adapter (`d1` or `postgres`) in the server runtime.
2. Run its health check; do not activate production state from environment markers alone.
3. Configure encrypted secret and signed capability issuers outside generated projects.
4. Verify tenant isolation, migrations, backup and restore in preview.
5. Configure realtime and external OIDC separately, with their own health evidence.
6. Run release gates and browser E2E before production promotion.

`/api/platform/capabilities` is the safe operational summary. `/backend` and `/enterprise` consume it without exposing secret values. If a provider degrades, return `unavailable` and preserve the labelled local/demo fallback where safe.
