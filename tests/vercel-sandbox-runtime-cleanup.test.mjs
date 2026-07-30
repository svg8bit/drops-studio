import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        path.endsWith(".ts") ? path : `${path}.ts`,
        new URL("../", import.meta.url),
      ).href,
    };
  },
});

const {
  GUEST_IDENTITY_COOKIE,
  createGuestIdentityCookie,
  resolveGuestCookieSecret,
  resolveStudioProjectActor,
} = await import("../lib/access-tier.ts");
const { writeProjectV2Snapshot, readProjectV2Snapshot } = await import(
  "../db/project-v2-snapshots.ts"
);
const {
  hasProjectV2ReleaseReceipt,
  writeProjectV2ReleaseReceipt,
} = await import("../db/project-v2-release-receipts.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import(
  "../lib/project-template-materializer.ts"
);
const {
  GET: getProjectV2,
  PUT: putProjectV2,
  handleDeleteProjectV2,
} = await import("../app/api/projects/v2/route.ts");
const { handleBuilderCleanupRequest } = await import(
  "../app/api/builder/cleanup/route.ts"
);

process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";

function guestSession() {
  const guestId = "89abcdef-0123-4567-89ab-cdef01234567";
  const cookie = createGuestIdentityCookie(guestId, resolveGuestCookieSecret());
  const actor = resolveStudioProjectActor({ guestCookie: cookie });
  assert.ok(actor);
  return { cookie, actor };
}

function deleteRequest(projectId, cookie) {
  return new NextRequest(
    `https://studio.example.test/api/projects/v2?id=${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/json",
        origin: "https://studio.example.test",
        cookie: `${GUEST_IDENTITY_COOKIE}=${cookie}`,
      },
    },
  );
}

function getRequest(projectId, cookie) {
  return new NextRequest(
    `https://studio.example.test/api/projects/v2?id=${encodeURIComponent(projectId)}`,
    { headers: { cookie: `${GUEST_IDENTITY_COOKIE}=${cookie}` } },
  );
}

function putRequest(body, cookie) {
  return new NextRequest("https://studio.example.test/api/projects/v2", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example.test",
      cookie: `${GUEST_IDENTITY_COOKIE}=${cookie}`,
    },
    body: JSON.stringify(body),
  });
}

async function fixtureProject() {
  return materializeProjectV2Template({
    id: "cleanup-project-v2",
    now: "2026-07-30T12:00:00.000Z",
    spec: createProjectSpec({
      presetId: "crypto-game",
      values: {},
      prompt: "Build a cleanup test project",
      tools: [],
      provider: "free",
      model: "Free compiler",
      market: [],
      prediction: { title: "No prediction", probability: null, change: null },
      origin: "https://studio.example.test",
    }),
  });
}

function releaseDescriptor(actor, project) {
  return {
    actorId: actor.identity,
    projectId: project.id,
    revision: project.revision,
    contentHash: project.contentHash,
    checkpointId: "cleanup-release-checkpoint",
    snapshotHash: "a".repeat(64),
  };
}

test("Project V2 deletion destroys its deterministic Sandbox before removing storage", async () => {
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__?.clear();
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__?.clear();
  const { cookie, actor } = guestSession();
  const project = await fixtureProject();
  await writeProjectV2Snapshot(actor.identity, project, 0);
  const receipt = releaseDescriptor(actor, project);
  await writeProjectV2ReleaseReceipt(receipt);
  const receiptWrite = await putProjectV2(putRequest({
    project,
    expectedStorageRevision: 1,
    releaseReceipt: receipt,
  }, cookie));
  assert.equal(receiptWrite.status, 400);
  const projectResponse = await getProjectV2(getRequest(project.id, cookie));
  assert.equal(projectResponse.status, 200);
  assert.doesNotMatch(
    JSON.stringify(await projectResponse.json()),
    /sandbox-release-gate|cleanup-release-checkpoint/,
  );
  const calls = { resume: 0, destroy: 0 };
  const handle = {
    provider: "vercel-sandbox",
    projectId: project.id,
    sandboxName: "ds2-cleanup",
    sessionId: "session-cleanup",
    workspaceRoot: "/sandbox/project",
    revisionDigest: "0".repeat(64),
    createdAt: "2026-07-30T12:00:00.000Z",
    expiresAt: null,
  };
  const response = await handleDeleteProjectV2(deleteRequest(project.id, cookie), {
    runtime: {
      async resume(context) {
        calls.resume += 1;
        assert.equal(context.actorId, actor.identity);
        assert.equal(context.project.id, project.id);
        return handle;
      },
      async destroy(received) {
        calls.destroy += 1;
        assert.equal(received, handle);
      },
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, sandboxDestroyed: true });
  assert.deepEqual(calls, { resume: 1, destroy: 1 });
  assert.equal(await readProjectV2Snapshot(actor.identity, project.id), null);
  assert.equal(await hasProjectV2ReleaseReceipt(receipt), false);
});

test("Project V2 deletion fails closed and retains storage when Sandbox destroy fails", async () => {
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__?.clear();
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__?.clear();
  const { cookie, actor } = guestSession();
  const project = await fixtureProject();
  await writeProjectV2Snapshot(actor.identity, project, 0);
  const receipt = releaseDescriptor(actor, project);
  await writeProjectV2ReleaseReceipt(receipt);
  const response = await handleDeleteProjectV2(deleteRequest(project.id, cookie), {
    runtime: {
      async resume() { return { provider: "vercel-sandbox" }; },
      async destroy() { throw new Error("provider internal detail"); },
    },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PROJECT_V2_SANDBOX_CLEANUP_FAILED");
  assert.ok(await readProjectV2Snapshot(actor.identity, project.id));
  assert.equal(await hasProjectV2ReleaseReceipt(receipt), true);
});

test("protected cleanup route stops only sandboxes older than the configured idle boundary", async () => {
  const now = new Date("2026-07-30T12:00:00.000Z");
  let received;
  const request = new NextRequest("https://studio.example.test/api/builder/cleanup", {
    headers: { authorization: "Bearer cleanup-test-secret" },
  });
  const response = await handleBuilderCleanupRequest(request, {
    env: {
      CRON_SECRET: "cleanup-test-secret",
      DROPS_STUDIO_SANDBOX_IDLE_MINUTES: "15",
      NODE_ENV: "test",
    },
    now: () => now,
    runtime: {
      async cleanupIdle(options) {
        received = options;
        return { inspected: 3, stopped: ["ds2-idle"], failed: [] };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(received.idleBefore.toISOString(), "2026-07-30T11:45:00.000Z");
  assert.equal(received.limit, 100);
  assert.deepEqual((await response.json()).stopped, ["ds2-idle"]);
});

test("cleanup route rejects missing or incorrect cron authorization", async () => {
  let called = false;
  const response = await handleBuilderCleanupRequest(
    new NextRequest("https://studio.example.test/api/builder/cleanup"),
    {
      env: { CRON_SECRET: "cleanup-test-secret", NODE_ENV: "test" },
      runtime: {
        async cleanupIdle() {
          called = true;
          return { inspected: 0, stopped: [], failed: [] };
        },
      },
    },
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
});
