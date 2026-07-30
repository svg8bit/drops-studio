# Runtime skill: telegram-delivery

- `id`: `telegram-delivery`
- `version`: `3.0.0`
- `description`: Prepare Telegram delivery while preserving explicit approval.
- `activation_signals`: Telegram, channel, send alert, publish message, MTProto.
- `required_capabilities`: `telegram-proxy`.
- `allowed_roles`: Planner, Coder, QA, Security.
- `allowed_tools`: scoped files and connection request; publication is not automatic.
- `required_context_queries`: connection, delivery approval, provider confirmation.
- `instructions`: build preview/setup states and require approval before delivery.
- `acceptance_checks`: tests send no message and setup-required remains truthful.
- `forbidden_claims`: no sent-message claim without provider confirmation.
