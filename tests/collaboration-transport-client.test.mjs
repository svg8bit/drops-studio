import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  appendCollaborationInvalidation,
  CollaborationClientError,
  createTeamProjectInvalidation,
  isTeamProjectInvalidation,
  readAuthoritativeTeamWorkspace,
  readCollaborationTransport,
} from "../lib/collaboration-transport-client.ts";

const SCOPE = { workspaceId: "workspace_test", projectId: "project_test" };
const AT = "2026-07-31T10:00:00.000Z";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function invalidation(overrides = {}) {
  return {
    schemaVersion: 1,
    target: "team-shared-project",
    operation: "project.upsert",
    projectId: SCOPE.projectId,
    projectRevision: 4,
    workspaceRevision: 7,
    digest: "a".repeat(64),
    updatedAt: AT,
    ...overrides,
  };
}

function event(revision, actorId = "account:member-b", overrides = {}) {
  return {
    id: `evt_${revision}_clienttest`,
    revision,
    actorId,
    type: "document.replace",
    payload: invalidation({ projectRevision: revision + 2 }),
    createdAt: AT,
    ...overrides,
  };
}

test("client polls the authenticated durable room with an explicit revision cursor", async () => {
  const calls = [];
  const controller = new AbortController();
  const receipt = await readCollaborationTransport(SCOPE, 3, async (url, init) => {
    calls.push({ url: String(url), init });
    return json({
      status: "working",
      mode: "vercel-blob-private",
      revision: 4,
      retainedFromRevision: 1,
      events: [event(4)],
    });
  }, controller.signal);

  assert.equal(receipt.revision, 4);
  assert.equal(receipt.mode, "vercel-blob-private");
  assert.equal(receipt.historyGap, false);
  assert.equal(receipt.events[0].actorId, "account:member-b");
  assert.match(calls[0].url, /workspaceId=workspace_test/);
  assert.match(calls[0].url, /projectId=project_test/);
  assert.match(calls[0].url, /afterRevision=3/);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.signal, controller.signal);
});

test("client appends metadata-only invalidation with idempotency and reconciles one stale revision", async () => {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST" && requests.filter((item) => item.init.method === "POST").length === 1) {
      return json({
        code: "CONFLICT",
        error: "Collaboration room changed concurrently.",
        currentRevision: 2,
      }, 409);
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      return json({
        status: "working",
        mode: "neon-postgres",
        revision: 3,
        idempotent: false,
        event: event(3, "account:member-a", { payload: body.payload }),
      }, 201);
    }
    return json({
      status: "working",
      mode: "neon-postgres",
      revision: 2,
      retainedFromRevision: 1,
      events: [event(2)],
    });
  };

  const receipt = await appendCollaborationInvalidation(
    SCOPE,
    1,
    "studio-test-0001",
    invalidation(),
    fetcher,
  );

  assert.equal(receipt.revision, 3);
  assert.equal(receipt.reconciledEvents.length, 1);
  assert.equal(receipt.reconciledHistoryGap, false);
  assert.equal(requests.length, 3);
  const firstBody = JSON.parse(requests[0].init.body);
  const retryBody = JSON.parse(requests[2].init.body);
  assert.equal(firstBody.expectedRevision, 1);
  assert.equal(retryBody.expectedRevision, 2);
  assert.equal(firstBody.idempotencyKey, "studio-test-0001");
  assert.equal(retryBody.idempotencyKey, firstBody.idempotencyKey);
  assert.equal(retryBody.type, "document.replace");
  assert.equal("draft" in retryBody.payload, false);
  assert.equal("files" in retryBody.payload, false);
});

test("invalidation hashes the canonical shared project but never includes source bytes", async () => {
  const workspace = { id: SCOPE.workspaceId, revision: 7 };
  const sharedProject = {
    projectId: SCOPE.projectId,
    revision: 4,
    draft: {
      id: SCOPE.projectId,
      spec: { name: "Whale monitor" },
      workspace: {
        files: [{ path: "app/page.tsx", content: "SOURCE_BYTES_MUST_NOT_LEAVE_TEAM_STORE" }],
      },
    },
    createdAt: AT,
    updatedAt: AT,
    updatedBy: "account:member-a",
  };
  const payload = await createTeamProjectInvalidation(workspace, sharedProject);
  const serialized = JSON.stringify(payload);

  assert.match(payload.digest, /^[a-f0-9]{64}$/);
  assert.equal(payload.projectRevision, 4);
  assert.doesNotMatch(serialized, /SOURCE_BYTES_MUST_NOT_LEAVE_TEAM_STORE/);
  assert.equal(isTeamProjectInvalidation(event(5, "account:member-b", { payload }), SCOPE.projectId), true);
  assert.equal(isTeamProjectInvalidation(event(5, "account:member-b", {
    payload: { ...payload, digest: "not-a-digest" },
  }), SCOPE.projectId), false);
});

test("incoming invalidation reloads the authoritative team revision without applying local source", async () => {
  const authoritative = {
    id: SCOPE.workspaceId,
    ownerIdentity: "owner-identity",
    name: "Research team",
    revision: 9,
    createdAt: AT,
    updatedAt: AT,
    members: [],
    invites: [],
    projects: [{ projectId: SCOPE.projectId, revision: 5 }],
  };
  let request;
  const result = await readAuthoritativeTeamWorkspace(
    SCOPE.workspaceId,
    authoritative.ownerIdentity,
    async (url, init) => {
      request = { url: String(url), init };
      return json({ workspace: authoritative });
    },
  );

  assert.equal(result.revision, 9);
  assert.match(request.url, /^\/api\/teams\/workspace_test\?owner=owner-identity$/);
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
});

test("client fails honestly for local fallback, malformed receipts, and event history gaps", async () => {
  await assert.rejects(
    appendCollaborationInvalidation(
      SCOPE,
      0,
      "studio-extra-field-0001",
      { ...invalidation(), files: [{ path: "app/page.tsx", content: "must not send" }] },
      async () => {
        throw new Error("fetch must not run");
      },
    ),
    (error) => error instanceof CollaborationClientError && error.code === "invalid_response",
  );
  await assert.rejects(
    readCollaborationTransport(SCOPE, 0, async () => json({
      status: "working",
      mode: "memory-local-fallback",
      revision: 0,
      retainedFromRevision: 0,
      events: [],
    })),
    (error) => error instanceof CollaborationClientError && error.code === "non_durable",
  );
  await assert.rejects(
    readCollaborationTransport(SCOPE, 0, async () => json({ status: "working" })),
    (error) => error instanceof CollaborationClientError && error.code === "invalid_response",
  );
  const gap = await readCollaborationTransport(SCOPE, 2, async () => json({
    status: "working",
    mode: "vercel-blob-private",
    revision: 8,
    retainedFromRevision: 7,
    events: [event(7), event(8)],
  }));
  assert.equal(gap.historyGap, true);
});

test("Studio team component polls only while visible and keeps remote apply consent explicit", async () => {
  const source = await readFile(
    new URL("../components/studio-account-team-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /COLLABORATION_POLL_INTERVAL_MS = 7_500/);
  assert.match(source, /document\.visibilityState === "hidden"/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /readCollaborationTransport/);
  assert.match(source, /appendCollaborationInvalidation/);
  assert.match(source, /readAuthoritativeTeamWorkspace/);
  assert.match(source, /pendingRemoteRevisionRef/);
  assert.match(source, /approve the replacement, then open it locally/i);
  assert.match(source, /checked=\{applyConsent\}/);
  assert.match(source, /disabled=\{accessUnverified \|\| !applicableProject \|\| !applyConsent/);
  assert.doesNotMatch(source, /Collaboration connected/);
});
