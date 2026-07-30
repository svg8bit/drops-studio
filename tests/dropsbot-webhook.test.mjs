import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  createStudioAccountCookie,
  readStudioAccountCookie,
  STUDIO_ACCOUNT_COOKIE,
} from "../lib/access-tier.ts";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
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

const accountSecret = "dropsbot-webhook-test-secret-with-enough-entropy";
const firstSubject = "user_dropsbot_webhook_owner_one";
const secondSubject = "user_dropsbot_webhook_owner_two";
const projectId = "dropsbot-webhook-project";

function signedAccount(subject) {
  const cookie = createStudioAccountCookie({
    provider: "openrouter",
    subject,
  }, accountSecret);
  const account = readStudioAccountCookie(cookie, accountSecret);
  assert.ok(account);
  return { account, cookie };
}

function seedProject(identity, id = projectId) {
  globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__.set(identity, {
    schemaVersion: 1,
    revision: 1,
    updatedAt: "2026-07-30T00:00:00.000Z",
    projects: [{ id }],
  });
}

async function withLocalDropsBot(run) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    DROPS_ACCOUNT_COOKIE_SECRET: process.env.DROPS_ACCOUNT_COOKIE_SECRET,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    VERCEL: process.env.VERCEL,
  };
  process.env.NODE_ENV = "test";
  process.env.DROPS_ACCOUNT_COOKIE_SECRET = accountSecret;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = undefined;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
  try {
    return await run();
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_MEMBER_PROJECTS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function createConnection(cookie) {
  const { POST } = await import("../app/api/dropsbot/webhooks/route.ts");
  const { NextRequest } = await import("next/server.js");
  const response = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
      origin: "https://drops.example",
    },
    body: JSON.stringify({ projectId, consent: true }),
  }));
  return { response, payload: await response.json() };
}

function callbackParts(callbackUrl) {
  const segments = new URL(callbackUrl).pathname.split("/").filter(Boolean);
  return {
    connectionId: segments.at(-2),
    capability: segments.at(-1),
  };
}

test("Drops Bot receiver clears stale provider evidence after account expiry", async () => {
  const source = await readFile(
    new URL("../components/dropsbot-webhook-connection.tsx", import.meta.url),
    "utf8",
  );
  const unauthorizedBranch = source.slice(
    source.indexOf("if (response.status === 401)"),
    source.indexOf("if (!response.ok)", source.indexOf("if (response.status === 401)")),
  );

  assert.match(unauthorizedBranch, /setCallbackUrl\(""\)/);
  assert.match(unauthorizedBranch, /setEvidence\(null\)/);
  assert.match(unauthorizedBranch, /setEvents\(\[\]\)/);
  assert.match(unauthorizedBranch, /setConsent\(false\)/);
  assert.match(unauthorizedBranch, /setCanCreate\(false\)/);
});

test("Drops Bot callback capabilities store only a hash and redact credential material", async () => {
  const {
    createDropsBotWebhookCapability,
    redactDropsBotWebhookPayload,
    verifyDropsBotWebhookCapability,
  } = await import("../lib/dropsbot-webhook.ts");

  const capability = createDropsBotWebhookCapability();
  assert.match(capability.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.match(capability.hash, /^[a-f0-9]{64}$/);
  assert.equal(verifyDropsBotWebhookCapability(capability.secret, capability.hash), true);
  assert.equal(verifyDropsBotWebhookCapability(`${capability.secret}x`, capability.hash), false);
  assert.doesNotMatch(capability.hash, new RegExp(capability.secret));

  const redacted = redactDropsBotWebhookPayload({
    event: "wallet.swap",
    wallet: "0x1111111111111111111111111111111111111111",
    apiKey: "sk-provider-secret-material-that-must-not-be-stored",
    nested: {
      authorization: "Bearer provider-secret-material-that-must-not-be-stored",
      providerApiKey: "provider-key-with-a-prefixed-field-name",
      authorizationHeader: "provider-auth-with-a-suffixed-field-name",
      botToken: "123456789:AAabcdefghijklmnopqrstuvwxyz0123456789",
      token: { symbol: "ETH" },
    },
  });

  assert.equal(redacted.apiKey, "[REDACTED]");
  assert.equal(redacted.nested.authorization, "[REDACTED]");
  assert.equal(redacted.nested.providerApiKey, "[REDACTED]");
  assert.equal(redacted.nested.authorizationHeader, "[REDACTED]");
  assert.equal(redacted.nested.botToken, "[REDACTED]");
  assert.equal(redacted.nested.token.symbol, "ETH");
  assert.equal(redacted.wallet, "0x1111111111111111111111111111111111111111");
});

test("callback creation requires a signed project owner, same origin, and explicit consent", async () => {
  await withLocalDropsBot(async () => {
    const { POST } = await import("../app/api/dropsbot/webhooks/route.ts");
    const { NextRequest } = await import("next/server.js");
    const { account, cookie } = signedAccount(firstSubject);
    seedProject(account.identity);

    const anonymous = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://drops.example" },
      body: JSON.stringify({ projectId, consent: true }),
    }));
    assert.equal(anonymous.status, 401);

    const noConsent = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
        origin: "https://drops.example",
      },
      body: JSON.stringify({ projectId, consent: false }),
    }));
    assert.equal(noConsent.status, 400);
    assert.equal((await noConsent.json()).code, "DROPSBOT_CONSENT_REQUIRED");

    const crossOrigin = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ projectId, consent: true }),
    }));
    assert.equal(crossOrigin.status, 403);

    const missingOrigin = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
      },
      body: JSON.stringify({ projectId, consent: true }),
    }));
    assert.equal(missingOrigin.status, 403);

    const jsonLikeType = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/jsonp",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
        origin: "https://drops.example",
      },
      body: JSON.stringify({ projectId, consent: true }),
    }));
    assert.equal(jsonLikeType.status, 415);

    const ownerWithoutProject = signedAccount(secondSubject);
    const foreign = await POST(new NextRequest("https://drops.example/api/dropsbot/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${STUDIO_ACCOUNT_COOKIE}=${ownerWithoutProject.cookie}`,
        origin: "https://drops.example",
      },
      body: JSON.stringify({ projectId, consent: true }),
    }));
    assert.equal(foreign.status, 404);

    const { response, payload } = await createConnection(cookie);
    assert.equal(response.status, 201);
    assert.equal(payload.projectId, projectId);
    assert.match(payload.connectionId, /^[a-f0-9-]{36}$/);
    assert.match(
      payload.callbackUrl,
      /^https:\/\/drops\.example\/api\/dropsbot\/webhooks\/[a-f0-9-]{36}\/[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(payload.registration.mode, "manual-in-@drops");
    assert.equal(payload.registration.claimedConfigured, false);
    assert.equal(payload.callbackEvidence.status, "pending");
    assert.equal(payload.callbackEvidence.providerVerified, false);
    assert.equal(payload.callbackEvidence.providerSignatureVerified, false);
  });
});

test("callback ingress enforces JSON and byte limits before recording callback evidence", async () => {
  await withLocalDropsBot(async () => {
    const { account, cookie } = signedAccount(firstSubject);
    seedProject(account.identity);
    const created = await createConnection(cookie);
    assert.equal(created.response.status, 201);
    const { connectionId, capability } = callbackParts(created.payload.callbackUrl);
    const { POST } = await import("../app/api/dropsbot/webhooks/[connectionId]/[capability]/route.ts");
    const { NextRequest } = await import("next/server.js");
    const {
      DROPSBOT_WEBHOOK_BODY_LIMIT_BYTES,
    } = await import("../lib/dropsbot-webhook.ts");

    const wrongCapability = await POST(new NextRequest(
      `https://drops.example/api/dropsbot/webhooks/${connectionId}/${"x".repeat(43)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ), { params: Promise.resolve({ connectionId, capability: "x".repeat(43) }) });
    assert.equal(wrongCapability.status, 404);

    const wrongType = await POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }), { params: Promise.resolve({ connectionId, capability }) });
    assert.equal(wrongType.status, 415);

    const jsonLikeType = await POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/jsonp" },
      body: "{}",
    }), { params: Promise.resolve({ connectionId, capability }) });
    assert.equal(jsonLikeType.status, 415);

    const malformed = await POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }), { params: Promise.resolve({ connectionId, capability }) });
    assert.equal(malformed.status, 400);

    const oversized = await POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(DROPSBOT_WEBHOOK_BODY_LIMIT_BYTES + 1),
      },
      body: "{}",
    }), { params: Promise.resolve({ connectionId, capability }) });
    assert.equal(oversized.status, 413);

    const actualOversized = await POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(DROPSBOT_WEBHOOK_BODY_LIMIT_BYTES) }),
    }), { params: Promise.resolve({ connectionId, capability }) });
    assert.equal(actualOversized.status, 413);

    const { GET } = await import("../app/api/dropsbot/events/route.ts");
    const listed = await GET(new NextRequest(
      `https://drops.example/api/dropsbot/events?projectId=${projectId}`,
      { headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}` } },
    ));
    const listedPayload = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listedPayload.events.length, 0);
    assert.equal(listedPayload.callbackEvidence.status, "pending");
    assert.equal(listedPayload.registration.claimedConfigured, false);
  });
});

test("callback ingress rate limits a valid capability before body or event storage", async () => {
  await withLocalDropsBot(async () => {
    const { account, cookie } = signedAccount(firstSubject);
    seedProject(account.identity);
    const created = await createConnection(cookie);
    assert.equal(created.response.status, 201);
    const { connectionId, capability } = callbackParts(created.payload.callbackUrl);
    const callback = await import("../app/api/dropsbot/webhooks/[connectionId]/[capability]/route.ts");
    const { NextRequest } = await import("next/server.js");
    const windowMs = 60_000;
    const bucket = Math.floor(Date.now() / windowMs);
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map(
      [bucket, bucket + 1].map((candidate) => [
        `dropsbot-callback:${candidate}:${connectionId}:null`,
        { count: 120, expiresAt: (candidate + 1) * windowMs },
      ]),
    );

    const limited = await callback.POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "wallet.swap", shouldNotPersist: true }),
    }), { params: Promise.resolve({ connectionId, capability }) });

    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal((await limited.json()).code, "DROPSBOT_WEBHOOK_RATE_LIMITED");

    const { GET } = await import("../app/api/dropsbot/events/route.ts");
    const listed = await GET(new NextRequest(
      `https://drops.example/api/dropsbot/events?projectId=${projectId}`,
      { headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}` } },
    ));
    const listedPayload = await listed.json();
    assert.equal(listedPayload.events.length, 0);
    assert.equal(listedPayload.callbackEvidence.status, "pending");

    const routeSource = await readFile(
      new URL("../app/api/dropsbot/webhooks/[connectionId]/[capability]/route.ts", import.meta.url),
      "utf8",
    );
    const limitAt = routeSource.indexOf("consumeRequestLimit({");
    const bodyAt = routeSource.indexOf("readDropsBotWebhookBody(request)");
    assert.ok(
      limitAt >= 0 && bodyAt >= 0,
      "both callback guards must be present",
    );
    assert.ok(
      limitAt < bodyAt,
      "callback rate limiting must run before the body is read or storage is mutated",
    );
  });
});

test("accepted callbacks are content-hash idempotent, redacted, and owner-scoped", async () => {
  await withLocalDropsBot(async () => {
    const first = signedAccount(firstSubject);
    const second = signedAccount(secondSubject);
    seedProject(first.account.identity);
    seedProject(second.account.identity);
    const created = await createConnection(first.cookie);
    assert.equal(created.response.status, 201);
    const { connectionId, capability } = callbackParts(created.payload.callbackUrl);
    const callback = await import("../app/api/dropsbot/webhooks/[connectionId]/[capability]/route.ts");
    const events = await import("../app/api/dropsbot/events/route.ts");
    const { NextRequest } = await import("next/server.js");
    const body = JSON.stringify({
      event: "wallet.swap",
      wallet: "0x2222222222222222222222222222222222222222",
      callbackUrl: created.payload.callbackUrl,
      apiKey: "sk-provider-secret-material-that-must-not-be-stored",
      details: {
        authorization: "Bearer provider-secret-material-that-must-not-be-stored",
        token: { symbol: "ETH", amount: "1.25" },
      },
    });
    const context = { params: Promise.resolve({ connectionId, capability }) };

    const accepted = await callback.POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }), context);
    const acceptedPayload = await accepted.json();
    assert.equal(accepted.status, 202);
    assert.equal(acceptedPayload.accepted, true);
    assert.equal(acceptedPayload.duplicate, false);
    assert.match(acceptedPayload.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(acceptedPayload.callbackEvidence.status, "callback-received");
    assert.equal(acceptedPayload.callbackEvidence.providerVerified, false);
    assert.equal(acceptedPayload.callbackEvidence.providerSignatureVerified, false);

    const duplicate = await callback.POST(new NextRequest(created.payload.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }), { params: Promise.resolve({ connectionId, capability }) });
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicate.status, 200);
    assert.equal(duplicatePayload.accepted, false);
    assert.equal(duplicatePayload.duplicate, true);
    assert.equal(duplicatePayload.eventId, acceptedPayload.eventId);

    const listed = await events.GET(new NextRequest(
      `https://drops.example/api/dropsbot/events?projectId=${projectId}`,
      { headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${first.cookie}` } },
    ));
    const listedPayload = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listedPayload.events.length, 1);
    assert.equal(listedPayload.events[0].payload.apiKey, "[REDACTED]");
    assert.equal(listedPayload.events[0].payload.callbackUrl, "[REDACTED]");
    assert.equal(listedPayload.events[0].payload.details.authorization, "[REDACTED]");
    assert.equal(listedPayload.events[0].payload.details.token.symbol, "ETH");
    assert.equal(listedPayload.callbackEvidence.status, "callback-received");
    assert.equal(listedPayload.callbackEvidence.providerVerified, false);
    assert.equal(listedPayload.callbackEvidence.providerSignatureVerified, false);
    assert.equal(listedPayload.registration.claimedConfigured, false);
    assert.equal("capabilityHash" in listedPayload, false);
    assert.doesNotMatch(JSON.stringify(listedPayload), new RegExp(capability));

    const foreign = await events.GET(new NextRequest(
      `https://drops.example/api/dropsbot/events?projectId=${projectId}`,
      { headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${second.cookie}` } },
    ));
    assert.equal(foreign.status, 404);
  });
});

test("D1 duplicate callbacks report the latest stored connection evidence", async (t) => {
  const {
    acceptDropsBotWebhookEvent,
  } = await import("../db/dropsbot-webhooks.ts");
  const {
    createDropsBotWebhookCapability,
  } = await import("../lib/dropsbot-webhook.ts");
  const capability = createDropsBotWebhookCapability();
  const connectionId = "11111111-2222-4333-8444-555555555555";
  const duplicateHash = "c".repeat(64);
  const latestHash = "d".repeat(64);
  const duplicateRow = {
    id: "evt_duplicate",
    content_hash: duplicateHash,
    received_at: "2026-07-30T00:01:00.000Z",
    payload_json: JSON.stringify({ event: "wallet.swap", sequence: 1 }),
  };
  const latestConnection = {
    capability_hash: capability.hash,
    last_event_received_at: "2026-07-30T00:02:00.000Z",
    last_event_content_hash: latestHash,
  };

  function fakeDatabase(existingBeforeBatch) {
    let eventReads = 0;
    let batchCalls = 0;
    const db = {
      prepare(sql) {
        return {
          sql,
          args: [],
          bind(...args) {
            this.args = args;
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async first() {
            if (/SELECT capability_hash, last_event_received_at/i.test(sql)) {
              return latestConnection;
            }
            if (/SELECT id, content_hash, received_at, payload_json/i.test(sql)) {
              eventReads += 1;
              return existingBeforeBatch || eventReads > 1 ? duplicateRow : null;
            }
            if (/SELECT COUNT\(\*\) AS count/i.test(sql)) return { count: 1 };
            return null;
          },
          async all() {
            return { results: [] };
          },
        };
      },
      async batch() {
        batchCalls += 1;
        return [{ meta: { changes: 0 } }, { meta: { changes: 1 } }];
      },
    };
    return { db, batchCalls: () => batchCalls };
  }

  for (const scenario of [
    { name: "existing duplicate branch", existingBeforeBatch: true, expectedBatchCalls: 0 },
    { name: "insert-race duplicate branch", existingBeforeBatch: false, expectedBatchCalls: 1 },
  ]) {
    await t.test(scenario.name, async () => {
      const previousEnvironment = globalThis.__DROPS_STUDIO_ENV__;
      const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
      const previousVercel = process.env.VERCEL;
      const fake = fakeDatabase(scenario.existingBeforeBatch);
      globalThis.__DROPS_STUDIO_ENV__ = { DB: fake.db };
      globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = undefined;
      delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
      delete process.env.VERCEL;
      try {
        const result = await acceptDropsBotWebhookEvent({
          connectionId,
          capabilityHash: capability.hash,
          event: {
            id: "evt_duplicate",
            contentHash: duplicateHash,
            receivedAt: "2026-07-30T00:03:00.000Z",
            payload: { event: "wallet.swap", sequence: 1 },
          },
        });

        assert.equal(result.status, "duplicate");
        assert.equal(result.event.contentHash, duplicateHash);
        assert.equal(result.callbackEvidence.status, "callback-received");
        assert.equal(result.callbackEvidence.receivedAt, latestConnection.last_event_received_at);
        assert.equal(result.callbackEvidence.contentHash, latestHash);
        assert.equal(fake.batchCalls(), scenario.expectedBatchCalls);
      } finally {
        globalThis.__DROPS_STUDIO_ENV__ = previousEnvironment;
        globalThis.__DROPS_STUDIO_LOCAL_DROPSBOT_WEBHOOKS__ = undefined;
        if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
        else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
        if (previousVercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = previousVercel;
      }
    });
  }
});

test("the Vercel Blob fallback keeps one private CAS-protected webhook state", async () => {
  const {
    acceptDropsBotWebhookEvent,
    createDropsBotWebhookConnection,
    listDropsBotWebhookProject,
  } = await import("../db/dropsbot-webhooks.ts");
  const {
    createDropsBotWebhookCapability,
  } = await import("../lib/dropsbot-webhook.ts");
  let stored = null;
  let etag = 0;
  const writes = [];
  const storage = {
    async get(pathname, options) {
      assert.equal(options.access, "private");
      assert.equal(options.useCache, false);
      if (!stored) return null;
      return {
        statusCode: 200,
        blob: { etag: `etag-${etag}` },
        stream: new Response(stored).body,
      };
    },
    async put(pathname, body, options) {
      writes.push({ pathname, options });
      assert.equal(options.access, "private");
      if (stored === null) assert.equal(options.allowOverwrite, false);
      else assert.equal(options.ifMatch, `etag-${etag}`);
      stored = String(body);
      etag += 1;
      return { pathname };
    },
  };
  const capability = createDropsBotWebhookCapability();
  const connectionId = "11111111-2222-4333-8444-555555555555";
  const ownerIdentity = "a".repeat(64);

  const created = await createDropsBotWebhookConnection({
    id: connectionId,
    ownerIdentity,
    projectId,
    capabilityHash: capability.hash,
    createdAt: "2026-07-30T00:00:00.000Z",
    consentedAt: "2026-07-30T00:00:00.000Z",
  }, storage);
  assert.equal(created.status, "created");

  const accepted = await acceptDropsBotWebhookEvent({
    connectionId,
    capabilityHash: capability.hash,
    event: {
      id: "evt_test",
      contentHash: "b".repeat(64),
      receivedAt: "2026-07-30T00:01:00.000Z",
      payload: { event: "wallet.swap", wallet: "0xabc" },
    },
  }, storage);
  assert.equal(accepted.status, "accepted");
  assert.ok(writes.every((write) => write.pathname === "drops-studio/dropsbot/webhook-state-v1.json"));
  assert.equal(JSON.parse(stored).connections[0].capabilityHash, capability.hash);
  assert.doesNotMatch(stored, new RegExp(capability.secret));

  const project = await listDropsBotWebhookProject(ownerIdentity, projectId, storage);
  assert.equal(project.events.length, 1);
  assert.equal(project.callbackEvidence.status, "callback-received");
  assert.equal(project.callbackEvidence.providerVerified, false);
});
