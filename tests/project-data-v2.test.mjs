import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server.js";

import {
  MemoryProjectDataBackend,
  ProjectDataError,
  ProjectDataStore,
  WebStorageProjectDataBackend,
  createProjectDataCapability,
  verifyProjectDataCapability,
} from "../lib/project-data/index.ts";

const secret = "project-data-test-secret-that-is-longer-than-thirty-two-bytes";
const now = Date.parse("2026-07-30T00:00:00.000Z");

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

test("project-data capabilities are project, namespace, permission, and expiry scoped", () => {
  const capability = createProjectDataCapability({
    projectId: "project-alpha",
    subject: "member-1",
    namespaces: ["events", "settings"],
    permissions: ["read", "write"],
    issuedAt: now,
    expiresAt: now + 60_000,
    nonce: "nonce-alpha-123456",
  }, secret);
  const verified = verifyProjectDataCapability(capability, secret, now + 1_000);
  assert.equal(verified?.projectId, "project-alpha");
  assert.deepEqual(verified?.namespaces, ["events", "settings"]);
  assert.deepEqual(verified?.permissions, ["read", "write"]);
  assert.equal(verifyProjectDataCapability(`${capability}tampered`, secret, now + 1_000), null);
  assert.equal(verifyProjectDataCapability(capability, secret, now + 60_001), null);
});

test("project-data store provides isolated CRUD with optimistic document revisions", async () => {
  const store = new ProjectDataStore(new MemoryProjectDataBackend(), {
    now: () => "2026-07-30T00:00:00.000Z",
  });
  const created = await store.create({
    projectId: "project-a",
    namespace: "events",
    id: "evt-1",
    data: { kind: "swap", valueUsd: 275_000 },
  });
  assert.equal(created.revision, 1);
  assert.deepEqual((await store.get("project-a", "events", "evt-1"))?.data, created.data);
  assert.equal(await store.get("project-b", "events", "evt-1"), null);

  const updated = await store.update({
    projectId: "project-a",
    namespace: "events",
    id: "evt-1",
    expectedRevision: 1,
    data: { kind: "swap", valueUsd: 300_000 },
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    store.update({
      projectId: "project-a",
      namespace: "events",
      id: "evt-1",
      expectedRevision: 1,
      data: { stale: true },
    }),
    (error) => error instanceof ProjectDataError && error.code === "conflict",
  );
  await store.delete("project-a", "events", "evt-1", 2);
  assert.equal(await store.get("project-a", "events", "evt-1"), null);
});

test("project-data quotas and secret scanning fail before persistence", async () => {
  const store = new ProjectDataStore(new MemoryProjectDataBackend(), {
    quotas: { maxDocumentsPerNamespace: 1, maxDocumentBytes: 256, maxProjectBytes: 512 },
  });
  await store.create({ projectId: "p", namespace: "items", id: "one", data: { value: 1 } });
  await assert.rejects(
    store.create({ projectId: "p", namespace: "items", id: "two", data: { value: 2 } }),
    (error) => error instanceof ProjectDataError && error.code === "quota_exceeded",
  );
  await assert.rejects(
    store.create({
      projectId: "p",
      namespace: "other",
      id: "secret",
      data: { apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
    }),
    (error) => error instanceof ProjectDataError && error.code === "secret_rejected",
  );
});

test("web-storage fallback preserves revisions without crossing project keys", async () => {
  const storage = memoryStorage();
  const first = new ProjectDataStore(new WebStorageProjectDataBackend(storage));
  await first.create({ projectId: "project-a", namespace: "settings", id: "theme", data: { mode: "dark" } });
  const second = new ProjectDataStore(new WebStorageProjectDataBackend(storage));
  assert.equal((await second.get("project-a", "settings", "theme"))?.revision, 1);
  assert.equal(await second.get("project-b", "settings", "theme"), null);
});

test("same-origin project-data route enforces capability scope and CAS", async () => {
  const previous = {
    secret: process.env.PROJECT_DATA_CAPABILITY_SECRET,
    local: process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA,
  };
  process.env.PROJECT_DATA_CAPABILITY_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA = "1";
  globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__ = undefined;
  try {
    const route = await import(`../app/api/project-data/route.ts?test=${Date.now()}`);
    const capability = createProjectDataCapability({
      projectId: "route-project",
      subject: "generated-app",
      namespaces: ["events"],
      permissions: ["read", "write", "delete"],
      issuedAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
      nonce: "route-capability-1234",
    }, secret);
    const headers = {
      authorization: `Bearer ${capability}`,
      "content-type": "application/json",
      origin: "https://studio.example",
      "sec-fetch-site": "same-origin",
    };

    const createdResponse = await route.POST(new NextRequest("https://studio.example/api/project-data", {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId: "route-project",
        namespace: "events",
        id: "evt-1",
        data: { kind: "swap" },
      }),
    }));
    assert.equal(createdResponse.status, 201);
    assert.equal((await createdResponse.json()).document.revision, 1);

    const readResponse = await route.GET(new NextRequest(
      "https://studio.example/api/project-data?projectId=route-project&namespace=events&id=evt-1",
      { headers: { authorization: `Bearer ${capability}` } },
    ));
    assert.equal(readResponse.status, 200);
    assert.equal((await readResponse.json()).document.id, "evt-1");

    const staleResponse = await route.PUT(new NextRequest("https://studio.example/api/project-data", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        projectId: "route-project",
        namespace: "events",
        id: "evt-1",
        expectedRevision: 0,
        data: { kind: "transfer" },
      }),
    }));
    assert.equal(staleResponse.status, 409);

    const crossOrigin = await route.POST(new NextRequest("https://studio.example/api/project-data", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({
        projectId: "route-project",
        namespace: "events",
        id: "evt-2",
        data: { kind: "swap" },
      }),
    }));
    assert.equal(crossOrigin.status, 403);

    const wrongProject = await route.GET(new NextRequest(
      "https://studio.example/api/project-data?projectId=another-project&namespace=events",
      { headers: { authorization: `Bearer ${capability}` } },
    ));
    assert.equal(wrongProject.status, 403);
  } finally {
    globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__ = undefined;
    if (previous.secret === undefined) delete process.env.PROJECT_DATA_CAPABILITY_SECRET;
    else process.env.PROJECT_DATA_CAPABILITY_SECRET = previous.secret;
    if (previous.local === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA = previous.local;
  }
});

test("project-data capabilities receive a bounded per-capability request budget", async () => {
  const previous = {
    secret: process.env.PROJECT_DATA_CAPABILITY_SECRET,
    localData: process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA,
    localProject: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    vercel: process.env.VERCEL,
  };
  process.env.PROJECT_DATA_CAPABILITY_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA = "1";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__ = undefined;
  try {
    const route = await import(`../app/api/project-data/route.ts?rate=${Date.now()}`);
    const input = {
      projectId: "rate-project",
      subject: "generated-app-rate-subject",
      namespaces: ["events"],
      permissions: ["read"],
      issuedAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
      nonce: "route-rate-capability-1234",
    };
    const capability = createProjectDataCapability(input, secret);
    const identity = createHash("sha256")
      .update(`project-data:v1:${input.subject}:${input.projectId}:${input.nonce}`, "utf8")
      .digest("hex");
    const windowMs = 60 * 60 * 1_000;
    const bucket = Math.floor(Date.now() / windowMs);
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([[
      `project-data-read:${bucket}:${identity}`,
      { count: 600, expiresAt: (bucket + 1) * windowMs },
    ]]);
    const response = await route.GET(new NextRequest(
      "https://studio.example/api/project-data?projectId=rate-project&namespace=events",
      { headers: { authorization: `Bearer ${capability}` } },
    ));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "rate_limited");
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    globalThis.__DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__ = undefined;
    if (previous.secret === undefined) delete process.env.PROJECT_DATA_CAPABILITY_SECRET;
    else process.env.PROJECT_DATA_CAPABILITY_SECRET = previous.secret;
    if (previous.localData === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_DATA = previous.localData;
    if (previous.localProject === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previous.localProject;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
  }
});
