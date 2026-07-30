import assert from "node:assert/strict";
import test from "node:test";

const providerModule = await import("../lib/workspace-ai-provider.ts").catch(
  () => null,
);

function api() {
  assert.ok(providerModule, "workspace AI provider module must exist");
  return providerModule;
}

function request(overrides = {}) {
  return {
    prompt: "Turn this workspace into a live crypto research product.",
    baseRevision: 4,
    provider: "platform",
    workspace: {
      schemaVersion: 1,
      revision: 4,
      updatedAt: "2026-07-30T12:00:00.000Z",
      files: [
        {
          path: "src/app.js",
          content: 'console.log("existing");',
          language: "javascript",
          role: "client",
          editable: true,
        },
      ],
    },
    ...overrides,
  };
}

function modelPatch(overrides = {}) {
  return {
    baseRevision: 4,
    summary: "Create a real editable crypto research workspace.",
    operations: [
      {
        type: "update",
        path: "src/app.js",
        content: 'document.body.dataset.product = "research";',
      },
    ],
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function schemaKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) schemaKeys(entry, keys);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    schemaKeys(entry, keys);
  }
  return keys;
}

test("platform-funded generation always tries GPT-5.6 Sol before the free fallback", async () => {
  const { generateWorkspaceAiPatch, PLATFORM_WORKSPACE_MODELS } = api();
  const calls = [];
  const result = await generateWorkspaceAiPatch(
    request(),
    { identity: "guest-workspace-123456" },
    {
      env: { AI_GATEWAY_API_KEY: "gateway-test-token" },
      now: () => new Date("2026-07-30T12:02:00.000Z"),
      async platformGenerate(input) {
        calls.push(input);
        if (input.model === "openai/gpt-5.6-sol") {
          throw new Error("capacity");
        }
        return { output: modelPatch(), providerRequestId: "req-gateway-2" };
      },
    },
  );

  assert.deepEqual(
    calls.map((entry) => entry.model),
    [...PLATFORM_WORKSPACE_MODELS],
  );
  assert.equal(calls[0].schema, calls[1].schema);
  assert.equal(result.patch.baseRevision, 4);
  assert.deepEqual(result.evidence, {
    status: "provider-response",
    provider: "vercel-ai-gateway",
    model: PLATFORM_WORKSPACE_MODELS[1],
    requestedModel: null,
    providerRequestId: "req-gateway-2",
    credentialOwner: "platform",
    keyPersisted: false,
    billing: "platform-funded",
    schemaEnforcement: "ai-sdk-output-object",
    generatedAt: "2026-07-30T12:02:00.000Z",
  });
});

test("platform generation is honestly unavailable without gateway credentials", async () => {
  const {
    generateWorkspaceAiPatch,
    WorkspaceAiProviderUnavailableError,
  } = api();

  await assert.rejects(
    () =>
      generateWorkspaceAiPatch(request(), { identity: "guest-1234567890" }, {
        env: {},
      }),
    WorkspaceAiProviderUnavailableError,
  );
});

test("OpenRouter uses request-only BYOK, strict JSON Schema and no Studio markup", async () => {
  const { generateWorkspaceAiPatch } = api();
  let fetchInput;
  const result = await generateWorkspaceAiPatch(
    request({ provider: "openrouter", model: "openrouter/free" }),
    {
      identity: "member-1234567890",
      openRouterKey: "sk-or-v1-request-only-test-key",
    },
    {
      now: () => new Date("2026-07-30T12:03:00.000Z"),
      async fetch(input, init) {
        fetchInput = { input: String(input), init };
        return jsonResponse({
          id: "gen-openrouter-123",
          choices: [{ message: { content: JSON.stringify(modelPatch()) } }],
        });
      },
    },
  );

  const sent = JSON.parse(fetchInput.init.body);
  assert.equal(fetchInput.input, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(
    fetchInput.init.headers.authorization,
    "Bearer sk-or-v1-request-only-test-key",
  );
  assert.equal(sent.response_format.type, "json_schema");
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.response_format.json_schema.schema.additionalProperties, false);
  const openRouterSchemaKeys = schemaKeys(
    sent.response_format.json_schema.schema,
  );
  for (const keyword of [
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
  ]) {
    assert.equal(openRouterSchemaKeys.has(keyword), false, keyword);
  }
  assert.equal(sent.provider.require_parameters, true);
  assert.equal(result.evidence.provider, "openrouter");
  assert.equal(result.evidence.providerRequestId, "gen-openrouter-123");
  assert.equal(result.evidence.credentialOwner, "visitor");
  assert.equal(result.evidence.keyPersisted, false);
  assert.equal(result.evidence.billing, "provider-direct-no-studio-markup");
  assert.equal(result.evidence.schemaEnforcement, "provider-json-schema");
  assert.doesNotMatch(JSON.stringify(result), /request-only-test-key/);
});

test("Anthropic returns only a forced schema tool input and never executes tools", async () => {
  const { generateWorkspaceAiPatch } = api();
  let sent;
  const result = await generateWorkspaceAiPatch(
    request({ provider: "anthropic" }),
    {
      identity: "member-1234567890",
      providerKey: "sk-ant-request-only-test-key",
    },
    {
      async fetch(_input, init) {
        sent = JSON.parse(init.body);
        return jsonResponse({
          id: "msg-anthropic-123",
          content: [
            {
              type: "tool_use",
              name: "submit_workspace_patch",
              input: modelPatch(),
            },
          ],
        });
      },
    },
  );

  assert.equal(sent.tool_choice.type, "tool");
  assert.equal(sent.tool_choice.name, "submit_workspace_patch");
  assert.equal(sent.tools.length, 1);
  assert.equal(sent.tools[0].input_schema.additionalProperties, false);
  const anthropicSchemaKeys = schemaKeys(sent.tools[0].input_schema);
  for (const keyword of [
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
  ]) {
    assert.equal(anthropicSchemaKeys.has(keyword), false, keyword);
  }
  assert.equal(result.evidence.schemaEnforcement, "forced-tool-schema");
  assert.equal(result.patch.operations[0].type, "update");
});

test("OpenAI GPT-5.6 Sol uses strict schema output without unsupported sampling fields", async () => {
  const { generateWorkspaceAiPatch } = api();
  let sent;
  await generateWorkspaceAiPatch(
    request({ provider: "openai" }),
    {
      identity: "member-1234567890",
      providerKey: "sk-proj-request-only-test-key-123456",
    },
    {
      async fetch(_input, init) {
        sent = JSON.parse(init.body);
        return jsonResponse({
          id: "resp-openai-123",
          choices: [{ message: { content: JSON.stringify(modelPatch()) } }],
        });
      },
    },
  );

  assert.equal(sent.model, "gpt-5.6-sol");
  assert.equal(sent.response_format.type, "json_schema");
  assert.equal(sent.max_completion_tokens, 24_000);
  assert.equal("temperature" in sent, false);
});

test("direct providers reject missing keys and invalid model output", async () => {
  const {
    generateWorkspaceAiPatch,
    WorkspaceAiProviderResponseError,
    WorkspaceAiProviderUnavailableError,
  } = api();

  await assert.rejects(
    () => generateWorkspaceAiPatch(request({ provider: "openai" }), {}),
    WorkspaceAiProviderUnavailableError,
  );

  await assert.rejects(
    () =>
      generateWorkspaceAiPatch(
        request({ provider: "kimi" }),
        { providerKey: "moonshot-request-only-key-123" },
        {
          async fetch() {
            return jsonResponse({
              id: "kimi-invalid",
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      baseRevision: 4,
                      summary: "Unsafe raw command response",
                      operations: [
                        {
                          type: "update",
                          path: "src/app.js",
                          content: "console.log('safe')",
                          command: "sh -c whoami",
                        },
                      ],
                    }),
                  },
                },
              ],
            });
          },
        },
      ),
    WorkspaceAiProviderResponseError,
  );
});
