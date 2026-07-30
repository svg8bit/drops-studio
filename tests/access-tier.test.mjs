import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as accessTierModule from "../lib/access-tier.ts";

const {
  GUEST_DAILY_LIMIT,
  MEMBER_DAILY_LIMIT,
  PRO_DAILY_LIMIT,
  MEMBER_USAGE_COOKIE,
  STUDIO_ACCOUNT_COOKIE,
  accessMetadata,
  createGuestIdentityCookie,
  createGuestUsageCookie,
  createStudioAccountCookie,
  readGuestIdentityCookie,
  readGuestUsageCookie,
  readStudioAccountCookie,
  resolveAccountCookieSecret,
  resolveGuestCookieSecret,
  resolveStudioProjectActor,
} = accessTierModule;

const secret = "test-secret-with-enough-entropy";
const identity = "2f22b0f5-4c61-48f4-8c14-e279389d963f";
const today = "2026-07-29";
const accountSubject = "user_8bit-drops-studio-test";

test("signed anonymous identity rejects tampering", () => {
  const cookie = createGuestIdentityCookie(identity, secret);

  assert.equal(readGuestIdentityCookie(cookie, secret), identity);
  assert.equal(readGuestIdentityCookie(cookie.replace(identity, `${identity}x`), secret), null);
  assert.equal(readGuestIdentityCookie(cookie, `${secret}-wrong`), null);
});

test("signed guest and member sessions resolve stable isolated project owners", () => {
  const guestCookie = createGuestIdentityCookie(identity, secret);
  const guest = resolveStudioProjectActor(
    { guestCookie },
    { NODE_ENV: "test", DROPS_GUEST_COOKIE_SECRET: secret },
  );
  const repeated = resolveStudioProjectActor(
    { guestCookie },
    { NODE_ENV: "test", DROPS_GUEST_COOKIE_SECRET: secret },
  );
  assert.equal(guest.kind, "guest");
  assert.match(guest.identity, /^[a-f0-9]{64}$/);
  assert.equal(repeated.identity, guest.identity);
  assert.equal(
    resolveStudioProjectActor(
      { guestCookie: `${guestCookie}x` },
      { NODE_ENV: "test", DROPS_GUEST_COOKIE_SECRET: secret },
    ),
    null,
  );

  const memberCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: accountSubject },
    secret,
  );
  const member = resolveStudioProjectActor(
    { accountCookie: memberCookie, guestCookie },
    { NODE_ENV: "test", DROPS_ACCOUNT_COOKIE_SECRET: secret, DROPS_GUEST_COOKIE_SECRET: secret },
  );
  assert.equal(member.kind, "member");
  assert.equal(member.identity, readStudioAccountCookie(memberCookie, secret).identity);
});

test("daily usage is bound to both day and signed anonymous identity", () => {
  const cookie = createGuestUsageCookie({ date: today, count: 2, identity }, secret);

  assert.equal(readGuestUsageCookie(cookie, { date: today, identity, secret }), 2);
  assert.equal(readGuestUsageCookie(cookie, { date: "2026-07-30", identity, secret }), 0);
  assert.equal(
    readGuestUsageCookie(cookie, {
      date: today,
      identity: "4e631968-b1a7-4011-84fc-5f7dfbaf2808",
      secret,
    }),
    0,
  );
  assert.equal(readGuestUsageCookie(cookie.replace(".2.", ".1."), { date: today, identity, secret }), 0);
});

test("production quota signing requires the dedicated stable secret", () => {
  assert.equal(
    resolveGuestCookieSecret({
      NODE_ENV: "production",
      VERCEL_OIDC_TOKEN: "short-lived-and-rotating",
    }),
    "",
  );
  assert.equal(
    resolveGuestCookieSecret({
      NODE_ENV: "production",
      DROPS_GUEST_COOKIE_SECRET: "g".repeat(48),
      VERCEL_OIDC_TOKEN: "short-lived-and-rotating",
    }),
    "g".repeat(48),
  );
  assert.match(resolveGuestCookieSecret({ NODE_ENV: "development" }), /development-only/);
});

test("production signing rejects weak secrets and shared readiness reflects every required backend", () => {
  assert.equal(typeof accessTierModule.platformAiReadiness, "function");
  assert.equal(resolveGuestCookieSecret({
    NODE_ENV: "production",
    DROPS_GUEST_COOKIE_SECRET: "too-short",
  }), "");
  assert.equal(resolveAccountCookieSecret({
    NODE_ENV: "production",
    DROPS_ACCOUNT_COOKIE_SECRET: "too-short",
    DROPS_GUEST_COOKIE_SECRET: "g".repeat(48),
  }), "");

  const base = {
    NODE_ENV: "production",
    DROPS_GUEST_COOKIE_SECRET: "g".repeat(48),
    DROPS_ACCOUNT_COOKIE_SECRET: "a".repeat(48),
    AI_GATEWAY_API_KEY: "gateway-token",
  };
  assert.equal(accessTierModule.platformAiReadiness("guest", base).available, false);
  assert.equal(accessTierModule.platformAiReadiness("guest", {
    ...base,
    BLOB_READ_WRITE_TOKEN: "blob-token",
  }).available, true);
  assert.equal(accessTierModule.platformAiReadiness("member", base).available, false);
  assert.equal(accessTierModule.platformAiReadiness("member", {
    ...base,
    BLOB_READ_WRITE_TOKEN: "blob-token",
  }).available, true);
  assert.equal(accessTierModule.platformAiReadiness("guest", {
    ...base,
    AI_GATEWAY_API_KEY: "",
  }).available, false);
});

test("OpenRouter member identity is signed, private and rejects tampering or expiry", () => {
  const issuedAt = Math.floor(Date.parse("2026-07-29T12:00:00Z") / 1_000);
  const cookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject, issuedAt }, secret);
  const account = readStudioAccountCookie(cookie, secret, Date.parse("2026-07-29T12:05:00Z"));

  assert.equal(account?.provider, "openrouter");
  assert.equal(account?.subject, accountSubject);
  assert.match(account?.identity ?? "", /^[a-f0-9]{64}$/);
  assert.equal(readStudioAccountCookie(`${cookie}x`, secret, Date.parse("2026-07-29T12:05:00Z")), null);
  assert.equal(readStudioAccountCookie(cookie, `${secret}-wrong`, Date.parse("2026-07-29T12:05:00Z")), null);
  assert.equal(readStudioAccountCookie(cookie, secret, Date.parse("2026-11-01T12:05:00Z")), null);
  assert.equal(resolveAccountCookieSecret({ DROPS_ACCOUNT_COOKIE_SECRET: "account-secret" }), "account-secret");
});

test("OpenRouter storage ownership survives cookie-signing secret rotation", () => {
  const issuedAt = Math.floor(Date.parse("2026-07-29T12:00:00Z") / 1_000);
  const firstSecret = "first-cookie-signing-secret-with-enough-entropy";
  const rotatedSecret = "rotated-cookie-signing-secret-with-enough-entropy";
  const input = { provider: "openrouter", subject: accountSubject, issuedAt };
  const first = readStudioAccountCookie(
    createStudioAccountCookie(input, firstSecret),
    firstSecret,
    Date.parse("2026-07-29T12:05:00Z"),
  );
  const rotated = readStudioAccountCookie(
    createStudioAccountCookie(input, rotatedSecret),
    rotatedSecret,
    Date.parse("2026-07-29T12:05:00Z"),
  );

  assert.ok(first);
  assert.ok(rotated);
  assert.equal(first.identity, rotated.identity);
  assert.notEqual(
    createStudioAccountCookie(input, firstSecret),
    createStudioAccountCookie(input, rotatedSecret),
    "cookie signatures still rotate independently from durable storage ownership",
  );
});

test("access metadata exposes only tiers that actually work", () => {
  const guest = accessMetadata({ tier: "guest", used: 1 });

  assert.equal(guest.tier, "guest");
  assert.deepEqual(guest.platformAi, {
    available: true,
    limit: GUEST_DAILY_LIMIT,
    remaining: 2,
    reset: "daily-utc",
  });
  assert.equal(guest.localCompiler.available, true);
  assert.equal(guest.localCompiler.limit, null);
  assert.equal(guest.byok.available, true);
  assert.equal(guest.account.available, true);
  assert.equal(guest.account.connected, false);
  assert.equal(guest.pro.available, false);

  const byok = accessMetadata({ tier: "byok", used: 0 });
  assert.equal(byok.platformAi.available, false);
  assert.equal(byok.platformAi.limit, null);
  assert.equal(byok.byok.billingOwner, "user");

  const accountCookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject }, secret);
  const account = readStudioAccountCookie(accountCookie, secret);
  const member = accessMetadata({
    tier: "member",
    used: 4,
    account,
    projectSyncAvailable: true,
  });
  assert.equal(member.authenticated, true);
  assert.equal(member.platformAi.limit, MEMBER_DAILY_LIMIT);
  assert.equal(member.platformAi.remaining, MEMBER_DAILY_LIMIT - 4);
  assert.equal(member.account.connected, true);
  assert.equal(member.account.projectSync, true);

  const proFailClosed = accessMetadata({ tier: "pro", used: 4, account });
  assert.equal(proFailClosed.platformAi.limit, MEMBER_DAILY_LIMIT);
  const pro = accessMetadata({
    tier: "pro",
    used: 4,
    account,
    platformLimit: PRO_DAILY_LIMIT,
  });
  assert.equal(pro.platformAi.limit, PRO_DAILY_LIMIT);
  assert.equal(pro.platformAi.remaining, PRO_DAILY_LIMIT - 4);
});

test("funded Pro quota resolves tier and limit from one billing instant", async () => {
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = await import("../db/billing.ts");
  const previous = {
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
    VERCEL: process.env.VERCEL,
  };
  const NativeDate = globalThis.Date;
  try {
    process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_monthly";
    delete process.env.VERCEL;
    resetLocalBillingStateForTests();

    const accountCookie = createStudioAccountCookie(
      { provider: "openrouter", subject: "quota-boundary-member" },
      secret,
    );
    const account = readStudioAccountCookie(accountCookie, secret);
    assert.ok(account);
    await applyBillingWebhookEvent({
      id: "evt_quota_boundary_active_123",
      type: "customer.subscription.updated",
      mutation: "subscription",
      createdAt: "2098-12-01T00:00:00.000Z",
      accountIdentity: account.identity,
      stripeCustomerId: "cus_quota_boundary_123456",
      stripeSubscriptionId: "sub_quota_boundary_123456",
      priceId: "price_pro_monthly",
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });

    let clockReads = 0;
    globalThis.Date = class BoundaryDate extends NativeDate {
      constructor(...args) {
        if (args.length > 0) super(...args);
        else super(clockReads++ === 0
          ? "2098-12-31T23:59:59.000Z"
          : "2099-01-01T00:00:01.000Z");
      }
    };
    const quota = await accessTierModule.resolveFundedBuildQuota({
      kind: "account",
      account,
    });
    assert.deepEqual([quota.tier, quota.limit], ["pro", PRO_DAILY_LIMIT]);
    assert.equal(clockReads, 1);
  } finally {
    globalThis.Date = NativeDate;
    resetLocalBillingStateForTests();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("access status issues a signed HttpOnly anonymous identity without claiming authentication or Pro", async () => {
  const { GET } = await import("../app/api/access/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previousSecret = process.env.DROPS_GUEST_COOKIE_SECRET;
  const previousGateway = process.env.AI_GATEWAY_API_KEY;
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_GUEST_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  try {
    const response = await GET(new NextRequest("http://localhost/api/access"));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.access.tier, "guest");
    assert.equal(payload.access.account.available, true);
    assert.equal(payload.access.account.connected, false);
    assert.equal(payload.access.authenticated, false);
    assert.equal(payload.access.pro.available, false);
    assert.match(response.headers.get("set-cookie") ?? "", /drops_guest_identity=/);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    if (previousSecret === undefined) delete process.env.DROPS_GUEST_COOKIE_SECRET;
    else process.env.DROPS_GUEST_COOKIE_SECRET = previousSecret;
    if (previousGateway === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGateway;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("OpenRouter OAuth creates a signed HttpOnly Studio member session without server-side key persistence", async () => {
  const { POST } = await import("../app/api/auth/openrouter/exchange/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previousSecret = process.env.DROPS_ACCOUNT_COOKIE_SECRET;
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  const previousFetch = globalThis.fetch;
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.fetch = async () => new Response(JSON.stringify({
    key: "sk-or-v1-session-only-test-key",
    user_id: accountSubject,
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await POST(new NextRequest("http://localhost/api/auth/openrouter/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "oauth-code", codeVerifier: "pkce-verifier" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.key, "sk-or-v1-session-only-test-key");
    assert.deepEqual(payload.account, { provider: "openrouter", connected: true, projectSync: true });
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${STUDIO_ACCOUNT_COOKIE}=`));
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.doesNotMatch(JSON.stringify(payload.account), new RegExp(accountSubject));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.DROPS_ACCOUNT_COOKIE_SECRET;
    else process.env.DROPS_ACCOUNT_COOKIE_SECRET = previousSecret;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("access status recognizes a signed member and reports its daily platform allowance", async () => {
  const { GET } = await import("../app/api/access/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previousSecret = process.env.DROPS_ACCOUNT_COOKIE_SECRET;
  const previousGateway = process.env.AI_GATEWAY_API_KEY;
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  try {
    const accountCookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject }, secret);
    const account = readStudioAccountCookie(accountCookie, secret);
    assert.ok(account);
    const usageCookie = createGuestUsageCookie({ date: new Date().toISOString().slice(0, 10), count: 3, identity: account.identity }, secret);
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([
      [`member-ai-plan:${bucket}:${account.identity}`, {
        count: 3,
        expiresAt: (bucket + 1) * 24 * 60 * 60 * 1_000,
      }],
    ]);
    const response = await GET(new NextRequest("http://localhost/api/access", {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}; ${MEMBER_USAGE_COOKIE}=${usageCookie}` },
    }));
    const payload = await response.json();

    assert.equal(payload.access.tier, "member");
    assert.equal(payload.access.authenticated, true);
    assert.equal(payload.access.platformAi.limit, MEMBER_DAILY_LIMIT);
    assert.equal(payload.access.platformAi.remaining, MEMBER_DAILY_LIMIT - 3);
    assert.equal(payload.access.account.provider, "openrouter");
    assert.equal(payload.access.account.projectSync, true);
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousSecret === undefined) delete process.env.DROPS_ACCOUNT_COOKIE_SECRET;
    else process.env.DROPS_ACCOUNT_COOKIE_SECRET = previousSecret;
    if (previousGateway === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGateway;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("access status never advertises member AI when Gateway or durable quota is unavailable", async () => {
  const { GET } = await import("../app/api/access/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
  };
  process.env.NODE_ENV = "production";
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = "a".repeat(48);
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  try {
    const accountCookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject }, process.env.DROPS_ACCOUNT_COOKIE_SECRET);
    const response = await GET(new NextRequest("https://drops.example/api/access", {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
    }));
    const payload = await response.json();

    assert.equal(payload.access.authenticated, true);
    assert.equal(payload.access.tier, "fallback");
    assert.equal(payload.access.platformAi.available, false);
    assert.equal(payload.access.platformAi.remaining, null);
    assert.equal("identity" in payload.access.account, false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("access status reads the authoritative member count instead of a stale display cookie", async () => {
  const { GET } = await import("../app/api/access/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  process.env.NODE_ENV = "test";
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  try {
    const accountCookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject }, secret);
    const account = readStudioAccountCookie(accountCookie, secret);
    assert.ok(account);
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([
      [`member-ai-plan:${bucket}:${account.identity}`, {
        count: 4,
        expiresAt: (bucket + 1) * 24 * 60 * 60 * 1_000,
      }],
    ]);
    const staleCookie = createGuestUsageCookie({
      date: new Date().toISOString().slice(0, 10),
      count: 1,
      identity: account.identity,
    }, secret);
    const response = await GET(new NextRequest("http://localhost/api/access", {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}; ${MEMBER_USAGE_COOKIE}=${staleCookie}` },
    }));
    const payload = await response.json();

    assert.equal(payload.access.tier, "member");
    assert.equal(payload.access.platformAi.remaining, MEMBER_DAILY_LIMIT - 4);
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("member sign-out clears both HttpOnly account cookies", async () => {
  const { DELETE } = await import("../app/api/auth/session/route.ts");
  const response = await DELETE();
  const cookies = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.match(cookies, new RegExp(`${STUDIO_ACCOUNT_COOKIE}=`));
  assert.match(cookies, new RegExp(`${MEMBER_USAGE_COOKIE}=`));
  assert.match(cookies, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
  assert.match(cookies, /HttpOnly/i);
  assert.equal((await response.json()).disconnected, true);
});

test("OAuth refuses side effects before signing config and rejects cross-origin or oversized requests", async () => {
  const { POST } = await import("../app/api/auth/openrouter/exchange/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    DROPS_GUEST_COOKIE_SECRET: process.env.DROPS_GUEST_COOKIE_SECRET,
  };
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ key: "sk-or-v1-unused", user_id: accountSubject });
  };
  process.env.NODE_ENV = "production";
  delete process.env.DROPS_ACCOUNT_COOKIE_SECRET;
  delete process.env.DROPS_GUEST_COOKIE_SECRET;
  try {
    const missingConfig = await POST(new NextRequest("https://drops.example/api/auth/openrouter/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify({ code: "oauth-code", codeVerifier: "pkce-verifier" }),
    }));
    assert.equal(missingConfig.status, 503);
    assert.equal(providerCalls, 0);

    process.env.DROPS_ACCOUNT_COOKIE_SECRET = "a".repeat(48);
    const crossOrigin = await POST(new NextRequest("https://drops.example/api/auth/openrouter/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ code: "oauth-code", codeVerifier: "pkce-verifier" }),
    }));
    assert.equal(crossOrigin.status, 403);
    assert.equal(providerCalls, 0);

    const oversized = await POST(new NextRequest("https://drops.example/api/auth/openrouter/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify({ code: "x".repeat(9_000), codeVerifier: "pkce-verifier" }),
    }));
    assert.equal(oversized.status, 413);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("OAuth exchange applies a bounded per-identity request limit", async () => {
  const { POST } = await import("../app/api/auth/openrouter/exchange/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  const previousFetch = globalThis.fetch;
  process.env.NODE_ENV = "test";
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = secret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.fetch = async () => Response.json({ key: "sk-or-v1-test", user_id: accountSubject });
  try {
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await POST(new NextRequest("http://localhost/api/auth/openrouter/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-forwarded-for": "203.0.113.42",
        },
        body: JSON.stringify({ code: `oauth-code-${index}`, codeVerifier: "pkce-verifier" }),
      })));
    }
    assert.equal(responses.at(-1)?.status, 429);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("the planner enforces the signed identity quota and returns honest tier metadata", async () => {
  const { POST } = await import("../app/api/agent/plan/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previousSecret = process.env.DROPS_GUEST_COOKIE_SECRET;
  const previousGateway = process.env.AI_GATEWAY_API_KEY;
  process.env.DROPS_GUEST_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  try {
    const identityCookie = createGuestIdentityCookie(identity, secret);
    const usageCookie = createGuestUsageCookie(
      { date: new Date().toISOString().slice(0, 10), count: GUEST_DAILY_LIMIT, identity },
      secret,
    );
    const request = new NextRequest("http://localhost/api/agent/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `drops_guest_identity=${identityCookie}; drops_guest_builds=${usageCookie}`,
      },
      body: JSON.stringify({ prompt: "Build a real crypto radio" }),
    });
    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 429);
    assert.equal(payload.code, "GUEST_LIMIT");
    assert.equal(payload.access.tier, "guest");
    assert.equal(payload.access.platformAi.remaining, 0);
    assert.equal(payload.access.account.available, true);
    assert.equal(payload.access.account.connected, false);
    assert.equal(payload.access.pro.available, false);
  } finally {
    if (previousSecret === undefined) delete process.env.DROPS_GUEST_COOKIE_SECRET;
    else process.env.DROPS_GUEST_COOKIE_SECRET = previousSecret;
    if (previousGateway === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGateway;
  }
});

test("the planner enforces the signed-in member allowance before calling a platform model", async () => {
  const { POST } = await import("../app/api/agent/plan/route.ts");
  const { NextRequest } = await import("next/server.js");
  const previousSecret = process.env.DROPS_ACCOUNT_COOKIE_SECRET;
  const previousGateway = process.env.AI_GATEWAY_API_KEY;
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = secret;
  process.env.AI_GATEWAY_API_KEY = "gateway-token";
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  try {
    const accountCookie = createStudioAccountCookie({ provider: "openrouter", subject: accountSubject }, secret);
    const account = readStudioAccountCookie(accountCookie, secret);
    assert.ok(account);
    const usageCookie = createGuestUsageCookie({
      date: new Date().toISOString().slice(0, 10),
      count: 0,
      identity: account.identity,
    }, secret);
    const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([
      [`member-ai-plan:${bucket}:${account.identity}`, {
        count: MEMBER_DAILY_LIMIT,
        expiresAt: (bucket + 1) * 24 * 60 * 60 * 1_000,
      }],
    ]);
    const response = await POST(new NextRequest("http://localhost/api/agent/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}; ${MEMBER_USAGE_COOKIE}=${usageCookie}`,
      },
      body: JSON.stringify({ prompt: "Build a real crypto radio" }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 429);
    assert.equal(payload.code, "MEMBER_LIMIT");
    assert.equal(payload.access.tier, "member");
    assert.equal(payload.access.authenticated, true);
    assert.equal(payload.access.platformAi.remaining, 0);
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousSecret === undefined) delete process.env.DROPS_ACCOUNT_COOKIE_SECRET;
    else process.env.DROPS_ACCOUNT_COOKIE_SECRET = previousSecret;
    if (previousGateway === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGateway;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("client access state never invents quota and only confirms OAuth after both session signals", async () => {
  const source = await readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8");

  assert.match(source, /platformAiAvailable/);
  assert.doesNotMatch(source, /guestRemaining\s*\?\?\s*\(memberConnected\s*\?\s*10\s*:\s*3\)/);
  assert.doesNotMatch(source, /await fetch\("\/api\/auth\/session",\s*\{ method: "DELETE" \}\)\.catch/);
  assert.match(source, /response\.ok/);
  assert.match(source, /params\.get\("openrouter"\) === "connected"[\s\S]{0,500}sessionStorage/);
  assert.match(source, /params\.get\("openrouter"\) === "connected"[\s\S]{0,500}authenticated/);
});
