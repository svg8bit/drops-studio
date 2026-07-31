import type { EnterpriseFeatureState } from "./types.ts";

export function enterpriseFeatureStates(input: {
  organizations?: boolean;
  localCollaboration?: boolean;
  localTestOidc?: boolean;
}): Record<string, EnterpriseFeatureState> {
  const local = (enabled: boolean, mode: string, reason: string): EnterpriseFeatureState => enabled
    ? { status: "working-local-test", mode, providerEvidence: false, reason }
    : { status: "disabled", mode: "disabled", providerEvidence: false, reason: "Feature flag is disabled." };
  return {
    organizations: local(Boolean(input.organizations), "in-memory-reference-adapter", "Organization domain is enabled only in the local/test reference adapter."),
    realtimeCollaboration: input.localCollaboration
      ? { status: "working-local-test", mode: "deterministic-local-test", providerEvidence: false, reason: "Deterministic operations and presence run in process; no network realtime transport is configured." }
      : { status: "setup-required", mode: "transport-not-configured", providerEvidence: false, reason: "Realtime collaboration transport is not configured." },
    enterpriseOidc: local(Boolean(input.localTestOidc), "standards-shaped-local-test-oidc", "OIDC is backed by the local test authorization-code adapter, not an external provider."),
    enterpriseSaml: { status: "setup-required", mode: "not-configured", providerEvidence: false, reason: "SAML adapter not configured." },
    scim: { status: "setup-required", mode: "not-configured", providerEvidence: false, reason: "SCIM adapter not configured." },
    serviceAccounts: local(true, "in-memory-reference-adapter", "Scoped credentials are reference/test records until a durable store is wired."),
    enterprisePolicies: local(true, "deterministic-policy-engine", "Policy resolution is deterministic and does not contact external providers."),
    auditLog: local(true, "in-memory-integrity-chain", "Audit integrity is testable in process; durable append-only storage must be configured separately."),
    backups: { status: "setup-required", mode: "metadata-only-reference-adapter", providerEvidence: false, reason: "External backup artifact storage is not configured." },
  };
}
