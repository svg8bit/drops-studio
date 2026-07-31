import assert from "node:assert/strict";
import test from "node:test";

const {
  EnterpriseLifecycleManager,
  EnterprisePlatformError,
  ImmutableAuditLog,
} = await import("../lib/enterprise-platform/index.ts");

function hasCode(code) {
  return (error) => error instanceof EnterprisePlatformError && error.code === code;
}

function runtime() {
  let sequence = 0;
  let now = new Date("2026-07-30T12:00:00.000Z");
  return {
    now: () => new Date(now),
    id: (prefix) => `${prefix}-${++sequence}`,
    advance: (milliseconds) => { now = new Date(now.getTime() + milliseconds); },
  };
}

test("audit events are append-only, secret-safe, tenant-filtered and tamper evident", () => {
  const clock = runtime();
  const audit = new ImmutableAuditLog(clock);
  audit.append({
    organizationId: "org-1", actorType: "user", actorId: "owner", action: "organization.create", targetType: "organization", targetId: "org-1", outcome: "success", requestId: "request-1", metadata: { name: "Alpha" },
  });
  audit.append({
    organizationId: "org-1", workspaceId: "workspace-1", actorType: "agent", actorId: "agent-1", action: "branch.merge", targetType: "project", targetId: "project-1", outcome: "blocked", reasonCode: "conflict", requestId: "request-2", metadata: { conflictCount: 1 },
  });
  const listed = audit.list({ organizationId: "org-1", permissions: ["audit.read"], limit: 10 });
  assert.equal(listed.items.length, 2);
  assert.equal(audit.verifyIntegrity(), true);
  listed.items[0].metadata.name = "tampered clone";
  assert.equal(audit.verifyIntegrity(), true);
  assert.equal(audit.list({ organizationId: "org-1", permissions: ["audit.read"], limit: 10 }).items[0].metadata.name, "Alpha");
  assert.throws(() => audit.append({
    organizationId: "org-1", actorType: "user", actorId: "owner", action: "secret.update", targetType: "secret", outcome: "success", requestId: "request-3", metadata: { apiToken: `secret_${"x".repeat(32)}` },
  }), hasCode("AUDIT_SECRET_REJECTED"));
  assert.throws(() => audit.list({ organizationId: "org-1", permissions: [], limit: 10 }), hasCode("PERMISSION_DENIED"));
});

test("audit export paginates beyond the public 500-event page limit", () => {
  const clock = runtime();
  const audit = new ImmutableAuditLog(clock);
  for (let index = 0; index < 501; index += 1) {
    audit.append({
      organizationId: "org-1",
      actorType: "system",
      actorId: "audit-system",
      action: "project.verify",
      targetType: "project",
      targetId: "project-1",
      outcome: "success",
      requestId: `request-${index}`,
      metadata: { index },
    });
  }
  audit.append({
    organizationId: "org-2",
    actorType: "system",
    actorId: "audit-system",
    action: "project.verify",
    targetType: "project",
    targetId: "project-2",
    outcome: "success",
    requestId: "request-other-tenant",
    metadata: {},
  });
  const exported = audit.export({ organizationId: "org-1", permissions: ["audit.read"] });
  assert.equal(exported.eventCount, 501);
  assert.equal(exported.events.length, 501);
  assert.equal(exported.events.at(-1).requestId, "request-500");
  assert.equal(exported.chainRoot, exported.events.at(-1).integrityHash);
  assert.match(exported.checksum, /^[a-f0-9]{64}$/);
});

test("retention, exports and deletions are scheduled, cancellable and secret free", () => {
  const clock = runtime();
  const lifecycle = new EnterpriseLifecycleManager(clock);
  const retention = lifecycle.setRetentionPolicy({
    organizationId: "org-1", actorUserId: "security", permissions: ["security.manage"],
    values: { auditDays: 365, logsDays: 30, traceDays: 30, presenceDays: 1, deletedProjectDays: 14, backupDays: 90 },
  });
  assert.equal(retention.revision, 1);

  const exportJob = lifecycle.scheduleExport({
    organizationId: "org-1", actorUserId: "owner", permissions: ["project.export"], scope: { type: "organization", id: "org-1" },
  });
  const completed = lifecycle.completeExport({
    exportId: exportJob.id,
    data: { projects: [{ id: "project-1" }], apiToken: `dst_${"x".repeat(40)}`, configuration: { secretReferenceId: "secret-ref-1" } },
  });
  assert.equal(completed.status, "completed-local-test");
  assert.equal(JSON.stringify(completed.manifest).includes("dst_"), false);
  assert.match(completed.checksum, /^[a-f0-9]{64}$/);

  const pending = lifecycle.scheduleExport({
    organizationId: "org-1", actorUserId: "owner", permissions: ["project.export"], scope: { type: "project", id: "project-1" },
  });
  lifecycle.cancelExport({ exportId: pending.id, actorUserId: "owner" });
  assert.equal(lifecycle.exportRequest(pending.id).status, "cancelled");

  const deletion = lifecycle.scheduleDeletion({
    organizationId: "org-1", actorUserId: "owner", permissions: ["organization.manage"], target: { type: "organization", id: "org-1" }, gracePeriodMs: 86_400_000, confirmation: "DELETE organization:org-1", dependencies: [],
  });
  lifecycle.cancelDeletion({ deletionId: deletion.id, actorUserId: "owner" });
  assert.equal(lifecycle.deletionRequest(deletion.id).status, "cancelled");
});

test("backup metadata is checksummed and restore defaults to a new environment", () => {
  const clock = runtime();
  const lifecycle = new EnterpriseLifecycleManager(clock);
  const backup = lifecycle.createBackupMetadata({
    organizationId: "org-1", projectId: "project-1", environment: "development", sourceRevision: 7, artifactId: "artifact-1", artifactChecksum: "a".repeat(64), kind: "manual", adapterEvidence: { mode: "local-test", verified: true },
  });
  const restore = lifecycle.planRestore({ backupId: backup.id, actorUserId: "owner", targetEnvironment: "restore-preview", overwriteProduction: false, approved: false });
  assert.equal(restore.status, "planned");
  assert.equal(restore.targetEnvironment, "restore-preview");
  lifecycle.completeRestore({ restoreId: restore.id, checksumVerified: true, adapterEvidenceId: "local-test-restore-1" });
  assert.equal(lifecycle.restoreOperation(restore.id).status, "completed-local-test");

  assert.throws(() => lifecycle.planRestore({
    backupId: backup.id, actorUserId: "owner", targetEnvironment: "production", overwriteProduction: true, approved: false,
  }), hasCode("PRODUCTION_APPROVAL_REQUIRED"));
  assert.throws(() => lifecycle.planRestore({
    backupId: backup.id, actorUserId: "owner", targetEnvironment: "PrOdUcTiOn", overwriteProduction: false, approved: false,
  }), hasCode("PRODUCTION_APPROVAL_REQUIRED"));
  assert.throws(() => lifecycle.createBackupMetadata({
    organizationId: "org-1", projectId: "project-1", environment: "development", sourceRevision: 7, artifactId: "artifact-unverified", artifactChecksum: "b".repeat(64), kind: "manual", adapterEvidence: { mode: "external", verified: false },
  }), hasCode("BACKUP_EVIDENCE_REQUIRED"));
});
