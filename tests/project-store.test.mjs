import assert from "node:assert/strict";
import test from "node:test";

function project(id, updatedAt, name = id) {
  return {
    id,
    updatedAt,
    createdAt: "2026-07-30T00:00:00.000Z",
    html: `<html>${name}</html>`,
    spec: { name, slug: name.toLowerCase(), presetId: "action-engine" },
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function quotaStorage(initial, maxCharacters) {
  const storage = memoryStorage(initial);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    const nextValue = String(value);
    const nextSize = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((candidate) => candidate && candidate !== key)
      .reduce((total, candidate) => total + candidate.length + (storage.getItem(candidate)?.length ?? 0), 0)
      + key.length
      + nextValue.length;
    if (nextSize > maxCharacters) {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    setItem(key, nextValue);
  };
  return storage;
}

test("project store merges another tab's projects while holding a Web Lock", async () => {
  const store = await import("../lib/project-store.ts");
  assert.equal(typeof store.saveProjectSafely, "function");
  const first = project("project-a", "2026-07-30T00:01:00.000Z");
  const second = project("project-b", "2026-07-30T00:02:00.000Z");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([first]),
  });
  let lockCalls = 0;
  const locks = {
    async request(name, options, callback) {
      lockCalls += 1;
      assert.equal(name, "drops-studio-project-store");
      assert.equal(options.mode, "exclusive");
      return callback();
    },
  };

  const result = await store.saveProjectSafely(second, {
    storage,
    locks,
    expectedUpdatedAt: null,
  });

  assert.equal(result.status, "saved");
  assert.equal(lockCalls, 1);
  assert.deepEqual(
    store.readProjectsFromStore(storage).map((item) => item.id).sort(),
    ["project-a", "project-b"],
  );
  assert.deepEqual(
    JSON.parse(storage.getItem("drops-studio-projects-v2")).map((item) => item.id).sort(),
    ["project-a", "project-b"],
  );
});

test("project store surfaces a same-project conflict instead of overwriting the newer tab", async () => {
  const store = await import("../lib/project-store.ts");
  const newer = project("project-a", "2026-07-30T00:03:00.000Z", "newer tab");
  const staleEdit = project("project-a", "2026-07-30T00:04:00.000Z", "stale edit");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([newer]),
  });

  const result = await store.saveProjectSafely(staleEdit, {
    storage,
    expectedUpdatedAt: "2026-07-30T00:01:00.000Z",
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.current?.spec.name, "newer tab");
  assert.equal(store.readProjectsFromStore(storage)[0].spec.name, "newer tab");
});

test("project store fallback preserves projects through versioned per-project records", async () => {
  const store = await import("../lib/project-store.ts");
  const first = project("project-a", "2026-07-30T00:01:00.000Z");
  const second = project("project-b", "2026-07-30T00:02:00.000Z");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([first]),
  });

  await store.saveProjectSafely(second, { storage, expectedUpdatedAt: null });
  storage.setItem("drops-studio-projects-v2", JSON.stringify([first]));

  assert.deepEqual(
    store.readProjectsFromStore(storage).map((item) => item.id).sort(),
    ["project-a", "project-b"],
  );
});

test("project store compacts the compatibility index before writing a large Project V2 record", async () => {
  const store = await import("../lib/project-store.ts");
  const first = {
    ...project("project-a", "2026-07-30T00:01:00.000Z"),
    projectV2: {
      schemaVersion: 2,
      id: "project-a",
      revision: 1,
      files: {
        "app/page.tsx": {
          path: "app/page.tsx",
          content: "x".repeat(6_000),
          encoding: "utf-8",
          hash: "test-hash",
          generated: true,
          editable: true,
        },
      },
    },
  };
  const legacyValue = JSON.stringify([first]);
  const storage = quotaStorage(
    { "drops-studio-projects-v2": legacyValue },
    legacyValue.length + 1_500,
  );
  const updated = {
    ...first,
    updatedAt: "2026-07-30T00:02:00.000Z",
    projectV2: { ...first.projectV2, revision: 2 },
  };

  const result = await store.saveProjectSafely(updated, {
    storage,
    expectedUpdatedAt: first.updatedAt,
  });

  assert.equal(result.status, "saved");
  const compatibilityIndex = JSON.parse(storage.getItem("drops-studio-projects-v2"));
  assert.equal(compatibilityIndex[0].projectV2, undefined);
  const item = JSON.parse(
    storage.getItem(`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(first.id)}`),
  );
  assert.equal(item.project.projectV2.revision, 2);
  assert.equal(store.readProjectsFromStore(storage)[0].projectV2.revision, 2);
});

test("project store keeps the newest copy when the legacy index and item record disagree", async () => {
  const store = await import("../lib/project-store.ts");
  const newer = project("project-a", "2026-07-30T00:03:00.000Z", "new legacy copy");
  const stale = project("project-a", "2026-07-30T00:01:00.000Z", "stale item copy");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([newer]),
    [`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(stale.id)}`]: JSON.stringify({
      schemaVersion: 1,
      version: 2,
      project: stale,
    }),
  });

  const projects = store.readProjectsFromStore(storage);

  assert.equal(projects.length, 1);
  assert.equal(projects[0].spec.name, "new legacy copy");
});

test("project store prunes evicted item records and cannot resurrect projects beyond its limit", async () => {
  const store = await import("../lib/project-store.ts");
  const existing = Array.from({ length: store.PROJECT_STORE_LIMIT }, (_, index) =>
    project(
      `project-${index}`,
      new Date(Date.parse("2026-07-30T00:00:00.000Z") + index * 1_000).toISOString(),
    ));
  const initial = {
    "drops-studio-projects-v2": JSON.stringify(existing),
  };
  for (const item of existing) {
    initial[`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(item.id)}`] = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      project: item,
    });
  }
  const storage = memoryStorage(initial);
  const newest = project("project-new", "2026-07-30T01:00:00.000Z");

  const result = await store.saveProjectSafely(newest, {
    storage,
    expectedUpdatedAt: null,
  });

  assert.equal(result.status, "saved");
  assert.equal(result.projects.length, store.PROJECT_STORE_LIMIT);
  assert.equal(
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key) => key?.startsWith(store.PROJECT_STORE_ITEM_PREFIX)).length,
    store.PROJECT_STORE_LIMIT,
  );
  assert.equal(
    storage.getItem(`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent("project-0")}`),
    null,
  );
  assert.equal(store.readProjectsFromStore(storage).some((item) => item.id === "project-0"), false);
});

test("project store reports quota failures and rolls back the partial item write", async () => {
  const store = await import("../lib/project-store.ts");
  const first = project("project-a", "2026-07-30T00:01:00.000Z");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([first]),
  });
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === "drops-studio-projects-v2") {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    setItem(key, value);
  };
  const second = project("project-b", "2026-07-30T00:02:00.000Z");

  await assert.rejects(
    store.saveProjectSafely(second, { storage, expectedUpdatedAt: null }),
    /could not be saved.*storage.*full/i,
  );

  assert.equal(
    storage.getItem(`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(second.id)}`),
    null,
  );
  assert.deepEqual(JSON.parse(storage.getItem("drops-studio-projects-v2")), [first]);
});

test("project store deletes a project atomically while holding the shared Web Lock", async () => {
  const store = await import("../lib/project-store.ts");
  const first = project("project-a", "2026-07-30T00:01:00.000Z");
  const second = project("project-b", "2026-07-30T00:02:00.000Z");
  const storage = memoryStorage({
    "drops-studio-projects-v2": JSON.stringify([first, second]),
    [`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(first.id)}`]: JSON.stringify({
      schemaVersion: 1,
      version: 1,
      project: first,
    }),
  });
  let lockCalls = 0;
  const locks = {
    async request(name, options, callback) {
      lockCalls += 1;
      assert.equal(name, store.PROJECT_STORE_LOCK_NAME);
      assert.equal(options.mode, "exclusive");
      return callback();
    },
  };

  const result = await store.deleteProjectSafely(first.id, {
    storage,
    locks,
    expectedUpdatedAt: first.updatedAt,
  });

  assert.equal(result.status, "deleted");
  assert.equal(lockCalls, 1);
  assert.equal(storage.getItem(`${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(first.id)}`), null);
  assert.deepEqual(store.readProjectsFromStore(storage).map((item) => item.id), [second.id]);
});

test("project store refuses stale deletion and rolls back an interrupted deletion", async () => {
  const store = await import("../lib/project-store.ts");
  const current = project("project-a", "2026-07-30T00:03:00.000Z");
  const itemKey = `${store.PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(current.id)}`;
  const itemValue = JSON.stringify({ schemaVersion: 1, version: 2, project: current });
  const indexValue = JSON.stringify([current]);
  const storage = memoryStorage({
    "drops-studio-projects-v2": indexValue,
    [itemKey]: itemValue,
  });

  const conflict = await store.deleteProjectSafely(current.id, {
    storage,
    locks: null,
    expectedUpdatedAt: "2026-07-30T00:01:00.000Z",
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(storage.getItem(itemKey), itemValue);

  const setItem = storage.setItem.bind(storage);
  let rejectIndexWrite = true;
  storage.setItem = (key, value) => {
    if (key === "drops-studio-projects-v2" && rejectIndexWrite) {
      rejectIndexWrite = false;
      throw new Error("interrupted write");
    }
    setItem(key, value);
  };
  await assert.rejects(
    store.deleteProjectSafely(current.id, {
      storage,
      locks: null,
      expectedUpdatedAt: current.updatedAt,
    }),
    /could not be deleted/i,
  );
  assert.equal(storage.getItem(itemKey), itemValue);
  assert.equal(storage.getItem("drops-studio-projects-v2"), indexValue);
});
