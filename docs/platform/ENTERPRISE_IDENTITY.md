# Enterprise Identity

The generic OIDC contract enforces authorization state, nonce, PKCE, code replay protection, allowed domains and group mapping. Domain challenges are bound, expiring and rotating. SSO enforcement is policy-controlled.

Service accounts and API tokens are scoped, expiring, revocable and stored only as hashes. Raw token material is returned once and never enters projects, ZIPs, checkpoints or logs.

`LocalTestOidcAdapter` is standards-shaped test evidence, not an external identity provider. SAML and SCIM adapters intentionally return setup-required. External OIDC stays disabled until discovery and callback verification succeeds.
