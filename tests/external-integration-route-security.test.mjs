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

const access = await import("../lib/access-tier.ts");
const { createProjectCheckpointV2 } = await import("../lib/project-checkpoint-v2.ts");
const { writeProjectV2File } = await import("../lib/project-v2-files.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const { writeProjectV2ReleaseReceipt } = await import("../db/project-v2-release-receipts.ts");
const { writeProjectV2Snapshot } = await import("../db/project-v2-snapshots.ts");
const vercelRoute = await import("../app/api/deployments/vercel/route.ts");
const githubRoute = await import("../app/api/integrations/github/route.ts");

const secret = "route-security-secret-with-at-least-thirty-two-bytes";
const guestId = "01234567-89ab-cdef-0123-456789abcdef";
const guestCookieValue = access.createGuestIdentityCookie(guestId, secret);
const guestActor = access.resolveStudioProjectActor(
  { guestCookie: guestCookieValue },
  { NODE_ENV: "test", DROPS_GUEST_COOKIE_SECRET: secret },
);

async function verifiedProject(id = "external-route-project") {
  const base = await materializeProjectV2Template({
    id,
    now: "2026-07-30T12:00:00.000Z",
    spec: createProjectSpec({
      presetId: "alpha-channel",
      values: {},
      prompt: "Build a sourced AI alpha channel",
      tools: ["DropsTab API", "Telegram"],
      provider: "free",
      model: "Free compiler",
      market: [],
      prediction: { title: "No prediction", probability: null, change: null },
      origin: "https://studio.example.test",
    }),
  });
  const runs = base.tasks.map((task, index) => ({
    id: `verified-run-${index}`,
    taskId: task.id,
    projectRevision: base.revision,
    status: task.kind === "dev" ? "running" : "succeeded",
    runtime: "vercel-sandbox",
    startedAt: "2026-07-30T12:01:00.000Z",
    ...(task.kind === "dev"
      ? { exitCode: null }
      : { finishedAt: "2026-07-30T12:01:01.000Z", exitCode: 0 }),
    logIds: task.kind === "dev" ? ["browser-log"] : [],
    auditEventIds: [],
  }));
  const previewRun = runs.find((run) =>
    base.tasks.find((task) => task.id === run.taskId)?.kind === "dev",
  );
  const withEvidence = {
    ...base,
    runs,
    logs: [{
      id: "browser-log",
      runId: previewRun.id,
      stream: "browser",
      bytes: 64,
      truncated: false,
      createdAt: "2026-07-30T12:01:02.000Z",
    }],
    preview: {
      status: "ready",
      projectRevision: base.revision,
      sandboxId: "sbx_verified",
      url: "https://verified-preview.example.test/",
      port: 3000,
      startedAt: "2026-07-30T12:01:00.000Z",
    },
  };
  const checkpoint = await createProjectCheckpointV2(withEvidence, {
    id: "verified-checkpoint",
    label: "Verified deterministic build",
    source: "ai",
    createdAt: "2026-07-30T12:01:03.000Z",
  });
  return { ...withEvidence, checkpoints: [checkpoint] };
}

async function mintReleaseReceipt(projectActor, project, checkpoint = project.checkpoints.at(-1)) {
  assert.ok(checkpoint);
  return writeProjectV2ReleaseReceipt({
    actorId: projectActor.identity,
    projectId: project.id,
    revision: checkpoint.snapshot.revision,
    contentHash: checkpoint.snapshot.contentHash,
    checkpointId: checkpoint.id,
    snapshotHash: checkpoint.snapshotHash,
  });
}

function routeRequest(path, body, headers = {}) {
  return new NextRequest(`https://studio.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example.test",
      host: "studio.example.test",
      "x-forwarded-proto": "https",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function withRouteEnvironment(run) {
  const names = [
    "NODE_ENV",
    "DROPS_GUEST_COOKIE_SECRET",
    "DROPS_STUDIO_LOCAL_PROJECT_STORE",
    "VERCEL",
    "VERCEL_DEPLOY_TOKEN",
    "VERCEL_GENERATED_PROJECT_ID",
    "VERCEL_TEAM_ID",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_ALLOWED_REPOSITORIES",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  process.env.NODE_ENV = "test";
  process.env.DROPS_GUEST_COOKIE_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_PROJECT_V2_RELEASE_RECEIPTS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Vercel deployment rejects unsigned callers and never spends the platform credential", async () => {
  await withRouteEnvironment(async () => {
    process.env.VERCEL_DEPLOY_TOKEN = "vercel_platform_token_for_route_test";
    process.env.VERCEL_GENERATED_PROJECT_ID = "prj_generated";
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      { action: "deploy", studioProjectId: "external-route-project", approved: true, wait: false },
    ));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "VERCEL_SESSION_REQUIRED");
    assert.equal(called, false);
  });
});

test("Vercel deployment rejects forged release metadata without a server receipt", async () => {
  await withRouteEnvironment(async () => {
    const project = await verifiedProject("forged-release-project");
    await writeProjectV2Snapshot(guestActor.identity, project, 0);
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "deploy",
        studioProjectId: project.id,
        approved: true,
        wait: false,
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-vercel-access-token": "vercel-session-route-token-123456",
      },
    ));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "VERCEL_RELEASE_RECEIPT_REQUIRED");
    assert.equal(called, false);
  });
});

test("Vercel deployment reads canonical owned files and keeps platform credentials member-only", async () => {
  await withRouteEnvironment(async () => {
    const project = await verifiedProject();
    await writeProjectV2Snapshot(guestActor.identity, project, 0);
    await mintReleaseReceipt(guestActor, project);
    process.env.VERCEL_DEPLOY_TOKEN = "vercel_platform_token_for_route_test";
    process.env.VERCEL_GENERATED_PROJECT_ID = "prj_generated";

    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const denied = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      { action: "deploy", studioProjectId: project.id, approved: true, wait: false },
      { cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}` },
    ));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "VERCEL_CONNECTION_REQUIRED");
    assert.equal(called, false);

    let providerRequest;
    globalThis.fetch = async (url, init) => {
      providerRequest = { url: String(url), init, body: JSON.parse(String(init.body)) };
      return Response.json({
        id: "dpl_CanonicalRoute123",
        name: "alpha-channel",
        url: "canonical-preview.vercel.app",
        readyState: "QUEUED",
        createdAt: Date.now(),
      });
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "deploy",
        studioProjectId: project.id,
        approved: true,
        wait: false,
        files: { "app/evil.ts": { content: "MALICIOUS CLIENT SOURCE" } },
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-vercel-access-token": "vercel-session-route-token-123456",
      },
    ));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.match(providerRequest.url, /api\.vercel\.com\/v13\/deployments/);
    assert.equal(
      providerRequest.init.headers.authorization,
      "Bearer vercel-session-route-token-123456",
    );
    const serializedFiles = JSON.stringify(providerRequest.body.files);
    assert.match(serializedFiles, /package\.json/);
    assert.doesNotMatch(serializedFiles, /MALICIOUS CLIENT SOURCE|app\/evil\.ts/);
  });
});

test("Vercel deployment refuses a stale receipt copied onto a forged newer revision", async () => {
  await withRouteEnvironment(async () => {
    const original = await verifiedProject("stale-release-project");
    await mintReleaseReceipt(guestActor, original);
    const page = original.files["app/page.tsx"];
    assert.ok(page);
    const changed = await writeProjectV2File(original, original.revision, {
      type: "write",
      path: page.path,
      content: `${page.content}\n// forged newer revision`,
      provenance: "manual",
    });
    const forgedEvidence = {
      ...changed,
      runs: changed.runs.map((run) => ({ ...run, projectRevision: changed.revision })),
      preview: {
        ...original.preview,
        projectRevision: changed.revision,
        status: "ready",
      },
    };
    const forgedCheckpoint = await createProjectCheckpointV2(forgedEvidence, {
      id: "forged-newer-checkpoint",
      label: "Verified AI build",
      source: "ai",
      createdAt: "2026-07-30T12:02:00.000Z",
    });
    const forged = {
      ...forgedEvidence,
      checkpoints: [...forgedEvidence.checkpoints, forgedCheckpoint],
    };
    await writeProjectV2Snapshot(guestActor.identity, forged, 0);
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "deploy",
        studioProjectId: forged.id,
        approved: true,
        wait: false,
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-vercel-access-token": "vercel-session-route-token-123456",
      },
    ));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "VERCEL_RELEASE_RECEIPT_REQUIRED");
    assert.equal(called, false);
  });
});

test("Vercel rollback deploys only the exact checkpoint covered by its private receipt", async () => {
  await withRouteEnvironment(async () => {
    const original = await verifiedProject("receipt-rollback-project");
    const verifiedCheckpoint = original.checkpoints.at(-1);
    assert.ok(verifiedCheckpoint);
    await mintReleaseReceipt(guestActor, original, verifiedCheckpoint);
    const page = original.files["app/page.tsx"];
    const changed = await writeProjectV2File(original, original.revision, {
      type: "write",
      path: page.path,
      content: `${page.content}\n// CURRENT_REVISION_ONLY_MARKER`,
      provenance: "manual",
    });
    await writeProjectV2Snapshot(guestActor.identity, changed, 0);
    let providerBody;
    globalThis.fetch = async (_url, init) => {
      providerBody = JSON.parse(String(init.body));
      return Response.json({
        id: "dpl_ReceiptRollback123",
        name: "receipt-rollback-project",
        url: "receipt-rollback.vercel.app",
        readyState: "QUEUED",
        createdAt: Date.now(),
      });
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "rollback",
        studioProjectId: changed.id,
        checkpointId: verifiedCheckpoint.id,
        approved: true,
        wait: false,
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-vercel-access-token": "vercel-session-route-token-123456",
      },
    ));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.doesNotMatch(JSON.stringify(providerBody.files), /CURRENT_REVISION_ONLY_MARKER/);
  });
});

test("Vercel rollback rejects a checkpoint that has no exact private receipt", async () => {
  await withRouteEnvironment(async () => {
    const original = await verifiedProject("unverified-rollback-project");
    const manual = await createProjectCheckpointV2(original, {
      id: "manual-unverified-checkpoint",
      label: "Manual checkpoint",
      source: "manual",
      createdAt: "2026-07-30T12:03:00.000Z",
    });
    const project = {
      ...original,
      checkpoints: [...original.checkpoints, manual],
    };
    await writeProjectV2Snapshot(guestActor.identity, project, 0);
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "rollback",
        studioProjectId: project.id,
        checkpointId: manual.id,
        approved: true,
        wait: false,
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-vercel-access-token": "vercel-session-route-token-123456",
      },
    ));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "VERCEL_RELEASE_RECEIPT_REQUIRED");
    assert.equal(called, false);
  });
});

test("platform Vercel credentials cannot be redirected by client team or project fields", async () => {
  await withRouteEnvironment(async () => {
    const accountCookie = access.createStudioAccountCookie({
      provider: "openrouter",
      subject: "route-security-member",
    }, secret);
    const memberActor = access.resolveStudioProjectActor(
      { accountCookie },
      { NODE_ENV: "test", DROPS_GUEST_COOKIE_SECRET: secret },
    );
    const project = await verifiedProject("member-platform-project");
    await writeProjectV2Snapshot(memberActor.identity, project, 0);
    await mintReleaseReceipt(memberActor, project);
    process.env.VERCEL_DEPLOY_TOKEN = "vercel_platform_token_for_route_test";
    process.env.VERCEL_GENERATED_PROJECT_ID = "prj_server_owned";
    process.env.VERCEL_TEAM_ID = "team_server_owned";
    let providerRequest;
    globalThis.fetch = async (url, init) => {
      providerRequest = { url: String(url), body: JSON.parse(String(init.body)) };
      return Response.json({
        id: "dpl_ServerScope123",
        name: "member-platform-project",
        url: "member-platform.vercel.app",
        readyState: "QUEUED",
        createdAt: Date.now(),
      });
    };
    const response = await vercelRoute.POST(routeRequest(
      "/api/deployments/vercel",
      {
        action: "deploy",
        studioProjectId: project.id,
        approved: true,
        wait: false,
        teamId: "team_attacker",
        projectId: "prj_attacker",
      },
      { cookie: `${access.STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
    ));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.match(providerRequest.url, /teamId=team_server_owned/);
    assert.doesNotMatch(providerRequest.url, /team_attacker/);
    assert.equal(providerRequest.body.project, "prj_server_owned");
  });
});

test("GitHub integration requires a signed actor before platform or session credentials are used", async () => {
  await withRouteEnvironment(async () => {
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = "server-private-key";
    process.env.GITHUB_APP_INSTALLATION_ID = "2";
    process.env.GITHUB_APP_ALLOWED_REPOSITORIES = "drops/alpha-app";
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const response = await githubRoute.POST(routeRequest(
      "/api/integrations/github",
      { action: "inspect", owner: "drops", repo: "alpha-app" },
    ));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "GITHUB_SESSION_REQUIRED");
    assert.equal(called, false);
  });
});

test("GitHub publish ignores client files and sends the authorized Project V2 snapshot", async () => {
  await withRouteEnvironment(async () => {
    const project = await verifiedProject();
    await writeProjectV2Snapshot(guestActor.identity, project, 0);
    const calls = [];
    let blobIndex = 0;
    globalThis.fetch = async (url, init = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), method, body, headers: init.headers });
      if (String(url).endsWith("/repos/drops/alpha-app")) {
        return Response.json({ default_branch: "main", private: true, html_url: "https://github.com/drops/alpha-app" });
      }
      if (String(url).includes("/git/ref/heads/main")) return Response.json({ object: { sha: "1".repeat(40) } });
      if (String(url).endsWith("/git/refs")) return Response.json({ ref: "refs/heads/drops-studio/thread-route" });
      if (String(url).includes("/git/commits/") && method === "GET") return Response.json({ tree: { sha: "2".repeat(40) } });
      if (String(url).endsWith("/git/blobs")) {
        blobIndex += 1;
        return Response.json({ sha: blobIndex.toString(16).padStart(40, "0") });
      }
      if (String(url).endsWith("/git/trees")) return Response.json({ sha: "3".repeat(40) });
      if (String(url).endsWith("/git/commits") && method === "POST") {
        return Response.json({ sha: "4".repeat(40), html_url: `https://github.com/drops/alpha-app/commit/${"4".repeat(40)}` });
      }
      if (String(url).includes("/git/refs/heads/drops-studio%2Fthread-route")) return Response.json({});
      if (String(url).endsWith("/pulls")) return Response.json({ number: 9, html_url: "https://github.com/drops/alpha-app/pull/9" });
      return Response.json({ message: `Unexpected ${method} ${url}` }, { status: 500 });
    };

    const response = await githubRoute.POST(routeRequest(
      "/api/integrations/github",
      {
        action: "publish",
        studioProjectId: project.id,
        owner: "drops",
        repo: "alpha-app",
        conversationId: "thread-route",
        approved: true,
        files: { "app/evil.ts": { content: "MALICIOUS CLIENT SOURCE" } },
      },
      {
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${guestCookieValue}`,
        "x-github-access-token": "github-session-route-token-123456",
        "x-github-installation-id": "999999999",
      },
    ));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const blobBodies = calls
      .filter((call) => call.method === "POST" && call.url.endsWith("/git/blobs"))
      .map((call) => call.body);
    assert.equal(blobBodies.length, Object.keys(project.files).length);
    const treeRequest = calls.find((call) =>
      call.method === "POST" && call.url.endsWith("/git/trees"),
    );
    assert.ok(treeRequest.body.tree.some((entry) => entry.path === "package.json"));
    assert.doesNotMatch(JSON.stringify(blobBodies), /MALICIOUS CLIENT SOURCE|app\/evil\.ts/);
    assert.ok(calls.every((call) => !call.url.includes("installations/999999999")));
  });
});
