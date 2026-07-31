# Enterprise Identity

The generic OIDC contract enforces authorization state, nonce, PKCE, code replay protection, allowed domains and group mapping. Domain challenges are bound, expiring and rotating. SSO enforcement is policy-controlled.

Service accounts and API tokens are scoped, expiring, revocable and stored only as hashes. Raw token material is returned once and never enters projects, ZIPs, checkpoints or logs.

`LocalTestOidcAdapter` remains deterministic test evidence. Production also exposes the first-party issuer at `/api/enterprise/oidc`: HTTPS discovery, public Ed25519 JWKS, authorization code + PKCE S256, confidential-client Basic authentication, pairwise subjects, five-minute signed tokens, `userinfo`, exact redirect allowlists and private-Blob one-time code CAS. Authorization requires the existing signed Studio member cookie; provider keys and client credentials never enter generated source. Pairwise subjects use the independent `DROPS_ENTERPRISE_OIDC_SUBJECT_SALT`, so signing-key rotation does not silently change user identities. Rotate that salt only through an explicit identity migration.

`/api/enterprise/oidc/demo/start` exercises the real signed-member → authorization code → token → userinfo flow. The confidential `/health` self-check proves asymmetric signing, bounded expired-code cleanup and private durable state before the capability becomes `working`. SAML and SCIM remain separate setup-required adapters. A customer-managed Okta, Auth0 or Entra issuer is accepted only after HTTPS discovery and public-JWKS verification; its client secret is never transmitted by the health probe.
