import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NextRequest } from "next/server.js";

test("Telegram verification rejects cross-origin send requests before provider calls", async () => {
  const { POST } = await import("../app/api/telegram/verify/route.ts");
  const previousFetch = globalThis.fetch;
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  let providerCalls = 0;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ ok: true, result: {} });
  };

  try {
    const response = await POST(new NextRequest("https://drops.example/api/telegram/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "cf-connecting-ip": "203.0.113.41",
      },
      body: JSON.stringify({
        token: `123456789:${"A".repeat(35)}`,
        channel: "@alpha_test",
        message: "Cross-origin test",
        sendTest: true,
      }),
    }));

    assert.equal(response.status, 403);
    assert.equal(providerCalls, 0);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("published cloud apps and exported Telegram verification use same-origin boundaries", async () => {
  const [publishedRoute, exporter] = await Promise.all([
    readFile(new URL("../app/p/[slug]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-export.ts", import.meta.url), "utf8"),
  ]);
  const telegramFunctionStart = exporter.indexOf("const telegramFunction");
  const publicDataFunctionStart = exporter.indexOf("const publicDataFunction");

  assert.notEqual(telegramFunctionStart, -1, "Telegram function marker must exist in the exporter");
  assert.notEqual(publicDataFunctionStart, -1, "public-data function marker must exist in the exporter");
  assert.ok(
    publicDataFunctionStart > telegramFunctionStart,
    "Telegram function marker must precede the public-data function marker",
  );

  const telegramFunction = exporter.slice(telegramFunctionStart, publicDataFunctionStart);

  assert.match(publishedRoute, /frame-ancestors 'self'/);
  assert.doesNotMatch(publishedRoute, /frame-ancestors \*/);
  assert.match(telegramFunction, /sameOrigin/);
  assert.doesNotMatch(telegramFunction, /access-control-allow-origin[^\n]*\*/i);
});

test("OpenRouter callback tolerates non-JSON exchange responses with a stable fallback", async () => {
  const callbackPage = await readFile(
    new URL("../app/auth/openrouter/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(callbackPage, /response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(callbackPage, /payload\.error \?\? "OpenRouter connection failed\."/);
});

test("OpenRouter exchange logs provider failures without exposing their details to the browser", async () => {
  const { POST } = await import("../app/api/auth/openrouter/exchange/route.ts");
  const previous = {
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const logged = [];
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = "test-account-secret-with-enough-entropy";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.fetch = async () => {
    throw new Error("provider exploded with private infrastructure details");
  };
  console.error = (...values) => logged.push(values);

  try {
    const response = await POST(new NextRequest("http://localhost/api/auth/openrouter/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.71",
      },
      body: JSON.stringify({ code: "oauth-code", codeVerifier: "pkce-verifier" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error, "OpenRouter authorization failed. Try again.");
    assert.doesNotMatch(JSON.stringify(payload), /private infrastructure details/i);
    assert.ok(logged.some((values) => values.some((value) => value instanceof Error)));
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Telegram channel completion and release are fenced to the active lease", async () => {
  const telegram = await import("../lib/telegram-account.ts");
  assert.equal(typeof telegram.claimTelegramChannelRequest, "function");
  assert.equal(typeof telegram.completeTelegramChannelRequest, "function");
  assert.equal(typeof telegram.releaseTelegramChannelRequest, "function");

  let version = 0;
  const records = new Map();
  const storage = {
    async get(pathname) {
      const current = records.get(pathname);
      if (!current) return null;
      return {
        statusCode: 200,
        stream: new Blob([current.body]).stream(),
        blob: { etag: current.etag },
      };
    },
    async put(pathname, body, options = {}) {
      const current = records.get(pathname);
      if (options.allowOverwrite === false && current) throw new Error("exists");
      if (options.ifMatch && current?.etag !== options.ifMatch) throw new Error("etag mismatch");
      version += 1;
      const stored = { body: String(body), etag: `etag-${version}` };
      records.set(pathname, stored);
      return { pathname, etag: stored.etag };
    },
  };
  const originalNow = Date.now;
  let now = Date.parse("2026-07-30T00:00:00.000Z");
  Date.now = () => now;
  const result = {
    id: "-1001234567890",
    title: "Alpha",
    url: "https://t.me/alpha_test",
    botUsername: "@drops_test_bot",
    botAdded: true,
    firstPostSent: true,
    firstPostMessageId: 77,
    dmSent: false,
    dmStartUrl: "https://t.me/drops_test_bot?start=drops_studio",
    warnings: [],
    accountToken: "browser-only",
  };

  try {
    const first = await telegram.claimTelegramChannelRequest("account-1", "11111111-1111-4111-8111-111111111111", storage);
    now += 2 * 60 * 1_000 + 1;
    const second = await telegram.claimTelegramChannelRequest("account-1", "11111111-1111-4111-8111-111111111111", storage);

    assert.notEqual(first.leaseId, second.leaseId);
    assert.equal(await telegram.releaseTelegramChannelRequest(first, storage), false);
    await assert.rejects(
      telegram.completeTelegramChannelRequest(first, result, storage),
      /lease|progress|superseded/i,
    );
    await telegram.completeTelegramChannelRequest(second, result, storage);

    const stored = JSON.parse(records.get(second.pathname).body);
    assert.equal(stored.status, "completed");
    assert.equal(stored.leaseId, second.leaseId);
    assert.equal(stored.result.firstPostMessageId, 77);
  } finally {
    Date.now = originalNow;
  }
});

test("Telegram claim race never revives expired completed or stale pending requests", async () => {
  const telegram = await import("../lib/telegram-account.ts");
  const originalNow = Date.now;
  const now = Date.parse("2026-07-30T00:00:00.000Z");
  Date.now = () => now;
  const completedResult = {
    id: "-1001234567890",
    title: "Expired Alpha",
    url: "https://t.me/expired_alpha_test",
    botUsername: "@drops_test_bot",
    botAdded: true,
    firstPostSent: true,
    firstPostMessageId: 77,
    dmSent: false,
    dmStartUrl: "https://t.me/drops_test_bot?start=drops_studio",
    warnings: [],
  };

  function racedStorage(record) {
    let reads = 0;
    return {
      async get() {
        reads += 1;
        if (reads === 1) return null;
        return {
          statusCode: 200,
          stream: new Blob([JSON.stringify(record)]).stream(),
          blob: { etag: "raced-etag" },
        };
      },
      async put() {
        throw new Error("conditional write lost");
      },
    };
  }

  try {
    await assert.rejects(
      telegram.claimTelegramChannelRequest(
        "account-expired",
        "22222222-2222-4222-8222-222222222222",
        racedStorage({
          status: "completed",
          leaseId: "33333333-3333-4333-8333-333333333333",
          createdAt: now - 9 * 60 * 60 * 1_000,
          expiresAt: now - 1,
          result: completedResult,
        }),
      ),
      /temporarily unavailable/i,
    );
    await assert.rejects(
      telegram.claimTelegramChannelRequest(
        "account-stale",
        "44444444-4444-4444-8444-444444444444",
        racedStorage({
          status: "pending",
          leaseId: "55555555-5555-4555-8555-555555555555",
          createdAt: now - 3 * 60 * 1_000,
          expiresAt: now + 60 * 60 * 1_000,
        }),
      ),
      /temporarily unavailable/i,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("Telegram claim race hides storage read failures behind a safe error", async () => {
  const telegram = await import("../lib/telegram-account.ts");
  let reads = 0;
  const storage = {
    async get() {
      reads += 1;
      if (reads === 1) return null;
      throw new Error("private storage topology leaked");
    },
    async put() {
      throw new Error("conditional write lost");
    },
  };

  await assert.rejects(
    telegram.claimTelegramChannelRequest(
      "account-read-failure",
      "66666666-6666-4666-8666-666666666666",
      storage,
    ),
    (error) => {
      assert.equal(error.message, "Secure Telegram channel creation is temporarily unavailable.");
      assert.doesNotMatch(error.message, /topology|storage/i);
      return true;
    },
  );
});

test("guest Gateway failures consume allowance and fan out to at most two providers", async () => {
  const access = await import("../lib/access-tier.ts");
  const { POST } = await import("../app/api/agent/plan/route.ts");
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_GUEST_COOKIE_SECRET: process.env.DROPS_GUEST_COOKIE_SECRET,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  const previousFetch = globalThis.fetch;
  const identity = "2f22b0f5-4c61-48f4-8c14-e279389d963f";
  const secret = "test-secret-with-enough-entropy";
  let providerCalls = 0;
  process.env.NODE_ENV = "test";
  process.env.DROPS_GUEST_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ error: { message: "capacity unavailable" } }, { status: 503 });
  };

  try {
    const identityCookie = access.createGuestIdentityCookie(identity, secret);
    const usageCookie = access.createGuestUsageCookie({
      date: new Date().toISOString().slice(0, 10),
      count: 0,
      identity,
    }, secret);
    const response = await POST(new NextRequest("http://localhost/api/agent/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${access.GUEST_IDENTITY_COOKIE}=${identityCookie}; ${access.GUEST_USAGE_COOKIE}=${usageCookie}`,
        "x-forwarded-for": "203.0.113.61",
      },
      body: JSON.stringify({ prompt: "Build a real crypto radio" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.tier, "fallback");
    assert.equal(payload.remaining, access.GUEST_DAILY_LIMIT - 1);
    assert.equal(payload.access.platformAi.remaining, access.GUEST_DAILY_LIMIT - 1);
    assert.ok(providerCalls > 0);
    assert.ok(providerCalls <= 2, `expected no more than 2 provider calls, received ${providerCalls}`);
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${access.GUEST_USAGE_COOKIE}=`));
    assert.ok(
      [...globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__.keys()].some((key) => key.startsWith("guest-ai-plan-ip:")),
      "expected a durable IP limiter reservation before Gateway",
    );
    assert.ok(
      [...globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__.keys()].some((key) => key.startsWith("guest-ai-plan:")),
      "expected a durable guest allowance reservation before Gateway",
    );
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("visible product and hosting copy scopes the twelve foundations and static-only exports", async () => {
  const [page, builder, studio] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /12 extensible working foundations/i);
  assert.doesNotMatch(page, /describe anything/i);
  assert.match(builder, /12 extensible working foundations/i);
  assert.doesNotMatch(builder, /Blank canvas enabled\. Describe anything/i);
  assert.match(studio, /Static hosting · custom domain/);
  assert.doesNotMatch(studio, /Static deploy · functions/);
});
