import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const managed = await import("../lib/managed-platform/index.ts");
const SOURCE = managed.managedScope({ organizationId: "org", workspaceId: "workspace", projectId: "project", environment: "development" });
const RESTORE = managed.managedScope({ ...SOURCE, environment: "preview" });

function owner(scope) {
  return managed.managedPrincipal({
    actorId: "owner",
    actorType: "user",
    scope,
    roles: ["owner"],
    permissions: ["backend.schema.manage", "backend.data.read", "backend.data.write", "backend.data.admin", "backend.secrets.manage", "backend.backups.manage"],
  });
}

test("backup snapshots are checksummed, omit secret values, and restore to a separate environment", () => {
  const platform = managed.createInMemoryManagedPlatform({ signingKey: Buffer.alloc(32, 1), encryptionKey: Buffer.alloc(32, 2) });
  platform.environments.ensure(SOURCE, owner(SOURCE));
  const migration = platform.schema.plan(SOURCE, {
    baseVersion: 0,
    operations: [{ kind: "create-collection", collection: {
      name: "alerts",
      rowPolicy: "project",
      fields: { title: { type: "string", required: true } },
      indexes: [],
    } }],
  }, owner(SOURCE));
  platform.schema.apply(SOURCE, migration, owner(SOURCE));
  platform.data.create(SOURCE, "alerts", { title: "Whale swap" }, owner(SOURCE));
  platform.secrets.create(SOURCE, { name: "PRIVATE_KEY", value: "never-export-this-value", allowedPurposes: ["function"] }, owner(SOURCE));

  const backup = platform.backups.create(SOURCE, owner(SOURCE));
  assert.match(backup.checksum, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(backup).includes("never-export-this-value"), false);
  const preview = platform.backups.previewRestore(backup.id, RESTORE, owner(RESTORE));
  assert.equal(preview.targetEnvironment, "preview");
  assert.equal(preview.secretReferencesRequireRotation, 1);
  assert.deepEqual(preview.omittedComponents, ["auth-sessions", "function-manifests", "job-metadata", "object-bytes", "secret-values", "webhook-configuration"]);
  assert.ok(preview.warnings.every((warning) => typeof warning === "string" && warning.length > 0));
  platform.backups.restore(backup.id, RESTORE, owner(RESTORE));
  assert.equal(platform.data.query(RESTORE, "alerts", { filters: [], limit: 10 }, owner(RESTORE)).rows[0].title, "Whale swap");
  assert.equal(platform.secrets.list(RESTORE, owner(RESTORE))[0].status, "rotation-required");
  const restoredSecret = platform.secrets.list(RESTORE, owner(RESTORE))[0];
  assert.equal(platform.secrets.rotate(RESTORE, restoredSecret.id, "rotated-secret-value", owner(RESTORE)).currentVersion, 1);
  platform.secrets.revoke(RESTORE, restoredSecret.id, owner(RESTORE));
  assert.equal(platform.secrets.list(RESTORE, owner(RESTORE))[0].status, "revoked");

  assert.throws(() => platform.backups.restore(backup.id, managed.managedScope({ ...SOURCE, environment: "production" }), owner(managed.managedScope({ ...SOURCE, environment: "production" }))), /approval/i);
});
