# Managed Auth

`ManagedAuthService` provides project-scoped users and sessions, hashed session tokens, CSRF binding, expiry and revocation. An email adapter is required for real one-time-code delivery; without it the capability reports `setup-required-email`.

Enterprise workforce identity is separate from generated-app user auth. External OIDC credentials are server-only. BYO database and model credentials remain session-only during setup and are never compiled into generated source.

Security tests cover scope isolation, CSRF, revocation and the absence of secret values in returned records and logs.
