# Enterprise Policies

Policies can constrain provider/model allowlists, role actions, external mutations, retention and collaboration behavior. Resolution is deterministic and higher-priority policy may only tighten inherited constraints.

Evaluation returns an allow/deny/approval decision plus a stable policy hash suitable for audit evidence. It never silently upgrades a missing provider or credential state.

Private-key custody and automatic trading are permanently outside the platform policy surface.
