import { enterpriseError } from "./errors.ts";
import type { EnterprisePermission, EnterpriseRuntime } from "./types.ts";
import { assertSafeId, boundedText, clone, iso, secretFreeClone, sha256, stableJson } from "./utils.ts";

export interface RetentionPolicyRecord {
  organizationId: string;
  revision: number;
  traceDays: number;
  auditDays: number;
  logsDays: number;
  presenceDays: number;
  deletedProjectDays: number;
  backupDays: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ExportRequestRecord {
  id: string;
  organizationId: string;
  requestedBy: string;
  scope: { type: "organization" | "workspace" | "project"; id: string };
  status: "pending" | "cancelled" | "completed-local-test";
  manifest: unknown | null;
  checksum: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  temporaryArtifactExpiresAt: string | null;
}

export interface DeletionRequestRecord {
  id: string;
  organizationId: string;
  requestedBy: string;
  target: { type: "project" | "workspace" | "organization"; id: string };
  status: "scheduled" | "cancelled" | "eligible" | "purged-local-metadata";
  executeAfter: string;
  dependencies: string[];
  createdAt: string;
  cancelledAt: string | null;
  providerCleanup: "not-started" | "setup-required";
}

export interface BackupMetadataRecord {
  id: string;
  organizationId: string;
  projectId: string;
  environment: string;
  sourceRevision: number;
  artifactId: string;
  artifactChecksum: string;
  kind: "manual" | "pre-migration";
  adapterMode: "local-test" | "external";
  adapterVerified: boolean;
  createdAt: string;
}

export interface RestoreOperationRecord {
  id: string;
  backupId: string;
  projectId: string;
  requestedBy: string;
  targetEnvironment: string;
  overwriteProduction: boolean;
  approved: boolean;
  status: "planned" | "completed-local-test" | "completed-external-verified";
  adapterEvidenceId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class EnterpriseLifecycleManager {
  readonly #runtime: EnterpriseRuntime;
  readonly #retention = new Map<string, RetentionPolicyRecord>();
  readonly #exports = new Map<string, ExportRequestRecord>();
  readonly #deletions = new Map<string, DeletionRequestRecord>();
  readonly #backups = new Map<string, BackupMetadataRecord>();
  readonly #restores = new Map<string, RestoreOperationRecord>();

  constructor(runtime: EnterpriseRuntime) {
    this.#runtime = runtime;
  }

  setRetentionPolicy(input: {
    organizationId: string;
    actorUserId: string;
    permissions: EnterprisePermission[];
    values: Omit<RetentionPolicyRecord, "organizationId" | "revision" | "updatedAt" | "updatedBy">;
  }): RetentionPolicyRecord {
    this.#require(input.permissions, "security.manage");
    for (const [key, value] of Object.entries(input.values)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 3_650) enterpriseError("RETENTION_INVALID", `${key} retention is invalid.`);
    }
    const previous = this.#retention.get(input.organizationId);
    const policy: RetentionPolicyRecord = {
      organizationId: assertSafeId(input.organizationId, "Retention organization id"),
      revision: (previous?.revision ?? 0) + 1,
      ...input.values,
      updatedAt: iso(this.#runtime.now()),
      updatedBy: assertSafeId(input.actorUserId, "Retention actor id"),
    };
    this.#retention.set(policy.organizationId, policy);
    return clone(policy);
  }

  scheduleExport(input: {
    organizationId: string;
    actorUserId: string;
    permissions: EnterprisePermission[];
    scope: ExportRequestRecord["scope"];
  }): ExportRequestRecord {
    this.#require(input.permissions, "project.export");
    const now = iso(this.#runtime.now());
    const request: ExportRequestRecord = {
      id: assertSafeId(this.#runtime.id("data-export"), "Export request id"),
      organizationId: assertSafeId(input.organizationId, "Export organization id"),
      requestedBy: assertSafeId(input.actorUserId, "Export actor id"),
      scope: { type: input.scope.type, id: assertSafeId(input.scope.id, "Export scope id") },
      status: "pending",
      manifest: null,
      checksum: null,
      createdAt: now,
      completedAt: null,
      cancelledAt: null,
      temporaryArtifactExpiresAt: null,
    };
    this.#exports.set(request.id, request);
    return clone(request);
  }

  completeExport(input: { exportId: string; data: unknown }): ExportRequestRecord {
    const request = this.#export(input.exportId);
    if (request.status !== "pending") enterpriseError("EXPORT_NOT_PENDING", "Only a pending export can complete.");
    const manifest = secretFreeClone(input.data);
    const serialized = stableJson(manifest);
    if (Buffer.byteLength(serialized, "utf8") > 10_000_000) enterpriseError("INVALID_INPUT", "Local test export exceeds its size limit.");
    request.manifest = manifest;
    request.checksum = sha256(serialized);
    request.status = "completed-local-test";
    request.completedAt = iso(this.#runtime.now());
    request.temporaryArtifactExpiresAt = iso(new Date(this.#runtime.now().getTime() + 60 * 60_000));
    return clone(request);
  }

  cancelExport(input: { exportId: string; actorUserId: string }): ExportRequestRecord {
    const request = this.#export(input.exportId);
    if (request.status !== "pending") enterpriseError("EXPORT_NOT_PENDING", "Only a pending export can be cancelled.");
    if (request.requestedBy !== input.actorUserId) enterpriseError("PERMISSION_DENIED", "Only the export requester can cancel this local test job.");
    request.status = "cancelled";
    request.cancelledAt = iso(this.#runtime.now());
    return clone(request);
  }

  exportRequest(id: string): ExportRequestRecord {
    return clone(this.#export(id));
  }

  scheduleDeletion(input: {
    organizationId: string;
    actorUserId: string;
    permissions: EnterprisePermission[];
    target: DeletionRequestRecord["target"];
    gracePeriodMs: number;
    confirmation: string;
    dependencies: string[];
  }): DeletionRequestRecord {
    const required: EnterprisePermission = input.target.type === "organization" ? "organization.manage" : input.target.type === "workspace" ? "workspace.manage" : "project.delete";
    this.#require(input.permissions, required);
    if (input.confirmation !== `DELETE ${input.target.type}:${input.target.id}`) enterpriseError("CONFIRMATION_REQUIRED", "Explicit deletion confirmation is required.");
    if (!Number.isSafeInteger(input.gracePeriodMs) || input.gracePeriodMs < 60_000 || input.gracePeriodMs > 30 * 86_400_000) enterpriseError("INVALID_INPUT", "Deletion grace period is invalid.");
    const now = this.#runtime.now();
    const request: DeletionRequestRecord = {
      id: assertSafeId(this.#runtime.id("deletion-request"), "Deletion request id"),
      organizationId: assertSafeId(input.organizationId, "Deletion organization id"),
      requestedBy: assertSafeId(input.actorUserId, "Deletion actor id"),
      target: { type: input.target.type, id: assertSafeId(input.target.id, "Deletion target id") },
      status: "scheduled",
      executeAfter: iso(new Date(now.getTime() + input.gracePeriodMs)),
      dependencies: [...new Set(input.dependencies.map((dependency) => boundedText(dependency, "Deletion dependency", 160)))].sort(),
      createdAt: iso(now),
      cancelledAt: null,
      providerCleanup: "not-started",
    };
    this.#deletions.set(request.id, request);
    return clone(request);
  }

  cancelDeletion(input: { deletionId: string; actorUserId: string }): DeletionRequestRecord {
    const request = this.#deletion(input.deletionId);
    if (request.status !== "scheduled") enterpriseError("DELETION_NOT_PENDING", "Only scheduled deletion can be cancelled.");
    if (request.requestedBy !== input.actorUserId) enterpriseError("PERMISSION_DENIED", "Only the deletion requester can cancel this local test request.");
    request.status = "cancelled";
    request.cancelledAt = iso(this.#runtime.now());
    return clone(request);
  }

  markDeletionEligible(input: { deletionId: string }): DeletionRequestRecord {
    const request = this.#deletion(input.deletionId);
    if (request.status !== "scheduled") enterpriseError("DELETION_NOT_PENDING", "Deletion is not scheduled.");
    if (this.#runtime.now().getTime() < Date.parse(request.executeAfter)) enterpriseError("DELETION_NOT_PENDING", "Deletion grace period has not elapsed.");
    if (request.dependencies.length) enterpriseError("DELETION_DEPENDENCIES", "Deletion has unresolved dependencies.");
    request.status = "eligible";
    return clone(request);
  }

  purgeLocalMetadata(input: { deletionId: string }): DeletionRequestRecord {
    const request = this.#deletion(input.deletionId);
    if (request.status !== "eligible") enterpriseError("DELETION_NOT_PENDING", "Deletion is not eligible.");
    request.status = "purged-local-metadata";
    request.providerCleanup = "setup-required";
    return clone(request);
  }

  deletionRequest(id: string): DeletionRequestRecord {
    return clone(this.#deletion(id));
  }

  createBackupMetadata(input: {
    organizationId: string;
    projectId: string;
    environment: string;
    sourceRevision: number;
    artifactId: string;
    artifactChecksum: string;
    kind: BackupMetadataRecord["kind"];
    adapterEvidence: { mode: BackupMetadataRecord["adapterMode"]; verified: boolean };
  }): BackupMetadataRecord {
    if (!input.adapterEvidence.verified) enterpriseError("BACKUP_EVIDENCE_REQUIRED", "Backup metadata requires verified adapter evidence.");
    if (!/^[a-f0-9]{64}$/i.test(input.artifactChecksum)) enterpriseError("INVALID_INPUT", "Backup checksum is invalid.");
    if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0) enterpriseError("INVALID_INPUT", "Backup source revision is invalid.");
    const backup: BackupMetadataRecord = {
      id: assertSafeId(this.#runtime.id("backup"), "Backup id"),
      organizationId: assertSafeId(input.organizationId, "Backup organization id"),
      projectId: assertSafeId(input.projectId, "Backup project id"),
      environment: boundedText(input.environment, "Backup environment", 80),
      sourceRevision: input.sourceRevision,
      artifactId: assertSafeId(input.artifactId, "Backup artifact id"),
      artifactChecksum: input.artifactChecksum.toLowerCase(),
      kind: input.kind,
      adapterMode: input.adapterEvidence.mode,
      adapterVerified: true,
      createdAt: iso(this.#runtime.now()),
    };
    this.#backups.set(backup.id, backup);
    return clone(backup);
  }

  planRestore(input: {
    backupId: string;
    actorUserId: string;
    targetEnvironment: string;
    overwriteProduction: boolean;
    approved: boolean;
  }): RestoreOperationRecord {
    const backup = this.#backup(input.backupId);
    const targetEnvironment = boundedText(input.targetEnvironment, "Restore target environment", 80);
    if (targetEnvironment.toLowerCase() === "production" && (!input.overwriteProduction || !input.approved)) enterpriseError("PRODUCTION_APPROVAL_REQUIRED", "Production restore requires explicit overwrite approval.");
    const operation: RestoreOperationRecord = {
      id: assertSafeId(this.#runtime.id("restore"), "Restore operation id"),
      backupId: backup.id,
      projectId: backup.projectId,
      requestedBy: assertSafeId(input.actorUserId, "Restore actor id"),
      targetEnvironment,
      overwriteProduction: input.overwriteProduction,
      approved: input.approved,
      status: "planned",
      adapterEvidenceId: null,
      createdAt: iso(this.#runtime.now()),
      completedAt: null,
    };
    this.#restores.set(operation.id, operation);
    return clone(operation);
  }

  completeRestore(input: { restoreId: string; checksumVerified: boolean; adapterEvidenceId: string }): RestoreOperationRecord {
    const operation = this.#restore(input.restoreId);
    if (operation.status !== "planned" || !input.checksumVerified) enterpriseError("RESTORE_EVIDENCE_REQUIRED", "Restore completion requires a verified checksum.");
    const backup = this.#backup(operation.backupId);
    operation.adapterEvidenceId = assertSafeId(input.adapterEvidenceId, "Restore evidence id");
    operation.status = backup.adapterMode === "local-test" ? "completed-local-test" : "completed-external-verified";
    operation.completedAt = iso(this.#runtime.now());
    return clone(operation);
  }

  restoreOperation(id: string): RestoreOperationRecord {
    return clone(this.#restore(id));
  }

  #require(permissions: EnterprisePermission[], permission: EnterprisePermission): void {
    if (!permissions.includes(permission)) enterpriseError("PERMISSION_DENIED", `Permission ${permission} is required.`);
  }

  #export(id: string): ExportRequestRecord {
    const request = this.#exports.get(id);
    if (!request) enterpriseError("NOT_FOUND", "Export request was not found.");
    return request;
  }

  #deletion(id: string): DeletionRequestRecord {
    const request = this.#deletions.get(id);
    if (!request) enterpriseError("NOT_FOUND", "Deletion request was not found.");
    return request;
  }

  #backup(id: string): BackupMetadataRecord {
    const backup = this.#backups.get(id);
    if (!backup) enterpriseError("NOT_FOUND", "Backup metadata was not found.");
    return backup;
  }

  #restore(id: string): RestoreOperationRecord {
    const restore = this.#restores.get(id);
    if (!restore) enterpriseError("NOT_FOUND", "Restore operation was not found.");
    return restore;
  }
}
