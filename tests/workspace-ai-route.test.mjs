import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const routeModule = await import("../app/api/workspace/patch/route.ts").catch(
  () => null,
);
const providerModule = await import("../lib/workspace-ai-provider.ts");
const entitlementModule = await import("../lib/workspace-ai-entitlement.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { compileProject } = await import("../lib/project-compiler.ts");
const { materializeProjectWorkspace } = await import(
  "../lib/project-workspace.ts"
);

function api() {
  assert.ok(routeModule, "workspace AI patch route must exist");
  return routeModule;
}

function workspace() {
  const spec = createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a runnable crypto market explorer",
    tools: ["DropsTab API", "Drops Bot alerts"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "No prediction selected",
      probability: null,
      change: null,
    },
    origin: "https://drops-studio.example",
  });
  const now = "2026-07-30T12:00:00.000Z";
  return materializeProjectWorkspace({
    id: "workspace-ai-route",
    spec,
    html: compileProject(spec),
    createdAt: now,
    updatedAt: now,
  });
}

function requestBody(overrides = {}) {
  const current = workspace();
  return {
    prompt: "Add a distinct live market research mode to this product.",
    baseRevision: current.revision,
    workspace: current,
    provider: "platform",
    ...overrides,
  };
}

function request(body, headers = {}) {
  return new NextRequest("https://drops-studio.example/api/workspace/patch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "drops-studio.example",
      origin: "https://drops-studio.example",
      "x-drops-session": "12345678-1234-1234-1234-123456789abc",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function providerResult(baseRevision, overrides = {}) {
  return {
    patch: {
      baseRevision,
      summary: "Add a distinct editable market research mode.",
      operations: [
        {
          type: "create",
          path: "src/market-research.js",
          content: "export const researchMode = 'verified-sources';",
          language: "javascript",
          role: "client",
        },
      ],
    },
    evidence: {
      status: "provider-response",
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.6-sol",
      requestedModel: null,
      providerRequestId: "req-workspace-real-123",
      credentialOwner: "platform",
      keyPersisted: false,
      billing: "platform-funded",
      schemaEnforcement: "ai-sdk-output-object",
      generatedAt: "2026-07-30T12:05:00.000Z",
    },
    ...overrides,
  };
}

const allow = async () => "allowed";
const reserveGuestQuota = async () => ({
  tier: "guest",
  identity: "12345678-1234-1234-1234-123456789abc",
  account: null,
  limit: 3,
  used: 1,
  remaining: 2,
  reset: "daily-utc",
  cookies: [],
});

test("returns one canonical runnable workspace revision with provider evidence", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody();
  const response = await handleWorkspaceAiPatchRequest(request(body), {
    consumeLimit: allow,
    reservePlatformQuota: reserveGuestQuota,
    now: () => new Date("2026-07-30T12:06:00.000Z"),
    async generate(input) {
      return providerResult(input.baseRevision);
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(payload.workspace.revision, body.baseRevision + 1);
  assert.equal(
    payload.workspace.files.some(
      (item) => item.path === "src/market-research.js",
    ),
    true,
  );
  assert.deepEqual(payload.change, {
    baseRevision: body.baseRevision,
    revision: body.baseRevision + 1,
    summary: "Add a distinct editable market research mode.",
    created: 1,
    updated: 0,
    deleted: 0,
  });
  assert.equal(payload.validation.status, "canonical-compiled");
  assert.equal(payload.validation.persisted, false);
  assert.ok(payload.validation.compiledRuntimeBytes > 1_000);
  assert.equal(payload.providerEvidence.providerRequestId, "req-workspace-real-123");
  assert.equal(payload.providerEvidence.keyPersisted, false);
  assert.equal(payload.spec.presetId, "crypto-aggregator");
  assert.deepEqual(payload.quota, {
    tier: "guest",
    limit: 3,
    used: 1,
    remaining: 2,
    reset: "daily-utc",
  });
});

test("rejects cross-origin requests before rate limits or model calls", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  let touched = false;
  const response = await handleWorkspaceAiPatchRequest(
    request(requestBody(), {
      origin: "https://attacker.invalid",
      "sec-fetch-site": "cross-site",
    }),
    {
      async consumeLimit() {
        touched = true;
        return "allowed";
      },
      async generate() {
        touched = true;
        throw new Error("must not run");
      },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(touched, false);

  const missingOrigin = request(requestBody());
  missingOrigin.headers.delete("origin");
  const missingOriginResponse = await handleWorkspaceAiPatchRequest(
    missingOrigin,
    {
      async consumeLimit() {
        touched = true;
        return "allowed";
      },
    },
  );
  assert.equal(missingOriginResponse.status, 403);
  assert.equal(touched, false);
});

test("rejects JSON-like media types before rate limits or model calls", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  let touched = false;
  const response = await handleWorkspaceAiPatchRequest(
    request(requestBody(), { "content-type": "application/jsonp" }),
    {
      async consumeLimit() {
        touched = true;
        return "allowed";
      },
      async generate() {
        touched = true;
        throw new Error("must not run");
      },
    },
  );

  assert.equal(response.status, 415);
  assert.equal(touched, false);
});

test("rejects credentials in the JSON body; BYOK is request-header only", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  let generated = false;
  const response = await handleWorkspaceAiPatchRequest(
    request(requestBody({ key: "sk-proj-never-accept-body-key-123456" })),
    {
      consumeLimit: allow,
      async generate() {
        generated = true;
        throw new Error("must not run");
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.match(payload.error, /bounded workspace AI request/i);
  assert.equal(generated, false);
});

test("returns an optimistic 409 conflict without generating a patch", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody();
  body.baseRevision += 1;
  let generated = false;
  const response = await handleWorkspaceAiPatchRequest(request(body), {
    consumeLimit: allow,
    async generate() {
      generated = true;
      throw new Error("must not run");
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.code, "WORKSPACE_REVISION_CONFLICT");
  assert.equal(payload.expectedRevision, body.workspace.revision);
  assert.equal(generated, false);
});

test("returns an honest 503 when platform generation is unconfigured", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const response = await handleWorkspaceAiPatchRequest(request(requestBody()), {
    consumeLimit: allow,
    reservePlatformQuota: reserveGuestQuota,
    async generate() {
      throw new providerModule.WorkspaceAiProviderUnavailableError();
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.code, "WORKSPACE_AI_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(payload), /fallback|mock|static html/i);
});

test("rejects provider output that passes operation validation but breaks canonical runtime", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody();
  const index = body.workspace.files.find((item) => item.path === "index.html");
  assert.ok(index);
  assert.match(index.content, /<script src="\.\/src\/app\.js"><\/script>/);
  const response = await handleWorkspaceAiPatchRequest(request(body), {
    consumeLimit: allow,
    reservePlatformQuota: reserveGuestQuota,
    async generate(input) {
      return providerResult(input.baseRevision, {
        patch: {
          baseRevision: input.baseRevision,
          summary: "Break the entrypoint while returning valid file operations.",
          operations: [
            {
              type: "update",
              path: "index.html",
              content: index.content.replace(
                '<script src="./src/app.js"></script>',
                "",
              ),
            },
          ],
        },
      });
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.code, "WORKSPACE_AI_INVALID_REVISION");
  assert.equal("workspace" in payload, false);
});

test("rejects arbitrary scripts introduced by a provider-created package", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody();
  const rootFile = body.workspace.files.find(
    (item) => item.path === "package.json",
  );
  assert.ok(rootFile);
  const root = JSON.parse(rootFile.content);
  root.workspaces = ["packages/worker"];
  const response = await handleWorkspaceAiPatchRequest(request(body), {
    consumeLimit: allow,
    reservePlatformQuota: reserveGuestQuota,
    async generate(input) {
      return providerResult(input.baseRevision, {
        patch: {
          baseRevision: input.baseRevision,
          summary: "Add a package with an unapproved provider-defined script.",
          operations: [
            {
              type: "update",
              path: "package.json",
              content: JSON.stringify(root),
            },
            {
              type: "create",
              path: "packages/worker/package.json",
              content: JSON.stringify({
                private: true,
                scripts: { sendAnywhere: "node send.mjs" },
              }),
              language: "json",
              role: "package-manifest",
            },
          ],
        },
      });
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.code, "WORKSPACE_AI_INVALID_REVISION");
  assert.equal("workspace" in payload, false);
});

test("rejects a model category hop and returns the validated spec on accepted revisions", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody();
  const projectFile = body.workspace.files.find(
    (item) => item.path === "project.json",
  );
  const index = body.workspace.files.find((item) => item.path === "index.html");
  assert.ok(projectFile);
  assert.ok(index);
  assert.match(index.content, /data-project-kind="crypto-aggregator"/);
  const nextSpec = { ...JSON.parse(projectFile.content), presetId: "crypto-game" };
  const response = await handleWorkspaceAiPatchRequest(request(body), {
    consumeLimit: allow,
    reservePlatformQuota: reserveGuestQuota,
    async generate(input) {
      return providerResult(input.baseRevision, {
        patch: {
          baseRevision: input.baseRevision,
          summary: "Attempt to change the product category in place.",
          operations: [
            {
              type: "update",
              path: "project.json",
              content: JSON.stringify(nextSpec),
            },
            {
              type: "update",
              path: "index.html",
              content: index.content.replace(
                'data-project-kind="crypto-aggregator"',
                'data-project-kind="crypto-game"',
              ),
            },
          ],
        },
      });
    },
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.code, "WORKSPACE_AI_CATEGORY_MISMATCH");
  assert.equal("spec" in payload, false);
  assert.equal("workspace" in payload, false);
});

test("enforces platform daily entitlements but BYOK does not spend them", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const limited = await handleWorkspaceAiPatchRequest(request(requestBody()), {
    consumeLimit: allow,
    async reservePlatformQuota() {
      throw new entitlementModule.WorkspaceAiQuotaLimitError("guest", 3);
    },
    async generate() {
      throw new Error("must not run");
    },
  });
  const limitedPayload = await limited.json();
  assert.equal(limited.status, 429);
  assert.equal(limitedPayload.code, "WORKSPACE_AI_DAILY_LIMIT");
  assert.equal(limitedPayload.limit, 3);

  const byokBody = requestBody({
    provider: "openrouter",
    model: "openrouter/free",
  });
  let quotaTouched = false;
  const byok = await handleWorkspaceAiPatchRequest(
    request(byokBody, {
      "x-openrouter-key": "sk-or-v1-header-only-quota-test-123",
    }),
    {
      consumeLimit: allow,
      async reservePlatformQuota() {
        quotaTouched = true;
        throw new Error("BYOK must not reserve platform quota");
      },
      async generate(input) {
        return providerResult(input.baseRevision, {
          evidence: {
            ...providerResult(input.baseRevision).evidence,
            provider: "openrouter",
            model: "openrouter/free",
            credentialOwner: "visitor",
            billing: "provider-direct-no-studio-markup",
            schemaEnforcement: "provider-json-schema",
          },
        });
      },
    },
  );
  const byokPayload = await byok.json();
  assert.equal(byok.status, 200);
  assert.equal(quotaTouched, false);
  assert.equal(byokPayload.quota, null);
  assert.equal(byokPayload.providerEvidence.billing, "provider-direct-no-studio-markup");
});

test("passes BYOK only to the provider call and never returns it", async () => {
  const { handleWorkspaceAiPatchRequest } = api();
  const body = requestBody({ provider: "openrouter", model: "openrouter/free" });
  let credentials;
  let quotaTouched = false;
  const response = await handleWorkspaceAiPatchRequest(
    request(body, { "x-openrouter-key": "sk-or-v1-header-only-secret-123" }),
    {
      consumeLimit: allow,
      async reservePlatformQuota() {
        quotaTouched = true;
        throw new Error("BYOK must not reserve platform quota");
      },
      async generate(input, receivedCredentials) {
        credentials = receivedCredentials;
        return providerResult(input.baseRevision, {
          evidence: {
            ...providerResult(input.baseRevision).evidence,
            provider: "openrouter",
            model: "openrouter/free",
            credentialOwner: "visitor",
            billing: "provider-direct-no-studio-markup",
            schemaEnforcement: "provider-json-schema",
          },
        });
      },
    },
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(credentials.openRouterKey, "sk-or-v1-header-only-secret-123");
  assert.equal(credentials.providerKey, undefined);
  assert.equal(quotaTouched, false);
  assert.doesNotMatch(text, /header-only-secret/);
});
