# Realtime and Webhooks

`ManagedWebhookService` verifies signed payloads, timestamps and replay state before normalization. Remote registration is a separate external action and cannot become `completed` without a provider receipt.

`ManagedRealtimeService` remains the bounded in-memory reference event stream. The enterprise collaboration domain separately provides a durable authenticated HTTP transport backed by Neon Postgres or private Vercel Blob. It supports tenant/project room isolation, ordered append/read, revision conflicts, idempotency, bounded retention and the deterministic edit/presence/comment core.

Production activation requires a successful operator-only live receipt proving two-actor durable writes, reads, ordering, replay idempotency and cleanup. The product does not call the bounded request transport a permanent WebSocket connection.

The Studio client uses visible-tab bounded polling as an invalidation layer for verified team project revisions. Events contain revision metadata and a digest only; the team API remains the authoritative source snapshot, and replacing local editor state still requires explicit user consent. This flow does not claim live cursors, WebSocket delivery or silent source merging.
