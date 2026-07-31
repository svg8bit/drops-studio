import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href,
    };
  },
});

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const {
  deleteProjectV2Snapshot,
  projectV2SnapshotStorageConfigured,
  readProjectV2Snapshot,
  writeProjectV2Snapshot,
} = await import("../db/project-v2-snapshots.ts");

const identity = "a".repeat(64);

test("Vercel runtime recognizes Blob OIDC supplied through request context", () => {
  const previous = {
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    VERCEL: process.env.VERCEL,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
  };
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  process.env.BLOB_STORE_ID = "store_request_oidc";
  process.env.VERCEL = "1";
  try {
    assert.equal(projectV2SnapshotStorageConfigured(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function project() {
  const spec = createProjectSpec({
    presetId: "alpha-channel",
    values: {},
    prompt: "Build a sourced AI alpha channel",
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops.example",
  });
  return materializeProjectV2Template({
    id: "project-v2-storage",
    spec,
    now: "2026-07-30T12:00:00.000Z",
  });
}

async function withLocalStorage(run) {
  const previous = {
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__ = new Map();
  try {
    await run();
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__ = undefined;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function postgresSnapshotClient() {
  const rows = new Map();
  return {
    async query(statement, parameters = []) {
      if (/CREATE TABLE/i.test(statement)) return { rows: [], rowCount: 0 };
      const key = `${parameters[0]}:${parameters[1]}`;
      if (/^SELECT/i.test(statement.trim())) {
        const row = rows.get(key);
        return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (/^INSERT/i.test(statement.trim())) {
        if (rows.has(key)) return { rows: [], rowCount: 0 };
        const row = {
          storage_revision: Number(parameters[2]),
          snapshot_json: String(parameters[3]),
          updated_at: new Date("2026-07-31T08:00:00.000Z"),
        };
        rows.set(key, row);
        return { rows: [{ storage_revision: row.storage_revision }], rowCount: 1 };
      }
      if (/^UPDATE/i.test(statement.trim())) {
        const current = rows.get(key);
        if (!current || current.storage_revision !== Number(parameters[4])) {
          return { rows: [], rowCount: 0 };
        }
        const row = {
          storage_revision: Number(parameters[2]),
          snapshot_json: String(parameters[3]),
          updated_at: new Date("2026-07-31T08:01:00.000Z"),
        };
        rows.set(key, row);
        return { rows: [{ storage_revision: row.storage_revision }], rowCount: 1 };
      }
      if (/^DELETE/i.test(statement.trim())) {
        const deleted = rows.delete(key);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
}

test("private Project V2 snapshots use optimistic storage revisions", async () => {
  await withLocalStorage(async () => {
    const source = await project();
    const first = await writeProjectV2Snapshot(identity, source, 0);
    assert.equal(first.status, "saved");
    assert.equal(first.storageRevision, 1);

    const conflict = await writeProjectV2Snapshot(identity, source, 0);
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.storageRevision, 1);

    const stored = await readProjectV2Snapshot(identity, source.id);
    assert.equal(stored.storageRevision, 1);
    assert.equal(stored.project.contentHash, source.contentHash);

    await deleteProjectV2Snapshot(identity, source.id);
    assert.equal(await readProjectV2Snapshot(identity, source.id), null);
  });
});

test("private Project V2 snapshots use transactional Postgres CAS when configured", async () => {
  const source = await project();
  const sql = postgresSnapshotClient();

  const first = await writeProjectV2Snapshot(identity, source, 0, undefined, sql);
  assert.equal(first.status, "saved");
  assert.equal(first.storageRevision, 1);

  const second = await writeProjectV2Snapshot(identity, source, 1, undefined, sql);
  assert.equal(second.status, "saved");
  assert.equal(second.storageRevision, 2);

  const conflict = await writeProjectV2Snapshot(identity, source, 1, undefined, sql);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.storageRevision, 2);

  const stored = await readProjectV2Snapshot(identity, source.id, undefined, sql);
  assert.equal(stored.storageRevision, 2);
  assert.equal(stored.project.contentHash, source.contentHash);

  await deleteProjectV2Snapshot(identity, source.id, undefined, sql);
  assert.equal(await readProjectV2Snapshot(identity, source.id, undefined, sql), null);
});

test("private Project V2 snapshots revalidate file integrity and reject secret-bearing source", async () => {
  await withLocalStorage(async () => {
    const source = await project();
    const tampered = structuredClone(source);
    tampered.files["app/page.tsx"].content += "\n// tampered without a new hash";
    await assert.rejects(
      () => writeProjectV2Snapshot(identity, tampered, 0),
      /hash|byte|content/i,
    );

    const secret = structuredClone(source);
    secret.files["app/page.tsx"].content += "\n// ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    await assert.rejects(
      () => writeProjectV2Snapshot(identity, secret, 0),
      /secret|credential|artifact|hash/i,
    );
  });
});
