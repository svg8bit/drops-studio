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

function request(body) {
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
    },
    body: JSON.stringify(body),
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
