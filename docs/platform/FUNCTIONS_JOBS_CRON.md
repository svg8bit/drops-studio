# Functions, Jobs and Cron

Functions use typed manifests with bounded input/output shapes, timeouts, secret references and network host allowlists. The default runtime is `setup-required`; the in-memory handler exists only for explicit tests.

Jobs provide idempotency, bounded retries and dead-letter records. Cron expressions and time zones are validated, and production schedules require an approval receipt. Declarations are never shown as running until an external provider returns evidence.

Trading, wallet custody, Telegram publication, deployment, webhook registration and external database writes remain approval-gated.
