# Runtime skill: enterprise-sso

- `id`: `enterprise-sso`
- `version`: `3.1.0`
- `purpose`: Configure generic organization OIDC with discovery, PKCE, state, nonce, verified domains, claim mapping, and owner recovery.
- `truth boundary`: SAML and SCIM remain `Adapter not configured` unless complete configured implementations pass their contract tests.
- `security`: SSO enforcement begins only after domain verification and never locks out the emergency owner recovery path.
