import assert from "node:assert/strict";
import test from "node:test";
import { BlobError } from "@vercel/blob";

import {
  PostgresProjectDataBackend,
  ProjectDataError,
  ProjectDataStore,
  VercelBlobProjectDataBackend,
} from "../lib/project-data/index.ts";

function memorySql() {
  let row = null;
  const statements = [];
  return {
    statements,
    async query(statement, parameters = []) {
      const normalized = statement.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (
        normalized.startsWith("CREATE TABLE")
        || normalized.startsWith("DO $$")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("SELECT project_id")) {
        return row && row.project_key === parameters[0]
          ? { rows: [{ ...row }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("INSERT INTO")) {
        if (row) return { rows: [], rowCount: 0 };
        row = {
          project_key: parameters[0],
          project_id: parameters[1],
          store_revision: parameters[2],
          snapshot_json: parameters[3],
          deleted: false,
          updated_at: new Date("2026-07-31T00:00:00.000Z"),
        };
        return { rows: [{ store_revision: row.store_revision }], rowCount: 1 };
      }
      if (normalized.includes("SET store_revision = $3, snapshot_json = NULL, deleted = TRUE")) {
        if (
          !row
          || row.project_key !== parameters[0]
          || row.project_id !== parameters[1]
          || row.store_revision !== parameters[3]
          || row.deleted
        ) {
          return { rows: [], rowCount: 0 };
        }
        row = {
          ...row,
          store_revision: parameters[2],
          snapshot_json: null,
          deleted: true,
        };
        return { rows: [{ store_revision: row.store_revision }], rowCount: 1 };
      }
      if (normalized.includes("deleted = FALSE")) {
        if (
          !row
          || row.project_key !== parameters[0]
          || row.project_id !== parameters[1]
          || row.store_revision !== parameters[4]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row = {
          ...row,
          store_revision: parameters[2],
          snapshot_json: parameters[3],
          deleted: false,
        };
        return { rows: [{ store_revision: row.store_revision }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in durable project-data test: ${normalized}`);
    },
  };
}

test("Postgres project data preserves internal document keys through text snapshots", async () => {
  const sql = memorySql();
  const backend = new PostgresProjectDataBackend(sql);
  const store = new ProjectDataStore(backend, {
    now: () => "2026-07-31T00:00:00.000Z",
  });

  const created = await store.create({
    projectId: "project-postgres",
    namespace: "wallet-events",
    id: "swap-1",
    data: { chain: "base", valueUsd: 250_000 },
  });
  const updated = await store.update({
    projectId: "project-postgres",
    namespace: "wallet-events",
    id: "swap-1",
    expectedRevision: created.revision,
    data: { chain: "base", valueUsd: 300_000 },
  });

  assert.equal(updated.revision, 2);
  assert.equal(
    (await store.get("project-postgres", "wallet-events", "swap-1"))?.data.valueUsd,
    300_000,
  );
  assert.ok(sql.statements.some((statement) => statement.startsWith("DO $$")));
  assert.ok(sql.statements.every((statement) => !statement.includes("$4::jsonb")));
});

test("Postgres project data rejects stale revisions and leaves a tombstone on cleanup", async () => {
  const sql = memorySql();
  const backend = new PostgresProjectDataBackend(sql);
  const store = new ProjectDataStore(backend);
  await store.create({
    projectId: "project-conflict",
    namespace: "settings",
    id: "theme",
    data: { mode: "dark" },
  });

  await assert.rejects(
    backend.compareAndSwap("project-conflict", 0, {
      schemaVersion: 1,
      projectId: "project-conflict",
      storeRevision: 1,
      documents: {},
    }),
    (error) => error instanceof ProjectDataError && error.code === "conflict",
  );

  const current = await backend.read("project-conflict");
  await backend.deleteProject("project-conflict", current.storeRevision);
  assert.equal(await backend.read("project-conflict"), null);
});

test("Postgres project data can revive a tombstone only with its exact revision", async () => {
  const backend = new PostgresProjectDataBackend(memorySql());
  const store = new ProjectDataStore(backend);
  await store.create({
    projectId: "project-revive",
    namespace: "settings",
    id: "theme",
    data: { mode: "dark" },
  });
  await backend.deleteProject("project-revive", 1);

  await assert.rejects(
    backend.compareAndSwap("project-revive", 0, {
      schemaVersion: 1,
      projectId: "project-revive",
      storeRevision: 1,
      documents: {},
    }),
    (error) => error instanceof ProjectDataError
      && error.code === "conflict"
      && error.currentRevision === 2,
  );

  await backend.compareAndSwap("project-revive", 2, {
    schemaVersion: 1,
    projectId: "project-revive",
    storeRevision: 3,
    documents: {},
  });
  assert.equal((await backend.read("project-revive"))?.storeRevision, 3);
});

test("Postgres project data treats a repeated revision-matched tombstone delete as idempotent", async () => {
  const backend = new PostgresProjectDataBackend(memorySql());
  const store = new ProjectDataStore(backend);
  await store.create({
    projectId: "project-idempotent-delete",
    namespace: "settings",
    id: "theme",
    data: { mode: "dark" },
  });
  await backend.deleteProject("project-idempotent-delete", 1);
  await backend.deleteProject("project-idempotent-delete", 2);
});

test("private Blob first-write collisions surface as revision conflicts", async () => {
  const projectId = "project-blob-race";
  const existing = {
    schemaVersion: 1,
    projectId,
    storeRevision: 1,
    deleted: false,
    snapshot: {
      schemaVersion: 1,
      projectId,
      storeRevision: 1,
      documents: {},
    },
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
  let reads = 0;
  const backend = new VercelBlobProjectDataBackend({
    async get() {
      reads += 1;
      if (reads === 1) return null;
      return {
        statusCode: 200,
        stream: new Response(JSON.stringify(existing)).body,
        blob: { etag: "race-winner" },
      };
    },
    async put() {
      throw new BlobError("blob already exists");
    },
    async del() {},
  });

  await assert.rejects(
    backend.compareAndSwap(projectId, 0, {
      schemaVersion: 1,
      projectId,
      storeRevision: 1,
      documents: {},
    }),
    (error) => error instanceof ProjectDataError
      && error.code === "conflict"
      && error.currentRevision === 1,
  );
});
