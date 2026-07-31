# Runtime skill: object-storage

- `id`: `object-storage`
- `version`: `3.1.0`
- `purpose`: Add namespaced uploads, metadata, visibility, retention, deletion, and short-lived signed capabilities.
- `truth boundary`: Vercel Blob or another adapter must be configured; malware scanning is never claimed without scanner evidence.
- `security`: MIME, size, scope, expiry, and authorization are validated before access. Blob is not used as a relational database.
