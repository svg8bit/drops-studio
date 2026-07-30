import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const {
  githubIntegrationReadiness,
  importGitHubRepository,
  inspectGitHubRepository,
  publishProjectToGitHub,
} = await import("../lib/github-integration.ts");

const credentials = { accessToken: "github-session-token-for-tests-123" };

test("inspects a repository with request-only credentials", async () => {
  let authorization = "";
  const repository = await inspectGitHubRepository({
    credentials,
    owner: "drops",
    repo: "whale-app",
    fetchImpl: async (_url, init) => {
      authorization = init.headers.authorization;
      return Response.json({
        default_branch: "main",
        private: true,
        html_url: "https://github.com/drops/whale-app",
      });
    },
  });
  assert.equal(authorization, `Bearer ${credentials.accessToken}`);
  assert.deepEqual(repository, {
    owner: "drops",
    repo: "whale-app",
    defaultBranch: "main",
    private: true,
    url: "https://github.com/drops/whale-app",
  });
  assert.doesNotMatch(JSON.stringify(repository), /session-token/);
});

test("creates one conversation branch, commit, and pull request without force updates", async () => {
  const calls = [];
  let blob = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const parsedBody = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method, body: parsedBody });
    if (String(url).endsWith("/repos/drops/whale-app")) {
      return Response.json({ default_branch: "main", private: false, html_url: "https://github.com/drops/whale-app" });
    }
    if (String(url).includes("/git/ref/heads/main")) {
      return Response.json({ object: { sha: "1".repeat(40) } });
    }
    if (String(url).endsWith("/git/refs")) return Response.json({ ref: "refs/heads/drops-studio/thread-42" });
    if (String(url).includes("/git/commits/") && method === "GET") {
      return Response.json({ tree: { sha: "2".repeat(40) } });
    }
    if (String(url).endsWith("/git/blobs")) {
      blob += 1;
      return Response.json({ sha: String(blob + 2).repeat(40).slice(0, 40) });
    }
    if (String(url).endsWith("/git/trees")) return Response.json({ sha: "5".repeat(40) });
    if (String(url).endsWith("/git/commits") && method === "POST") {
      return Response.json({ sha: "6".repeat(40), html_url: "https://github.com/drops/whale-app/commit/" + "6".repeat(40) });
    }
    if (String(url).includes("/git/refs/heads/drops-studio%2Fthread-42")) return Response.json({ object: { sha: "6".repeat(40) } });
    if (String(url).endsWith("/pulls")) {
      return Response.json({ number: 7, html_url: "https://github.com/drops/whale-app/pull/7" });
    }
    return Response.json({ message: `Unexpected ${method} ${url}` }, { status: 500 });
  };

  const result = await publishProjectToGitHub({
    credentials,
    owner: "drops",
    repo: "whale-app",
    files: [
      { path: "package.json", content: '{"private":true}' },
      { path: "app/page.tsx", content: "export default function Page(){return <main>Whales</main>}" },
    ],
    conversationId: "Thread 42",
    title: "Whale Intelligence",
    description: "DropsTab-enriched wallet activity with approved delivery.",
    fetchImpl,
  });

  assert.equal(result.branch, "drops-studio/thread-42");
  assert.equal(result.pullRequestNumber, 7);
  assert.equal(result.status, "pull-request-open");
  const refUpdate = calls.find((call) => call.method === "PATCH" && call.url.includes("/git/refs/heads/"));
  assert.equal(refUpdate.body.force, false);
  const pull = calls.find((call) => call.method === "POST" && call.url.endsWith("/pulls"));
  assert.equal(pull.body.head, "drops-studio/thread-42");
  assert.equal(pull.body.base, "main");
});

test("keeps GitHub App state honest when configuration is absent", () => {
  assert.deepEqual(githubIntegrationReadiness({}), {
    configured: false,
    mode: "session-token-required",
    permissions: ["contents:write", "pull_requests:write", "metadata:read"],
  });
  assert.equal(githubIntegrationReadiness({
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: "key",
    GITHUB_APP_INSTALLATION_ID: "2",
    GITHUB_APP_ALLOWED_REPOSITORIES: "drops/whale-app",
  }).mode, "github-app");
  assert.equal(githubIntegrationReadiness({
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: "key",
    GITHUB_APP_INSTALLATION_ID: "2",
  }).configured, false);
});

test("narrows GitHub App installation credentials to the selected repository", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const repository = await inspectGitHubRepository({
    credentials: {
      appId: "12345",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      installationId: "67890",
    },
    owner: "drops",
    repo: "whale-app",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/app/installations/67890/access_tokens")) {
        return Response.json({ token: "github-app-installation-token-123456" });
      }
      return Response.json({
        default_branch: "main",
        private: true,
        html_url: "https://github.com/drops/whale-app",
      });
    },
  });
  const tokenCall = calls[0];
  assert.deepEqual(JSON.parse(String(tokenCall.init.body)), { repositories: ["whale-app"] });
  assert.equal(tokenCall.init.headers["content-type"], "application/json");
  assert.equal(repository.repo, "whale-app");
});

test("rejects oversized GitHub responses before parsing provider-controlled JSON", async () => {
  await assert.rejects(
    inspectGitHubRepository({
      credentials,
      owner: "drops",
      repo: "whale-app",
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    }),
    (error) => {
      assert.equal(error.code, "GITHUB_RESPONSE_INVALID");
      assert.equal(error.status, 502);
      assert.match(error.message, /oversized response/i);
      return true;
    },
  );
});

test("refuses truncated repository trees before downloading any blob", async () => {
  let blobRequests = 0;
  await assert.rejects(
    importGitHubRepository({
      credentials,
      owner: "drops",
      repo: "whale-app",
      fetchImpl: async (url) => {
        const endpoint = String(url);
        if (endpoint.endsWith("/repos/drops/whale-app")) {
          return Response.json({
            default_branch: "main",
            private: true,
            html_url: "https://github.com/drops/whale-app",
          });
        }
        if (endpoint.includes("/git/trees/main?recursive=1")) {
          return Response.json({
            truncated: true,
            tree: [{
              type: "blob",
              path: "app/page.tsx",
              sha: "1".repeat(40),
              size: 42,
            }],
          });
        }
        if (endpoint.includes("/git/blobs/")) blobRequests += 1;
        return Response.json({ message: "Unexpected provider request" }, { status: 500 });
      },
    }),
    (error) => {
      assert.equal(error.code, "GITHUB_IMPORT_TOO_LARGE");
      assert.equal(error.status, 413);
      return true;
    },
  );
  assert.equal(blobRequests, 0);
});
