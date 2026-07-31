# Realtime and Webhooks

`ManagedWebhookService` verifies signed payloads, timestamps and replay state before normalization. Remote registration is a separate external action and cannot become `completed` without a provider receipt.

`ManagedRealtimeService` remains the bounded in-memory reference event stream. The enterprise collaboration domain separately provides a durable authenticated HTTP transport backed by Neon Postgres or private Vercel Blob. It supports tenant/project room isolation, ordered append/read, revision conflicts, idempotency, bounded retention and the deterministic edit/presence/comment core.

Production activation requires a successful operator-only live receipt proving two-actor durable writes, reads, ordering, replay idempotency and cleanup. The product does not call the bounded request transport a permanent WebSocket connection.
