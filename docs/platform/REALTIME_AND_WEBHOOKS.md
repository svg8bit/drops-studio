# Realtime and Webhooks

`ManagedWebhookService` verifies signed payloads, timestamps and replay state before normalization. Remote registration is a separate external action and cannot become `completed` without a provider receipt.

`ManagedRealtimeService` is a bounded in-memory reference event stream. The enterprise collaboration domain separately verifies deterministic edits, presence expiry and comments. Neither is labelled a production websocket service.

Production activation requires an authenticated transport with tenant/project room authorization, connection limits, backpressure, disconnect cleanup and a health receipt.
