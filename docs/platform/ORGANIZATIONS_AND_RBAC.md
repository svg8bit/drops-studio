# Organizations and RBAC

The V4 domain defines organizations, workspaces, memberships, invitations, project directories and custom roles. Default roles are owner, admin, developer, designer, analyst, viewer, billing and security.

Permissions are tenant-scoped. Custom roles cannot grant a permission the creating actor lacks. Invitations expire, rotate on resend, reject replay and cannot cross organizations. Project transfer validates both source and destination workspaces.

The public `/organizations` page uses the existing signed team APIs. It shows sign-in/setup errors rather than sample members. Rich V4 records remain reference-only until a durable control-plane adapter is connected.
