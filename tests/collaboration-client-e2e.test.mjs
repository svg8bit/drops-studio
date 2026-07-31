import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server.js";

import {
  appendCollaborationInvalidation,
  CollaborationClientError,
  createTeamProjectInvalidation,
  isTeamProjectInvalidation,
  readAuthoritativeTeamWorkspace,
  readCollaborationTransport,
} from "../lib/collaboration-transport-client.ts";
import { CollaborationTransport } from "../lib/collaboration-transport.ts";
import { createCollaborationRouteHandlers } from "../lib/collaboration-transport-route.ts";
import { MemoryProjectDataBackend } from "../lib/project-data/backend.ts";
import {
  createStudioAccountCookie,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../lib/access-tier.ts";

const ORIGIN = "https://drops.example";
const COOKIE_SECRET = "collaboration-client-e2e-cookie-secret-000000000000000";
const SCOPE = { workspaceId: "workspace_client_e2e", projectId: "project_client_e2e" };
const AT = "2026-07-31T10:00:00.000Z";

process.env.DROPS_ACCOUNT_COOKIE_SECRET = COOKIE_SECRET;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function sharedProject(revision, updatedBy, source) {
  return {
    projectId: SCOPE.projectId,
    revision,
    draft: {
      id: SCOPE.projectId,
      spec: { name: `Whale intelligence r${revision}` },
      checkpoints: [],
      futureCheckpoints: [],
      conversation: [],
      workspace: {
        schemaVersion: 1,
        revision,
        updatedAt: AT,
        files: [{
          path: "app/page.tsx",
          content: source,
          language: "typescript",
          role: "source",
          editable: true,
        }],
        tasks: [],
        runtime: {
          executionMode: "remote-sandbox",
          provider: "vercel-sandbox",
          isolation: "sandbox",
          runtime: "node24",
          packageManager: "npm",
          installScripts: false,
        },
      },
    },
    createdAt: AT,
    updatedAt: AT,
    updatedBy,
  };
}

function durableFixtureBackend() {
  const memory = new MemoryProjectDataBackend();
  return {
    kind: "vercel-blob-private",
    read: memory.read.bind(memory),
    compareAndSwap: memory.compareAndSwap.bind(memory),
    deleteProject: memory.deleteProject.bind(memory),
  };
}

function nextRequest(url, init, cookie) {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("cookie", `${STUDIO_ACCOUNT_COOKIE}=${cookie}`);
  if (method !== "GET" && method !== "HEAD") headers.set("origin", ORIGIN);
  return new NextRequest(new URL(String(url), ORIGIN), {
    method,
    headers,
    ...(typeof init.body === "string" ? { body: init.body } : {}),
  });
}

test("Studio clients exchange durable invalidations, reload authority, and require explicit apply", async () => {
  const clientA = account("client-e2e-editor-a");
  const clientB = account("client-e2e-viewer-b");
  const localProject = sharedProject(
    1,
    clientA.identity,
    "export default function Page() { return <main>LOCAL_REVISION_ONE</main>; }",
  );
  const remoteProjectTwo = sharedProject(
    2,
    clientA.identity,
    "export default function Page() { return <main>REMOTE_REVISION_TWO</main>; }",
  );
  const remoteProjectThree = sharedProject(
    3,
    clientA.identity,
    "export default function Page() { return <main>REMOTE_REVISION_THREE</main>; }",
  );
  const authoritativeWorkspace = {
    id: SCOPE.workspaceId,
    ownerIdentity: clientA.identity,
    name: "Client protocol workspace",
    revision: 3,
    createdAt: AT,
    updatedAt: AT,
    members: [
      { identity: clientA.identity, role: "owner", joinedAt: AT, consentedAt: AT },
      { identity: clientB.identity, role: "viewer", joinedAt: AT, consentedAt: AT },
    ],
    invites: [],
    projects: [remoteProjectThree],
  };
  const transport = new CollaborationTransport(durableFixtureBackend(), {
    now: () => new Date(AT),
    id: (() => {
      let id = 0;
      return () => `cliente2e${++id}`;
    })(),
  });
  const handlers = createCollaborationRouteHandlers({
    transport,
    resolveWorkspace: async (_actorIdentity, workspaceId) => (
      workspaceId === authoritativeWorkspace.id ? authoritativeWorkspace : null
    ),
    enforceRateLimit: async () => {},
    requireWriteEntitlement: async () => {},
  });
  const postedBodies = [];
  const authoritativeReads = [];

  function clientFetcher(cookie) {
    return async (url, init = {}) => {
      const requestUrl = new URL(String(url), ORIGIN);
      if (requestUrl.pathname.startsWith("/api/teams/")) {
        authoritativeReads.push(requestUrl);
        return json({ workspace: structuredClone(authoritativeWorkspace) });
      }
      assert.equal(requestUrl.pathname, "/api/collaboration/transport");
      if ((init.method ?? "GET").toUpperCase() === "POST") {
        postedBodies.push(JSON.parse(init.body));
        return handlers.POST(nextRequest(url, init, cookie));
      }
      return handlers.GET(nextRequest(url, init, cookie));
    };
  }

  const fetchAsA = clientFetcher(clientA.cookie);
  const fetchAsB = clientFetcher(clientB.cookie);
  const invalidationTwo = await createTeamProjectInvalidation(
    { id: authoritativeWorkspace.id, revision: 2 },
    remoteProjectTwo,
  );
  const invalidationThree = await createTeamProjectInvalidation(
    authoritativeWorkspace,
    remoteProjectThree,
  );

  const appendTwo = await appendCollaborationInvalidation(
    SCOPE,
    0,
    "client-a-revision-0002",
    invalidationTwo,
    fetchAsA,
  );
  const appendThree = await appendCollaborationInvalidation(
    SCOPE,
    appendTwo.revision,
    "client-a-revision-0003",
    invalidationThree,
    fetchAsA,
  );

  assert.equal(appendTwo.revision, 1);
  assert.equal(appendThree.revision, 2);
  assert.equal(appendThree.mode, "vercel-blob-private");
  assert.deepEqual(postedBodies.map((body) => Object.keys(body).sort()), [
    ["expectedRevision", "idempotencyKey", "payload", "projectId", "type", "workspaceId"],
    ["expectedRevision", "idempotencyKey", "payload", "projectId", "type", "workspaceId"],
  ]);
  assert.deepEqual(postedBodies.map((body) => Object.keys(body.payload).sort()), [
    ["digest", "operation", "projectId", "projectRevision", "schemaVersion", "target", "updatedAt", "workspaceRevision"],
    ["digest", "operation", "projectId", "projectRevision", "schemaVersion", "target", "updatedAt", "workspaceRevision"],
  ]);
  assert.doesNotMatch(JSON.stringify(postedBodies), /REMOTE_REVISION_(?:TWO|THREE)/);

  const clientBReceipt = await readCollaborationTransport(SCOPE, 0, fetchAsB);
  assert.equal(clientBReceipt.historyGap, false);
  assert.equal(clientBReceipt.revision, 2);
  assert.deepEqual(clientBReceipt.events.map((event) => event.revision), [1, 2]);
  assert.deepEqual(clientBReceipt.events.map((event) => event.actorId), [
    clientA.identity,
    clientA.identity,
  ]);
  assert.equal(clientBReceipt.events.every((event) => (
    isTeamProjectInvalidation(event, SCOPE.projectId)
  )), true);
  assert.deepEqual(clientBReceipt.events.map((event) => event.payload.projectRevision), [2, 3]);

  let locallyOpenedProject = structuredClone(localProject);
  const reloaded = await readAuthoritativeTeamWorkspace(
    SCOPE.workspaceId,
    authoritativeWorkspace.ownerIdentity,
    fetchAsB,
  );
  const pendingRemoteProject = reloaded.projects.find((project) => (
    project.projectId === SCOPE.projectId
  ));
  assert.ok(pendingRemoteProject);
  assert.equal(authoritativeReads.length, 1);
  assert.equal(authoritativeReads[0].searchParams.get("owner"), authoritativeWorkspace.ownerIdentity);
  assert.equal(pendingRemoteProject.revision, 3);
  assert.equal(locallyOpenedProject.revision, 1);
  assert.match(locallyOpenedProject.draft.workspace.files[0].content, /LOCAL_REVISION_ONE/);

  const applyConsent = false;
  if (applyConsent) locallyOpenedProject = structuredClone(pendingRemoteProject);
  assert.equal(locallyOpenedProject.revision, 1);
  locallyOpenedProject = structuredClone(pendingRemoteProject);
  assert.equal(locallyOpenedProject.revision, 3);
  assert.match(locallyOpenedProject.draft.workspace.files[0].content, /REMOTE_REVISION_THREE/);

  await assert.rejects(
    appendCollaborationInvalidation(
      SCOPE,
      clientBReceipt.revision,
      "client-b-forbidden-0001",
      invalidationThree,
      fetchAsB,
    ),
    (error) => error instanceof CollaborationClientError
      && error.code === "forbidden"
      && error.status === 403,
  );
  const afterDeniedWrite = await readCollaborationTransport(SCOPE, 2, fetchAsB);
  assert.equal(afterDeniedWrite.revision, 2);
  assert.deepEqual(afterDeniedWrite.events, []);
});
