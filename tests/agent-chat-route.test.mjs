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
      url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href,
    };
  },
});

process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";

const {
  createGuestIdentityCookie,
  GUEST_IDENTITY_COOKIE,
  resolveGuestCookieSecret,
} = await import("../lib/access-tier.ts");
const { handleAgentChatRequest } = await import("../app/api/agent/chat/route.ts");

function request(body, options = {}) {
  const cookie = createGuestIdentityCookie(
    "12345678-90ab-cdef-1234-567890abcdef",
    resolveGuestCookieSecret(),
  );
  return new NextRequest("https://studio.example.test/api/agent/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example.test",
      host: "studio.example.test",
      "x-forwarded-proto": "https",
      cookie: `${GUEST_IDENTITY_COOKIE}=${cookie}`,
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

function body(message = "What can this project do?") {
  return {
    projectId: "agent-chat-project",
    message,
    provider: { provider: "openrouter", model: "fixture/model" },
    context: {
      name: "Morning Alpha",
      presetId: "morning-alpha",
      description: "A sourced daily crypto briefing.",
      filePaths: ["app/page.tsx", "components/crypto-product.tsx"],
      recentMessages: [{ role: "user", content: message }],
    },
  };
}

test("connected model answers with project context without returning its credential", async () => {
  const calls = { resolved: null, generated: null };
  const response = await handleAgentChatRequest(request(body()), {
    async rememberConnection(_request, selection) {
      return {
        selection,
        credentials: { openRouterKey: "fixture-credential-not-a-secret" },
      };
    },
    modelResolver(selection, credentials) {
      calls.resolved = { selection, credentials };
      return {
        model: {},
        evidence: {
          provider: "openrouter",
          model: "fixture/model",
          credentialOwner: "visitor",
          keyPersisted: false,
        },
      };
    },
    async generate(input) {
      calls.generated = input;
      return { text: "This project creates a sourced morning market brief." };
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply, "This project creates a sourced morning market brief.");
  assert.equal(payload.provider, "openrouter");
  assert.equal(payload.model, "fixture/model");
  assert.doesNotMatch(JSON.stringify(payload), /fixture-credential/);
  assert.equal(calls.resolved.credentials.openRouterKey, "fixture-credential-not-a-secret");
  assert.match(calls.generated.prompt, /Morning Alpha/);
});

test("chat rejects credential material before invoking a model", async () => {
  let generated = false;
  const secret = ["sk", "proj", "A".repeat(30)].join("-");
  const response = await handleAgentChatRequest(request(body(`Use ${secret}`)), {
    async generate() {
      generated = true;
      return { text: "unreachable" };
    },
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "AGENT_CHAT_SECRET_REJECTED");
  assert.equal(generated, false);
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret));
});

test("chat streams plain text only when explicitly requested", async () => {
  const credential = "fixture-stream-credential-not-a-secret";
  const requestController = new AbortController();
  const calls = { generated: false, streamed: null, responseInit: null };
  const response = await handleAgentChatRequest(
    request(body("Stream the project summary."), {
      headers: { "x-drops-stream": "1" },
      signal: requestController.signal,
    }),
    {
      async rememberConnection(_request, selection) {
        return {
          selection,
          credentials: { openRouterKey: credential },
        };
      },
      modelResolver(selection) {
        return {
          model: {},
          evidence: {
            provider: selection.provider,
            model: selection.model,
            credentialOwner: "visitor",
            keyPersisted: false,
          },
        };
      },
      async generate() {
        calls.generated = true;
        return { text: "unreachable" };
      },
      stream(input) {
        calls.streamed = input;
        return {
          toTextStreamResponse(init) {
            calls.responseInit = init;
            return new Response("This project streams a sourced market brief.", {
              ...init,
              headers: {
                ...init?.headers,
                "content-type": "text/plain; charset=utf-8",
              },
            });
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(await response.text(), "This project streams a sourced market brief.");
  assert.equal(calls.generated, false);
  assert.ok(calls.streamed.abortSignal instanceof AbortSignal);
  assert.match(calls.streamed.prompt, /Morning Alpha/);
  assert.doesNotMatch(calls.streamed.prompt, new RegExp(credential));
  assert.doesNotMatch(JSON.stringify(calls.responseInit), new RegExp(credential));
  requestController.abort();
  assert.equal(calls.streamed.abortSignal.aborted, true);
});

test("chat also opts into text streaming through the Accept header", async () => {
  let streamed = false;
  const response = await handleAgentChatRequest(
    request(body("Stream with content negotiation."), {
      headers: { accept: "application/json, text/plain; q=0.9" },
    }),
    {
      async rememberConnection(_request, selection) {
        return { selection, credentials: {} };
      },
      modelResolver(selection) {
        return {
          model: {},
          evidence: {
            provider: selection.provider,
            model: selection.model,
            credentialOwner: "visitor",
            keyPersisted: false,
          },
        };
      },
      stream() {
        streamed = true;
        return {
          toTextStreamResponse(init) {
            return new Response("Negotiated stream", init);
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Negotiated stream");
  assert.equal(streamed, true);
});

test("chat drains a large chunk of bounded lines before applying the partial-line limit", async () => {
  const lines = Array.from(
    { length: 1_200 },
    (_, index) => `Verified project event ${index}.`,
  );
  const content = `${lines.join("\n")}\n`;
  assert.ok(content.length > 16_384);
  const response = await handleAgentChatRequest(
    request(body("Stream the complete project event log."), {
      headers: { "x-drops-stream": "1" },
    }),
    {
      async rememberConnection(_request, selection) {
        return { selection, credentials: {} };
      },
      modelResolver(selection) {
        return {
          model: {},
          evidence: {
            provider: selection.provider,
            model: selection.model,
            credentialOwner: "visitor",
            keyPersisted: false,
          },
        };
      },
      stream() {
        return {
          toTextStreamResponse(init) {
            return new Response(content, init);
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), content);
});

test("chat streaming never emits a secret line, including split provider tokens", async () => {
  const secret = `sk-proj-${"A".repeat(36)}`;
  const encoder = new TextEncoder();
  const response = await handleAgentChatRequest(
    request(body("Stream a safe summary."), {
      headers: { "x-drops-stream": "1" },
    }),
    {
      async rememberConnection(_request, selection) {
        return { selection, credentials: {} };
      },
      modelResolver(selection) {
        return {
          model: {},
          evidence: {
            provider: selection.provider,
            model: selection.model,
            credentialOwner: "visitor",
            keyPersisted: false,
          },
        };
      },
      stream() {
        return {
          toTextStreamResponse(init) {
            return new Response(new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode("Safe first line.\nCredential: sk-proj-"));
                controller.enqueue(encoder.encode(`${"A".repeat(36)}\n`));
                controller.close();
              },
            }), init);
          },
        };
      },
    },
  );

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "Safe first line.\n");
  await assert.rejects(reader.read(), /unsafe streaming response/i);
  assert.doesNotMatch(new TextDecoder().decode(first.value), new RegExp(secret));
});
