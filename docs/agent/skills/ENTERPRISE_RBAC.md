# Runtime skill: enterprise-rbac

- `id`: `enterprise-rbac`
- `version`: `3.1.0`
- `purpose`: Apply organization, workspace, project, environment, service-account, and API-token permissions.
- `roles`: Owner, admin, developer, designer, analyst, viewer, billing, and security are defaults; custom roles cannot bypass system hard policy.
- `security`: Server/tool handlers enforce authorization. One-time tokens are hashed after reveal and support expiry, rotation, and revocation.
