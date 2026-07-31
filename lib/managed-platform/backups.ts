import { randomUUID } from "node:crypto";
import type { ManagedFunctionManifest, ManagedPrincipal, ManagedRecord, ManagedSchemaSnapshot, ManagedScope } from "./contracts.ts";
import type { ManagedAuthService } from "./auth.ts";
import type { InMemoryManagedData } from "./data.ts";
import type { ManagedLogStore } from "./logs.ts";
import type { ManagedFunctionService, ManagedJobService, ManagedWebhookService } from "./runtime-services.ts";
import type { ManagedSecretVault } from "./secrets.ts";
import type { ManagedObjectStorage } from "./storage.ts";
import { ManagedPlatformError, assertScope, clone, requireApproval, requirePermission, sha256, stableJson } from "./security.ts";

const OMITTED_RESTORE_COMPONENTS = ["auth-sessions", "function-manifests", "job-metadata", "object-bytes", "secret-values", "webhook-configuration"] as const;

interface BackupPayload {
  schemaVersion: 1;
  sourceScope: Omit<ManagedScope, "scopeKey">;
  data: { schema: ManagedSchemaSnapshot; rows: Record<string, ManagedRecord[]> };
  auth: ReturnType<ManagedAuthService["exportMetadata"]>;
  storageMetadata: ReturnType<ManagedObjectStorage["exportMetadata"]>;
  functionManifests: ManagedFunctionManifest[];
  webhookConfiguration: ReturnType<ManagedWebhookService["exportConfiguration"]>;
  jobMetadata: ReturnType<ManagedJobService["exportMetadata"]>;
  secretReferences: ReturnType<ManagedSecretVault["exportReferences"]>;
  createdAt: string;
}

export interface ManagedBackup {
  id: string;
  scopeKey: string;
  environment: ManagedScope["environment"];
  checksum: string;
  byteSize: number;
  payload: BackupPayload;
  createdAt: string;
}

export class ManagedBackupService {
  private readonly backups = new Map<string, ManagedBackup>();
  private readonly options: {
    now: () => Date;
    data: InMemoryManagedData;
    auth: ManagedAuthService;
    storage: ManagedObjectStorage;
    functions: ManagedFunctionService;
    webhooks: ManagedWebhookService;
    jobs: ManagedJobService;
    secrets: ManagedSecretVault;
    logs: ManagedLogStore;
  };
  constructor(options: ManagedBackupService["options"]) { this.options = options; }

  create(scope: ManagedScope, principal: ManagedPrincipal): ManagedBackup {
    assertScope(scope, principal);
    requirePermission(principal, "backend.backups.manage");
    const createdAt = this.options.now().toISOString();
    const payload: BackupPayload = {
      schemaVersion: 1,
      sourceScope: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, projectId: scope.projectId, environment: scope.environment },
      data: this.options.data.exportState(scope),
      auth: this.options.auth.exportMetadata(scope, principal),
      storageMetadata: this.options.storage.exportMetadata(scope),
      functionManifests: this.options.functions.exportManifests(scope),
      webhookConfiguration: this.options.webhooks.exportConfiguration(scope),
      jobMetadata: this.options.jobs.exportMetadata(scope),
      secretReferences: this.options.secrets.exportReferences(scope),
      createdAt,
    };
    const serialized = stableJson(payload);
    const backup: ManagedBackup = { id: `backup_${randomUUID()}`, scopeKey: scope.scopeKey, environment: scope.environment, checksum: sha256(serialized), byteSize: Buffer.byteLength(serialized), payload, createdAt };
    this.backups.set(backup.id, backup);
    this.options.logs.append(scope, { category: "backup", severity: "info", action: "backup.create", actorId: principal.actorId, requestId: backup.id, metadata: { backupId: backup.id, checksum: backup.checksum, byteSize: backup.byteSize } });
    return clone(backup);
  }

  private verified(backupId: string): ManagedBackup {
    const backup = this.backups.get(backupId);
    if (!backup) throw new ManagedPlatformError("BACKUP_NOT_FOUND", "Managed backend backup does not exist.");
    if (sha256(stableJson(backup.payload)) !== backup.checksum) throw new ManagedPlatformError("BACKUP_INTEGRITY_FAILED", "Managed backend backup checksum is invalid.");
    return backup;
  }

  verifyForScope(backupId: string, scope: ManagedScope): boolean {
    const backup = this.verified(backupId);
    return backup.scopeKey === scope.scopeKey;
  }

  previewRestore(backupId: string, target: ManagedScope, principal: ManagedPrincipal) {
    assertScope(target, principal);
    requirePermission(principal, "backend.backups.manage");
    const backup = this.verified(backupId);
    if (backup.payload.sourceScope.organizationId !== target.organizationId || backup.payload.sourceScope.workspaceId !== target.workspaceId || backup.payload.sourceScope.projectId !== target.projectId) {
      throw new ManagedPlatformError("BACKUP_SCOPE_DENIED", "Backup may only restore inside its authorized project.");
    }
    return {
      backupId,
      sourceEnvironment: backup.environment,
      targetEnvironment: target.environment,
      collectionCount: Object.keys(backup.payload.data.schema.collections).length,
      rowCount: Object.values(backup.payload.data.rows).reduce((sum, rows) => sum + rows.length, 0),
      secretReferencesRequireRotation: backup.payload.secretReferences.length,
      objectBytesRestored: false,
      omittedComponents: [...OMITTED_RESTORE_COMPONENTS],
      warnings: [
        "Secret values are excluded and every restored reference requires rotation.",
        "Object metadata is included, but provider object bytes require the configured storage recovery adapter and are not restored by this adapter.",
        "Auth sessions, function manifests, webhook configuration, and job metadata are evidence-only in this backup adapter and are not restored.",
      ],
      checksum: backup.checksum,
    };
  }

  restore(backupId: string, target: ManagedScope, principal: ManagedPrincipal, options: { approvalReceipt?: string; overwrite?: boolean } = {}) {
    const preview = this.previewRestore(backupId, target, principal);
    if (target.environment === "production") requireApproval(options.approvalReceipt);
    if (this.options.data.hasEnvironment(target) && !options.overwrite) throw new ManagedPlatformError("RESTORE_TARGET_NOT_EMPTY", "Restore target already exists; explicit verified overwrite is required.");
    if (options.overwrite) requireApproval(options.approvalReceipt);
    const backup = this.verified(backupId);
    this.options.data.importState(target, backup.payload.data);
    this.options.auth.importMetadata(target, backup.payload.auth, principal);
    this.options.secrets.importReferences(target, backup.payload.secretReferences);
    this.options.logs.append(target, { category: "backup", severity: "info", action: "backup.restore", actorId: principal.actorId, requestId: `restore_${randomUUID()}`, metadata: { backupId, sourceEnvironment: backup.environment, targetEnvironment: target.environment, checksum: backup.checksum, secretReferencesRequireRotation: preview.secretReferencesRequireRotation } });
    return { status: "restored" as const, ...preview };
  }
}
