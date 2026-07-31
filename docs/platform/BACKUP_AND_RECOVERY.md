# Backup and Recovery

Managed backups are scoped and checksummed. Production-destructive migrations require a matching verified backup. Restore targets a separate environment by default and requires approval.

The reference backup includes managed data and safe metadata. It deliberately excludes secret values and external provider object bytes; those need provider-native recovery procedures.

Recovery verification checks scope, checksum, approval, target isolation and audit evidence before reporting success.
