# Runtime skill: audit-and-compliance

- `id`: `audit-and-compliance`
- `version`: `3.1.0`
- `purpose`: Build tamper-evident audit, policy resolution, retention, export, deletion, backup, and restore flows.
- `policy order`: System hard policy, organization, workspace, project, then user preference; lower layers cannot weaken stronger rules.
- `security`: Events and exports exclude secret values. Completion, deletion, residency, and restore states require runtime evidence.
