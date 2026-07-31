export const ENTERPRISE_PERMISSIONS = [
  "organization.manage",
  "members.manage",
  "billing.manage",
  "security.manage",
  "audit.read",
  "workspace.manage",
  "project.create",
  "project.read",
  "project.edit",
  "project.delete",
  "project.publish",
  "project.export",
  "backend.schema.manage",
  "backend.data.read",
  "backend.data.write",
  "backend.functions.manage",
  "backend.secrets.manage",
  "backend.logs.read",
  "collaboration.comment",
  "collaboration.edit",
  "collaboration.merge",
  "integrations.manage",
  "github.manage",
  "deployment.manage",
] as const;

export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];

export const DEFAULT_ROLE_IDS = [
  "owner",
  "admin",
  "developer",
  "designer",
  "analyst",
  "viewer",
  "billing",
  "security",
] as const;

export type DefaultRoleId = (typeof DEFAULT_ROLE_IDS)[number];

export interface EnterpriseRuntime {
  now(): Date;
  id(prefix: string): string;
}

export interface SecretRuntime extends EnterpriseRuntime {
  entropy(label: string): string;
}

export type EnterpriseFeatureStatus =
  | "working-local-test"
  | "degraded"
  | "setup-required"
  | "disabled"
  | "unavailable";

export interface EnterpriseFeatureState {
  status: EnterpriseFeatureStatus;
  mode: string;
  providerEvidence: boolean;
  reason: string;
}
