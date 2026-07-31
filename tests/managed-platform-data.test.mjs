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

const DEV = managed.managedScope({
  organizationId: "org-alpha",
  workspaceId: "workspace-research",
  projectId: "team-whale-intelligence",
  environment: "development",
});
const PREVIEW = managed.managedScope({ ...DEV, environment: "preview" });
const PROD = managed.managedScope({ ...DEV, environment: "production" });

function owner(scope = DEV, actorId = "owner-1") {
  return managed.managedPrincipal({
    actorId,
    actorType: "user",
    scope,
    roles: ["owner"],
    permissions: ["backend.schema.manage", "backend.data.read", "backend.data.write", "backend.data.admin", "backend.backups.manage"],
  });
}

function member(scope = DEV, actorId = "member-1") {
  return managed.managedPrincipal({
    actorId,
    actorType: "user",
    scope,
    roles: ["developer"],
    permissions: ["backend.data.read", "backend.data.write"],
  });
}

function watchlistMigration(baseVersion = 0) {
  return {
    baseVersion,
    operations: [{
      kind: "create-collection",
      collection: {
        name: "watchlists",
        rowPolicy: "owner",
        fields: {
          name: { type: "string", required: true },
          enabled: { type: "boolean", required: true, default: true },
          tags: { type: "json", required: false },
        },
        indexes: [{ name: "watchlists_owner_name", fields: ["_ownerId", "name"], unique: true }],
      },
    }],
  };
}

test("schema migrations are versioned, environment-isolated, and production protected", () => {
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 7),
    encryptionKey: Buffer.alloc(32, 9),
  });
  platform.environments.ensure(DEV, owner());
  platform.environments.ensure(PREVIEW, owner(PREVIEW));
  platform.environments.ensure(PROD, owner(PROD));

  const plan = platform.schema.plan(DEV, watchlistMigration(), owner());
  assert.equal(plan.fromVersion, 0);
  assert.equal(plan.toVersion, 1);
  assert.equal(plan.requiresApproval, false);
  const applied = platform.schema.apply(DEV, plan, owner());
  assert.equal(applied.version, 1);
  assert.ok(applied.collections.watchlists);
  assert.equal(platform.schema.snapshot(PREVIEW, owner(PREVIEW)).version, 0);

  const productionPlan = platform.schema.plan(PROD, watchlistMigration(), owner(PROD));
  assert.equal(productionPlan.requiresApproval, true);
  assert.throws(() => platform.schema.apply(PROD, productionPlan, owner(PROD)), /approval/i);
  assert.equal(platform.schema.apply(PROD, productionPlan, owner(PROD), { approvalReceipt: "approval_prod_20260730" }).version, 1);

  assert.throws(() => platform.schema.apply(DEV, plan, owner()), /stale/i);
});

test("CRUD enforces schema, row scope, idempotency, revisions, and bounded queries", () => {
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 7),
    encryptionKey: Buffer.alloc(32, 9),
    limits: { maxRowsPerEnvironment: 10, maxQueryComplexity: 8 },
  });
  platform.environments.ensure(DEV, owner());
  platform.schema.apply(DEV, platform.schema.plan(DEV, watchlistMigration(), owner()), owner());

  const alice = member(DEV, "alice");
  const bob = member(DEV, "bob");
  const created = platform.data.create(DEV, "watchlists", { name: "Whales", enabled: true }, alice, { idempotencyKey: "idem_watchlist_alice_1" });
  const duplicate = platform.data.create(DEV, "watchlists", { name: "Whales", enabled: true }, alice, { idempotencyKey: "idem_watchlist_alice_1" });
  assert.deepEqual(duplicate, created);
  assert.equal(created._revision, 1);
  assert.equal(created._ownerId, "alice");

  assert.throws(() => platform.data.read(DEV, "watchlists", created._id, bob), /row scope/i);
  assert.equal(platform.data.query(DEV, "watchlists", { filters: [], limit: 20 }, bob).rows.length, 0);
  assert.equal(platform.data.read(DEV, "watchlists", created._id, owner()).name, "Whales");

  const updated = platform.data.update(DEV, "watchlists", created._id, { name: "Smart money" }, alice, { expectedRevision: 1, idempotencyKey: "idem_watchlist_update_1" });
  assert.equal(updated._revision, 2);
  assert.equal(updated.name, "Smart money");
  assert.throws(() => platform.data.update(DEV, "watchlists", created._id, { name: "Stale" }, alice, { expectedRevision: 1 }), /revision conflict/i);
  assert.throws(() => platform.data.create(DEV, "watchlists", { name: "Smart money", enabled: true }, alice), /unique/i);
  assert.throws(() => platform.data.create(DEV, "watchlists", { name: "Bad", enabled: "yes" }, alice), /boolean/i);
  assert.throws(() => platform.data.query(DEV, "watchlists", {
    filters: Array.from({ length: 9 }, (_, index) => ({ field: "name", operator: "eq", value: `x-${index}` })),
    limit: 20,
  }, alice), /complexity/i);

  assert.throws(() => platform.data.read(PREVIEW, "watchlists", created._id, member(PREVIEW, "alice")), /environment|collection/i);
});

test("provider descriptors never claim D1 or Postgres is working without a configured driver", () => {
  assert.deepEqual(managed.describeD1ManagedProvider(), {
    kind: "d1-drizzle",
    status: "setup-required",
    reasonCode: "D1_BINDING_REQUIRED",
  });
  assert.deepEqual(managed.describePostgresManagedProvider(), {
    kind: "postgres-drizzle",
    status: "setup-required",
    reasonCode: "DATABASE_URL_AND_DRIVER_REQUIRED",
  });
});

test("create enforces roles row policy before persisting a record", () => {
  const platform = managed.createInMemoryManagedPlatform({ signingKey: Buffer.alloc(32, 7), encryptionKey: Buffer.alloc(32, 9) });
  platform.environments.ensure(DEV, owner());
  const plan = platform.schema.plan(DEV, {
    baseVersion: 0,
    operations: [{ kind: "create-collection", collection: {
      name: "operatorNotes",
      rowPolicy: "roles",
      allowedRoles: ["analyst"],
      fields: { body: { type: "text", required: true } },
      indexes: [],
    } }],
  }, owner());
  platform.schema.apply(DEV, plan, owner());

  assert.throws(
    () => platform.data.create(DEV, "operatorNotes", { body: "must not persist" }, member()),
    /row scope|denied/i,
  );
  assert.equal(platform.data.query(DEV, "operatorNotes", { limit: 10 }, owner()).rows.length, 0);
});

test("sparse unique indexes allow missing values but reject equal defined values", () => {
  const platform = managed.createInMemoryManagedPlatform({ signingKey: Buffer.alloc(32, 7), encryptionKey: Buffer.alloc(32, 9) });
  platform.environments.ensure(DEV, owner());
  const plan = platform.schema.plan(DEV, {
    baseVersion: 0,
    operations: [{ kind: "create-collection", collection: {
      name: "walletAliases",
      rowPolicy: "project",
      fields: {
        label: { type: "string", required: true },
        address: { type: "string" },
      },
      indexes: [{ name: "wallet_alias_address", fields: ["address"], unique: true }],
    } }],
  }, owner());
  platform.schema.apply(DEV, plan, owner());

  platform.data.create(DEV, "walletAliases", { label: "First" }, member());
  platform.data.create(DEV, "walletAliases", { label: "Second" }, member());
  platform.data.create(DEV, "walletAliases", { label: "Tracked", address: "0xabc" }, member());
  assert.throws(() => platform.data.create(DEV, "walletAliases", { label: "Duplicate", address: "0xabc" }, member()), /unique/i);
});

test("numeric fields sort numerically instead of lexicographically", () => {
  const platform = managed.createInMemoryManagedPlatform({ signingKey: Buffer.alloc(32, 7), encryptionKey: Buffer.alloc(32, 9) });
  platform.environments.ensure(DEV, owner());
  const plan = platform.schema.plan(DEV, {
    baseVersion: 0,
    operations: [{ kind: "create-collection", collection: {
      name: "rankedSignals",
      rowPolicy: "project",
      fields: { score: { type: "float", required: true } },
      indexes: [],
    } }],
  }, owner());
  platform.schema.apply(DEV, plan, owner());
  for (const score of [10, 2, 1]) platform.data.create(DEV, "rankedSignals", { score }, member());

  assert.deepEqual(
    platform.data.query(DEV, "rankedSignals", { sort: [{ field: "score", direction: "asc" }], limit: 10 }, member()).rows.map((row) => row.score),
    [1, 2, 10],
  );
});

test("provider health verification returns a bounded timeout status", async () => {
  const never = new Promise(() => {});
  const driver = {
    kind: "d1-drizzle",
    transaction: async (_scope, operation) => operation({ execute: async () => ({ rows: [], affectedRows: 0 }) }),
    health: () => never,
  };
  const status = await Promise.race([
    managed.verifyD1ManagedProvider(driver, { timeoutMs: 5 }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("provider health check did not time out")), 30)),
  ]);
  assert.deepEqual(status, { kind: "d1-drizzle", status: "unavailable", reasonCode: "D1_HEALTH_TIMEOUT", latencyMs: 0 });
});
