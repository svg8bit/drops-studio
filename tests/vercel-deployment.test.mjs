import assert from "node:assert/strict";
import test from "node:test";

const {
  createVercelPreviewDeployment,
  getVercelDeploymentLogs,
  VercelDeploymentError,
  vercelDeploymentReadiness,
  waitForVercelDeployment,
} = await import("../lib/vercel-deployment.ts");

const credentials = { accessToken: "vercel-session-token-for-tests", teamId: "team_test" };

test("creates a bounded preview deployment without returning its request-only token", async () => {
  let request;
  const deployment = await createVercelPreviewDeployment({
    credentials,
    name: "Whale Intelligence",
    revisionHash: "a".repeat(64),
    files: [
      { path: "package.json", content: '{"scripts":{"build":"next build"}}' },
      { path: "app/page.tsx", content: "export default function Page(){return <main>Whales</main>}" },
    ],
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(String(init.body)) };
      return Response.json({
        id: "dpl_TestPreview123",
        name: "whale-intelligence",
        url: "whale-intelligence-preview.vercel.app",
        readyState: "QUEUED",
        createdAt: 1_785_000_000_000,
      });
    },
  });

  assert.match(request.url, /\/v13\/deployments\?teamId=team_test$/);
  assert.equal(request.init.headers.authorization, `Bearer ${credentials.accessToken}`);
  assert.equal(request.body.target, undefined, "an omitted target is a preview deployment");
  assert.equal(request.body.files.length, 2);
  assert.equal(request.body.projectSettings.framework, "nextjs");
  assert.equal(deployment.readyState, "QUEUED");
  assert.equal(deployment.url, "https://whale-intelligence-preview.vercel.app");
  assert.doesNotMatch(JSON.stringify(deployment), /vercel-session-token/);
});

test("waits until Vercel confirms READY instead of claiming deployment early", async () => {
  const states = ["BUILDING", "READY"];
  const deployment = await waitForVercelDeployment({
    credentials,
    deploymentId: "dpl_TestPreview123",
    pollMs: 100,
    sleep: async () => undefined,
    fetchImpl: async () => {
      const state = states.shift() ?? "READY";
      return Response.json({
        id: "dpl_TestPreview123",
        name: "whale-intelligence",
        url: "whale-intelligence-preview.vercel.app",
        readyState: state,
        createdAt: Date.now(),
        ...(state === "READY" ? { ready: Date.now() } : {}),
      });
    },
  });
  assert.equal(deployment.readyState, "READY");
  assert.ok(deployment.readyAt);
  assert.equal(states.length, 0);
});

test("normalizes bounded provider logs", async () => {
  const logs = await getVercelDeploymentLogs({
    credentials,
    deploymentId: "dpl_TestPreview123",
    fetchImpl: async () => Response.json([
      { type: "stdout", created: 1_785_000_000_000, payload: { text: "npm run build" } },
      { type: "stderr", created: 1_785_000_000_100, payload: { text: "Type error" } },
    ]),
  });
  assert.deepEqual(logs.map((item) => [item.type, item.text]), [
    ["stdout", "npm run build"],
    ["stderr", "Type error"],
  ]);
});

test("redacts credential material from provider errors and deployment logs", async () => {
  const secret = `github_pat_${"A".repeat(45)}`;
  const logs = await getVercelDeploymentLogs({
    credentials,
    deploymentId: "dpl_TestPreview123",
    fetchImpl: async () => Response.json([
      { type: "stderr", created: Date.now(), payload: { text: `failed with ${secret}` } },
    ]),
  });
  assert.equal(logs[0].text, "[redacted secret material]");
  assert.doesNotMatch(JSON.stringify(logs), /github_pat_/);

  await assert.rejects(
    createVercelPreviewDeployment({
      credentials,
      name: "safe-project",
      files: [{ path: "package.json", content: '{"private":true}' }],
      fetchImpl: async () => Response.json(
        { error: { message: `provider echoed ${secret}`, code: "bad_request" } },
        { status: 400 },
      ),
    }),
    (error) => {
      assert.equal(error.message, "Vercel API request failed with status 400.");
      assert.doesNotMatch(error.message, /github_pat_/);
      return true;
    },
  );
});

test("rejects traversal and secrets before sending deployment files", async () => {
  let called = false;
  await assert.rejects(
    createVercelPreviewDeployment({
      credentials,
      name: "unsafe",
      files: [{ path: "../.env", content: "x" }],
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    }),
    (error) => error instanceof VercelDeploymentError && error.code === "VERCEL_FILE_PATH_INVALID",
  );
  await assert.rejects(
    createVercelPreviewDeployment({
      credentials,
      name: "unsafe",
      files: [{ path: "app/page.tsx", content: 'const token = "github_pat_' + "A".repeat(45) + '"' }],
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    }),
    /secret material/i,
  );
  assert.equal(called, false);
});

test("reports honest platform versus session-token readiness", () => {
  assert.deepEqual(vercelDeploymentReadiness({}), {
    configured: false,
    source: "session-required",
  });
  assert.deepEqual(vercelDeploymentReadiness({ VERCEL_DEPLOY_TOKEN: "configured" }), {
    configured: false,
    source: "session-required",
  });
  assert.deepEqual(vercelDeploymentReadiness({
    VERCEL_DEPLOY_TOKEN: "configured",
    VERCEL_GENERATED_PROJECT_ID: "prj_configured",
  }), {
    configured: true,
    source: "platform",
  });
});
