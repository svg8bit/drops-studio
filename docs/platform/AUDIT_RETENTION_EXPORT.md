# Audit, Retention and Export

`ImmutableAuditLog` creates tenant-filtered, append-only events linked by integrity hashes. Secret-like metadata is rejected before append. Runtime logs use separate bounded sanitization.

`EnterpriseLifecycleManager` validates retention from 1 through 3,650 days and manages sanitized export and deletion requests with scheduling and cancellation. Exports omit secrets and credential values.

Production durability requires an append-only store and signed artifact receipt. The local integrity chain proves behavior but is never presented as durable provider evidence.
