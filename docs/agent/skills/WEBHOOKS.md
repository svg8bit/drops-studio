# Runtime skill: webhooks

- `id`: `webhooks`
- `version`: `3.1.0`
- `purpose`: Build signed webhook ingestion, event schemas, idempotency, retries, dead-letter state, replay controls, and redacted delivery receipts.
- `truth boundary`: Receipt is not signature evidence. Drops Bot events use only the documented normalization adapter.
- `security`: Verify signature and timestamp before parsing; never store secrets or sensitive headers in logs.
