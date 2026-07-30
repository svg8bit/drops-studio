import type { GeneratedProjectSpec } from "./project-types.ts";

export const PROJECT_V2_SCHEMA_VERSION = 2 as const;

export type ProjectFileProvenanceV2 = "generated" | "ai" | "manual";
export type ProjectFileLanguageV2 =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "text"
  | "typescript"
  | "tsx";

export type ProjectFileRoleV2 =
  | "asset"
  | "component"
  | "config"
  | "documentation"
  | "entry"
  | "integration"
  | "manifest"
  | "source"
  | "style"
  | "test";

export interface ProjectFileV2 {
  kind: "file";
  path: string;
  content: string;
  language: ProjectFileLanguageV2;
  role: ProjectFileRoleV2;
  provenance: ProjectFileProvenanceV2;
  editable: boolean;
  bytes: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectManifestV2 {
  schemaVersion: 2;
  name: string;
  slug: string;
  packageManager: "npm";
  framework: {
    name: "legacy-html" | "nextjs";
    version: string;
  };
  runtime: {
    name: "nodejs";
    version: "24";
  };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  entrypoints: string[];
  legacyFallback: {
    supported: boolean;
    adapter: "legacy-html";
    reason: string;
    sourceSchemaVersion: 1;
  };
}

export interface ProjectIntegrationManifestV2 {
  id: string;
  kind: "dropstab" | "drops-bot" | "telegram" | "project-data" | "custom";
  status: "available" | "demo" | "setup-required" | "unconfigured";
  capabilities: string[];
  proxyPath?: string;
  providerEvidenceRequired: boolean;
}

export interface ProjectEnvironmentDefinitionV2 {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
  scope: "build" | "deployment" | "runtime";
}

export interface ProjectPermissionV2 {
  id: string;
  capability: string;
  effect: "allow" | "deny" | "approval-required";
  destructive: boolean;
  external: boolean;
}

export interface BuilderTaskV2 {
  id: string;
  label: string;
  kind: "build" | "dev" | "lint" | "test" | "typecheck" | "custom";
  command: "npm";
  args: string[];
  cwd: string;
  timeoutMs: number;
  previewPort?: number;
  approvalRequired: boolean;
}

export interface BuilderRunV2 {
  id: string;
  taskId: string;
  projectRevision: number;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  runtime: "vercel-sandbox";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  logIds: string[];
  auditEventIds: string[];
}

export interface ProjectLogMetadataV2 {
  id: string;
  runId: string;
  stream: "audit" | "browser" | "stderr" | "stdout";
  bytes: number;
  truncated: boolean;
  createdAt: string;
}

export interface ProjectPreviewStateV2 {
  status: "idle" | "starting" | "ready" | "failed" | "stopped";
  projectRevision: number;
  sandboxId?: string;
  url?: string;
  port?: number;
  startedAt?: string;
  stoppedAt?: string;
  error?: string;
}

export interface ProjectDeploymentStateV2 {
  status: "none" | "queued" | "building" | "ready" | "failed" | "rolled-back";
  provider: "legacy-publish" | "vercel";
  deploymentId?: string;
  url?: string;
  createdAt?: string;
  legacyPublishedSlug?: string;
  legacyPublishedUrl?: string;
}

export interface ProjectMigrationMetadataV2 {
  sourceSchemaVersion: 1 | 2;
  sourceKind: "generated-project-v1" | "project-workspace-v1" | "project-v2-template";
  sourceProjectId?: string;
  sourceFidelity: "exact" | "reconstructed" | "native";
  adapter: "legacy-html" | "native-v2";
  migratedAt: string;
}

export interface ProjectCanonicalSnapshotV2 {
  schemaVersion: 2;
  revision: number;
  contentHash: string;
  manifest: ProjectManifestV2;
  files: Record<string, ProjectFileV2>;
  productSpec: GeneratedProjectSpec;
  integrations: ProjectIntegrationManifestV2[];
  environment: ProjectEnvironmentDefinitionV2[];
  permissions: ProjectPermissionV2[];
  tasks: BuilderTaskV2[];
  migration: ProjectMigrationMetadataV2;
}

export interface ProjectCheckpointV2 {
  id: string;
  label: string;
  source: "ai" | "manual" | "migration" | "system";
  createdAt: string;
  snapshotHash: string;
  snapshot: ProjectCanonicalSnapshotV2;
}

export interface ProjectV2 {
  schemaVersion: 2;
  id: string;
  revision: number;
  contentHash: string;
  manifest: ProjectManifestV2;
  files: Record<string, ProjectFileV2>;
  productSpec: GeneratedProjectSpec;
  integrations: ProjectIntegrationManifestV2[];
  environment: ProjectEnvironmentDefinitionV2[];
  permissions: ProjectPermissionV2[];
  tasks: BuilderTaskV2[];
  runs: BuilderRunV2[];
  logs: ProjectLogMetadataV2[];
  checkpoints: ProjectCheckpointV2[];
  preview?: ProjectPreviewStateV2;
  deployment?: ProjectDeploymentStateV2;
  migration: ProjectMigrationMetadataV2;
  createdAt: string;
  updatedAt: string;
}

export type ProjectFileOperationV2 =
  | {
      type: "write";
      path: string;
      content: string;
      language?: ProjectFileLanguageV2;
      role?: ProjectFileRoleV2;
      provenance: ProjectFileProvenanceV2;
      editable?: boolean;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "rename";
      from: string;
      to: string;
      provenance: ProjectFileProvenanceV2;
    };
