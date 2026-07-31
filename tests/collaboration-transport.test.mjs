import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server.js";

import {
  COLLABORATION_MAX_EVENT_PAYLOAD_BYTES,
  CollaborationTransport,
  CollaborationTransportError,
} from "../lib/collaboration-transport.ts";
import { MemoryProjectDataBackend } from "../lib/project-data/backend.ts";
import {
  createStudioAccountCookie,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../lib/access-tier.ts";
import { createCollaborationRouteHandlers } from "../lib/collaboration-transport-route.ts";

const COOKIE_SECRET = "collaboration-test-cookie-secret-000000000000000000";
const HEALTH_SECRET = "collaboration-test-health-secret-000000000000000000";
const SCOPE = { workspaceId: "workspace_test", projectId: "project_test" };

process.env.DROPS_ACCOUNT_COOKIE_SECRET = COOKIE_SECRET;

function appendInput(overrides = {}) {
  return {
    ...SCOPE,
    actorId: "account:openrouter:member-a",
    expectedRevision: 0,
    idempotencyKey: "event-key-0001",
    type: "document.patch",
    payload: { path: "app/page.tsx", patch: "bounded change" },
    ...overrides,
  };
}

function account(subject) {
  const cookie = createStudioAccountCookie({
    provider: "openrouter",
    subject,
    issuedAt: Math.floor(Date.now() / 1_000),
  }, COOKIE_SECRET);
  const resolved = resolveStudioAccount(cookie, {
    DROPS_ACCOUNT_COOKIE_SECRET: COOKIE_SECRET,
  });
  assert.ok(resolved);
  return { cookie, identity: resolved.identity };
}

function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", `${STUDIO_ACCOUNT_COOKIE}=${options.cookie}`);
  return new NextRequest(url, { ...options, headers });
}

function workspace(members) {
  return {
    id: SCOPE.workspaceId,
    ownerIdentity: members[0].identity,
    name: "Test workspace",
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    members: members.map((member) => ({
      ...member,
      joinedAt: "2026-07-31T00:00:00.000Z",
      consentedAt: "2026-07-31T00:00:00.000Z",
    })),
    invites: [],
    projects: [{ projectId: SCOPE.projectId }],
  };
}

test("collaboration transport appends ordered events and deduplicates retries", async () => {
  const transport = new CollaborationTransport(new MemoryProjectDataBackend());
  const first = await transport.append(appendInput());
  assert.equal(first.revision, 1);
  assert.equal(first.idempotent, false);

  const replay = await transport.append(appendInput({ expectedRevision: 0 }));
  assert.equal(replay.idempotent, true);
  assert.equal(replay.event.id, first.event.id);
  assert.equal(replay.revision, 1);

  const second = await transport.append(appendInput({
    actorId: "account:openrouter:member-b",
    expectedRevision: 1,
    idempotencyKey: "event-key-0002",
    type: "comment.create",
    payload: { body: "Review this change", file: "app/page.tsx" },
  }));
  assert.equal(second.revision, 2);

  const room = await transport.read(SCOPE, { afterRevision: 0, limit: 10 });
  assert.equal(room.revision, 2);
  assert.deepEqual(room.events.map((event) => event.revision), [1, 2]);
  assert.deepEqual(room.events.map((event) => event.actorId), [
    "account:openrouter:member-a",
    "account:openrouter:member-b",
  ]);
});

test("collaboration transport enforces optimistic revisions and idempotency ownership", async () => {
  const transport = new CollaborationTransport(new MemoryProjectDataBackend());
  await transport.append(appendInput());

  await assert.rejects(
    transport.append(appendInput({
      expectedRevision: 0,
      idempotencyKey: "event-key-stale",
    })),
    (error) => error instanceof CollaborationTransportError
      && error.code === "conflict"
      && error.currentRevision === 1,
  );
  await assert.rejects(
    transport.append(appendInput({ payload: { changed: true } })),
    (error) => error instanceof CollaborationTransportError
      && error.code === "conflict",
  );
});

test("collaboration transport rejects credential material and oversized payloads", async () => {
  const transport = new CollaborationTransport(new MemoryProjectDataBackend());
  await assert.rejects(
    transport.read({ workspaceId: undefined, projectId: SCOPE.projectId }),
    (error) => error instanceof CollaborationTransportError
      && error.code === "invalid_request",
  );
  await assert.rejects(
    transport.append(appendInput({
      payload: { apiKey: `sk-proj-${"a".repeat(40)}` },
    })),
    (error) => error instanceof CollaborationTransportError
      && error.code === "secret_rejected",
  );
  await assert.rejects(
    transport.append(appendInput({
      payload: { content: "x".repeat(COLLABORATION_MAX_EVENT_PAYLOAD_BYTES + 1) },
    })),
    (error) => error instanceof CollaborationTransportError
      && error.code === "quota_exceeded",
  );
});

test("collaboration transport retains a bounded ordered window", async () => {
  const transport = new CollaborationTransport(new MemoryProjectDataBackend());
  for (let revision = 0; revision < 40; revision += 1) {
    await transport.append(appendInput({
      expectedRevision: revision,
      idempotencyKey: `retention-key-${String(revision).padStart(4, "0")}`,
      payload: { revision: revision + 1 },
    }));
  }
  const room = await transport.read(SCOPE, { afterRevision: 0, limit: 50 });
  assert.equal(room.revision, 40);
  assert.equal(room.events.length, 32);
  assert.equal(room.retainedFromRevision, 9);
  assert.deepEqual(room.events.map((event) => event.revision), Array.from({ length: 32 }, (_, index) => index + 9));
});

test("live health proves two-actor durability, idempotency, order, and cleanup", async () => {
  class CountingBackend extends MemoryProjectDataBackend {
    deletes = 0;

    async deleteProject(projectId, expectedStoreRevision) {
      this.deletes += 1;
      return await super.deleteProject(projectId, expectedStoreRevision);
    }
  }
  const backend = new CountingBackend();
  const receipt = await new CollaborationTransport(backend).liveHealth();
  assert.equal(receipt.status, "working");
  assert.equal(receipt.mode, "memory-local-fallback");
  assert.deepEqual(receipt.evidence, [
    "collaboration-durable-write-live",
    "collaboration-durable-read-live",
    "collaboration-two-actor-order-live",
    "collaboration-idempotency-live",
    "collaboration-cleanup-live",
  ]);
  assert.equal(backend.deletes, 1);
});

test("canonical route enforces signed member cookie, same-origin writes, team RBAC, and shared project scope", async () => {
  const owner = account("owner-route-test");
  const editor = account("editor-route-test");
  const viewer = account("viewer-route-test");
  const team = workspace([
    { identity: owner.identity, role: "owner" },
    { identity: editor.identity, role: "editor" },
    { identity: viewer.identity, role: "viewer" },
  ]);
  const handlers = createCollaborationRouteHandlers({
    transport: new CollaborationTransport(new MemoryProjectDataBackend()),
    resolveWorkspace: async (_actorIdentity, workspaceId) => workspaceId === team.id ? team : null,
    enforceRateLimit: async () => {},
    requireWriteEntitlement: async () => {},
  });
  const body = {
    ...SCOPE,
    expectedRevision: 0,
    idempotencyKey: "route-event-0001",
    type: "document.patch",
    payload: { path: "app/page.tsx", patch: "route change" },
  };

  const unauthenticated = await handlers.POST(request(
    "https://drops.example/api/collaboration/transport",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify(body),
    },
  ));
  assert.equal(unauthenticated.status, 401);

  const crossOrigin = await handlers.POST(request(
    "https://drops.example/api/collaboration/transport",
    {
      method: "POST",
      cookie: editor.cookie,
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify(body),
    },
  ));
  assert.equal(crossOrigin.status, 403);

  const viewerWrite = await handlers.POST(request(
    "https://drops.example/api/collaboration/transport",
    {
      method: "POST",
      cookie: viewer.cookie,
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify(body),
    },
  ));
  assert.equal(viewerWrite.status, 403);

  const created = await handlers.POST(request(
    "https://drops.example/api/collaboration/transport",
    {
      method: "POST",
      cookie: editor.cookie,
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify(body),
    },
  ));
  assert.equal(created.status, 201);
  const createdPayload = await created.json();
  assert.equal(createdPayload.event.actorId, editor.identity);
  assert.equal(createdPayload.revision, 1);

  const read = await handlers.GET(request(
    "https://drops.example/api/collaboration/transport?workspaceId=workspace_test&projectId=project_test&afterRevision=0&limit=10",
    { cookie: viewer.cookie },
  ));
  assert.equal(read.status, 200);
  const readPayload = await read.json();
  assert.equal(readPayload.events.length, 1);
  assert.equal(readPayload.events[0].actorId, editor.identity);

  const unshared = await handlers.GET(request(
    "https://drops.example/api/collaboration/transport?workspaceId=workspace_test&projectId=other_project",
    { cookie: viewer.cookie },
  ));
  assert.equal(unshared.status, 404);
});

test("canonical health route is operator-only and returns bounded provider evidence", async () => {
  const handlers = createCollaborationRouteHandlers({
    environment: { DROPS_PLATFORM_HEALTH_OPERATOR_SECRET: HEALTH_SECRET },
    transport: new CollaborationTransport(new MemoryProjectDataBackend()),
  });
  const unauthenticated = await handlers.GET(request(
    "https://drops.example/api/collaboration/transport?health=1",
  ));
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { status: "unauthorized" });

  const authorized = await handlers.GET(request(
    "https://drops.example/api/collaboration/transport?health=1",
    { headers: { authorization: `Bearer ${HEALTH_SECRET}` } },
  ));
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  assert.equal(payload.status, "working");
  assert.ok(payload.evidence.includes("collaboration-two-actor-order-live"));
  assert.ok(payload.evidence.includes("collaboration-cleanup-live"));
});

test("canonical route rejects oversized write bodies before parsing", async () => {
  const editor = account("oversized-route-test");
  const team = workspace([{ identity: editor.identity, role: "owner" }]);
  const handlers = createCollaborationRouteHandlers({
    transport: new CollaborationTransport(new MemoryProjectDataBackend()),
    resolveWorkspace: async () => team,
    enforceRateLimit: async () => {},
    requireWriteEntitlement: async () => {},
  });
  const response = await handlers.POST(request(
    "https://drops.example/api/collaboration/transport",
    {
      method: "POST",
      cookie: editor.cookie,
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify({ padding: "x".repeat(20_000) }),
    },
  ));
  assert.equal(response.status, 413);
});
