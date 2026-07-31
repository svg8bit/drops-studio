# Runtime skill: realtime-data

- `id`: `realtime-data`
- `version`: `3.1.0`
- `purpose`: Add ordered, authorized collection subscriptions with reconnect, backpressure, and environment isolation.
- `truth boundary`: Studio and generated SDK state the actual transport. Polling/SSE degradation is not presented as live collaborative cursors.
- `acceptance`: Scope, filter validation, ordering, reconnect, expiry, limits, and cross-environment denial are tested.
