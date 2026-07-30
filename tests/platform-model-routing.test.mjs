import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";

const { PLATFORM_PLAN_MODELS, POST } = await import(
  "../app/api/agent/plan/route.ts"
);
const access = await import("../lib/access-tier.ts");

test("platform-funded planning starts with GPT-5.6 Sol for guests and members", () => {
  assert.equal(PLATFORM_PLAN_MODELS.guest[0], "openai/gpt-5.6-sol");
  assert.equal(PLATFORM_PLAN_MODELS.member[0], "openai/gpt-5.6-sol");
  assert.ok(PLATFORM_PLAN_MODELS.guest.length <= 2);
  assert.ok(PLATFORM_PLAN_MODELS.member.length <= 2);
});

test("planning rejects cross-origin, non-JSON, and oversized requests before provider work", async () => {
  const crossOrigin = await POST(new NextRequest("https://studio.example.test/api/agent/plan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ prompt: "Build a wallet monitor" }),
  }));
  assert.equal(crossOrigin.status, 403);

  const nonJson = await POST(new NextRequest("https://studio.example.test/api/agent/plan", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ prompt: "Build a wallet monitor" }),
  }));
  assert.equal(nonJson.status, 415);

  const oversized = await POST(new NextRequest("https://studio.example.test/api/agent/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "x".repeat(25_000) }),
  }));
  assert.equal(oversized.status, 413);
});

test("platform planning consumes the request-scoped Vercel Function OIDC header without returning it", async () => {
  const names = [
    "NODE_ENV",
    "DROPS_GUEST_COOKIE_SECRET",
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
    "DROPS_STUDIO_LOCAL_PROJECT_STORE",
    "VERCEL",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const secret = "platform-model-route-secret-with-thirty-two-bytes";
  const identity = "11111111-2222-4333-8444-555555555555";
  const oidc = `ey${"A".repeat(24)}.ey${"B".repeat(24)}.${"C".repeat(32)}`;
  let authorization = null;
  process.env.NODE_ENV = "test";
  process.env.DROPS_GUEST_COOKIE_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.fetch = async (_url, init = {}) => {
    authorization = new Headers(init.headers).get("authorization");
    return Response.json({ error: { message: "capacity unavailable" } }, { status: 503 });
  };
  try {
    const identityCookie = access.createGuestIdentityCookie(identity, secret);
    const response = await POST(new NextRequest("https://studio.example.test/api/agent/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${identityCookie}`,
        "x-forwarded-for": "203.0.113.44",
        "x-vercel-oidc-token": oidc,
      },
      body: JSON.stringify({ prompt: "Build a sourced crypto research product" }),
    }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(authorization, `Bearer ${oidc}`);
    assert.equal(JSON.stringify(payload).includes(oidc), false);
    assert.equal(payload.tier, "fallback");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
