import assert from "node:assert/strict";
import test from "node:test";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { NextRequest } from "next/server.js";

import { GET as listLaunches, POST as submitLaunch } from "../app/api/product-hunt/launches/route.ts";
import { POST as voteLaunch } from "../app/api/product-hunt/launches/[id]/vote/route.ts";
import {
  isSameOriginMutation,
  normalizeProductUrl,
  parseProductHuntSubmission,
  PRODUCT_HUNT_SESSION_COOKIE,
  productUrlKey,
  ProductHuntValidationError,
  resolveProductHuntSession,
} from "../lib/product-hunt-community.ts";
import { consumeProductHuntRequestLimit } from "../lib/product-hunt-rate-limit.ts";
import { shouldRetryProductHuntBlobMutation } from "../db/product-hunt.ts";

const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";
const sessionC = "33333333-3333-4333-8333-333333333333";
const sessionD = "44444444-4444-4444-8444-444444444444";

function jsonRequest(url, body, session = sessionA, headers = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `${PRODUCT_HUNT_SESSION_COOKIE}=${session}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function launchBody(overrides = {}) {
  return {
    name: "Signal Garden",
    tagline: "Turn transparent market context into a daily research habit",
    description: "A community-built crypto research product with clear DropsTab source links and no claim that an external URL has been reviewed.",
    url: "https://signal-garden.example/app",
    category: "research",
    makerName: "Community maker",
    ...overrides,
  };
}

test("community launch validation accepts public URLs and rejects markup, credentials and local destinations", () => {
  assert.equal(normalizeProductUrl("https://EXAMPLE.com:443/app/#demo"), "https://example.com/app");
  assert.equal(parseProductHuntSubmission(launchBody()).category, "research");

  for (const url of ["javascript:alert(1)", "http://localhost:3000", "http://127.0.0.1", "https://user:secret@example.com"]) {
    assert.throws(() => parseProductHuntSubmission(launchBody({ url })), ProductHuntValidationError);
  }
  assert.throws(
    () => parseProductHuntSubmission(launchBody({ tagline: "<script>alert(1)</script>" })),
    ProductHuntValidationError,
  );
  assert.throws(
    () => parseProductHuntSubmission(launchBody({ tagline: "＜script＞alert(1)＜/script＞" })),
    ProductHuntValidationError,
  );
  assert.throws(
    () => parseProductHuntSubmission(launchBody({ name: "ﬃ".repeat(30) })),
    ProductHuntValidationError,
  );
});

test("community URL keys preserve path and query case while normalizing scheme and host", () => {
  assert.equal(
    productUrlKey("HTTPS://EXAMPLE.com:443/Signal/Board?Token=AbC"),
    "https://example.com/Signal/Board?Token=AbC",
  );
  assert.notEqual(
    productUrlKey("https://example.com/Signal/Board?Token=AbC"),
    productUrlKey("https://example.com/signal/board?Token=abc"),
  );
});

test("community sessions ignore client headers and mutations require a browser same-site context", () => {
  const headerOnly = resolveProductHuntSession(new NextRequest("https://drops.example/api/product-hunt/launches", {
    headers: { "x-drops-session": sessionA },
  }));
  assert.equal(headerOnly.source, "issued");
  assert.equal(headerOnly.isNew, true);
  assert.notEqual(headerOnly.id, sessionA);

  const cookieSession = resolveProductHuntSession(new NextRequest("https://drops.example/api/product-hunt/launches", {
    headers: { cookie: `${PRODUCT_HUNT_SESSION_COOKIE}=${sessionA}` },
  }));
  assert.deepEqual(cookieSession, { id: sessionA, isNew: false, source: "cookie" });

  assert.equal(isSameOriginMutation(new NextRequest("https://drops.example/api/product-hunt/launches", {
    method: "POST",
    headers: { origin: "https://drops.example", "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(isSameOriginMutation(new NextRequest("https://drops.example/api/product-hunt/launches", {
    method: "POST",
    headers: { origin: "https://drops.example", "sec-fetch-site": "same-site" },
  })), true);
  assert.equal(isSameOriginMutation(new NextRequest("https://drops.example/api/product-hunt/launches", {
    method: "POST",
    headers: { origin: "https://drops.example", "sec-fetch-site": "none" },
  })), false);
});

test("community D1 limits validate options and atomically return the updated count", async (context) => {
  const previousEnvironment = globalThis.__DROPS_STUDIO_ENV__;
  const calls = [];
  let count = 0;
  const database = {
    prepare(sql) {
      const statement = {
        params: [],
        bind(...params) {
          statement.params = params;
          return statement;
        },
        async run() {
          calls.push({ method: "run", sql, params: statement.params });
          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          calls.push({ method: "first", sql, params: statement.params });
          if (!/RETURNING count/i.test(sql)) return null;
          count += 1;
          return { count };
        },
      };
      return statement;
    },
  };
  globalThis.__DROPS_STUDIO_ENV__ = { DB: database };
  context.after(() => {
    globalThis.__DROPS_STUDIO_ENV__ = previousEnvironment;
  });

  for (const options of [
    { identity: "", namespace: "product-hunt-test", max: 1, windowMs: 1_000 },
    { identity: "browser", namespace: "", max: 1, windowMs: 1_000 },
    { identity: "browser", namespace: "product-hunt-test", max: 0, windowMs: 1_000 },
    { identity: "browser", namespace: "product-hunt-test", max: 1.5, windowMs: 1_000 },
    { identity: "browser", namespace: "product-hunt-test", max: 1, windowMs: 0 },
  ]) {
    assert.equal(await consumeProductHuntRequestLimit(options), "unavailable");
  }
  assert.equal(calls.length, 0);

  const valid = { identity: "browser", namespace: "product-hunt-test", max: 1, windowMs: 1_000 };
  assert.equal(await consumeProductHuntRequestLimit(valid), "allowed");
  assert.equal(await consumeProductHuntRequestLimit(valid), "limited");
  assert.equal(calls.filter((call) => call.method === "first" && /RETURNING count/i.test(call.sql)).length, 2);
  assert.equal(calls.some((call) => /SELECT count FROM product_hunt_rate_limits/i.test(call.sql)), false);
});

test("community Blob mutations retry only optimistic concurrency conflicts", () => {
  assert.equal(shouldRetryProductHuntBlobMutation(new BlobPreconditionFailedError()), true);
  assert.equal(shouldRetryProductHuntBlobMutation(new Error("provider unavailable")), false);
});

test("community submissions enforce the actual streamed body size and classify malformed URLs as validation", async () => {
  const oversized = new TextEncoder().encode(JSON.stringify(launchBody({ description: "x".repeat(17_000) })));
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(oversized.slice(0, 8_000));
      controller.enqueue(oversized.slice(8_000));
      controller.close();
    },
  });
  const oversizedRequest = new NextRequest("https://drops.example/api/product-hunt/launches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });
  assert.equal(oversizedRequest.headers.get("content-length"), null);
  const oversizedResponse = await submitLaunch(oversizedRequest);
  assert.equal(oversizedResponse.status, 413);

  const malformedUrl = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({ url: "not a product URL", dropsStudioSlug: "valid-studio-slug" }),
  ));
  assert.equal(malformedUrl.status, 400);
  assert.ok(Array.isArray((await malformedUrl.json()).fieldErrors.url));

  const malformedSlug = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({ url: "https://drops.example/p/invalid", dropsStudioSlug: "invalid/%slug" }),
  ));
  assert.equal(malformedSlug.status, 400);
  assert.ok(Array.isArray((await malformedSlug.json()).fieldErrors.dropsStudioSlug));
});

test("community API lists, submits and deduplicates one vote per browser session without identity claims", async (context) => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = new Map();
  context.after(() => {
    globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  const empty = await listLaunches(new NextRequest("https://drops.example/api/product-hunt/launches?sort=top&limit=12", {
    headers: { cookie: `${PRODUCT_HUNT_SESSION_COOKIE}=${sessionA}` },
  }));
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).launches, []);

  const submitted = await submitLaunch(jsonRequest("https://drops.example/api/product-hunt/launches", launchBody(), sessionA));
  assert.equal(submitted.status, 201);
  const submittedPayload = await submitted.json();
  assert.equal(submittedPayload.launch.evidence.destination, "community-url-unverified");
  assert.equal(submittedPayload.launch.votes, 0);
  assert.equal(submittedPayload.actor.authenticated, false);
  assert.equal(submittedPayload.actor.scope, "browser-session");
  assert.match(submittedPayload.actor.claim, /not proof of a unique person/i);
  assert.equal(submittedPayload.providerEvidence.storage, "local-memory");
  assert.equal(submitted.headers.get("vary"), "cookie");

  const duplicate = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({ name: "Duplicate URL" }),
    sessionD,
  ));
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already has a community launch/i);

  const firstVote = await voteLaunch(
    jsonRequest(`https://drops.example/api/product-hunt/launches/${submittedPayload.launch.id}/vote`, {}, null),
    { params: Promise.resolve({ id: submittedPayload.launch.id }) },
  );
  assert.equal(firstVote.status, 201);
  const firstVotePayload = await firstVote.json();
  assert.equal(firstVotePayload.accepted, true);
  assert.equal(firstVotePayload.votes, 1);
  assert.equal(firstVotePayload.actor.authenticated, false);
  const sessionCookie = firstVote.headers.get("set-cookie")?.match(/drops-product-hunt-session=([^;]+)/)?.[1];
  assert.ok(sessionCookie);

  const duplicateVote = await voteLaunch(
    jsonRequest(
      `https://drops.example/api/product-hunt/launches/${submittedPayload.launch.id}/vote`,
      {},
      null,
      { cookie: `drops-product-hunt-session=${sessionCookie}` },
    ),
    { params: Promise.resolve({ id: submittedPayload.launch.id }) },
  );
  assert.equal(duplicateVote.status, 200);
  assert.deepEqual(
    (({ accepted, duplicate: isDuplicate, votes }) => ({ accepted, duplicate: isDuplicate, votes }))(await duplicateVote.json()),
    { accepted: false, duplicate: true, votes: 1 },
  );

  const otherBrowserVote = await voteLaunch(
    jsonRequest(`https://drops.example/api/product-hunt/launches/${submittedPayload.launch.id}/vote`, {}, sessionB),
    { params: Promise.resolve({ id: submittedPayload.launch.id }) },
  );
  assert.equal(otherBrowserVote.status, 201);
  assert.equal((await otherBrowserVote.json()).votes, 2);

  const viewerList = await listLaunches(new NextRequest("https://drops.example/api/product-hunt/launches?sort=top&limit=12", {
    headers: { cookie: `drops-product-hunt-session=${sessionCookie}` },
  }));
  const viewerPayload = await viewerList.json();
  assert.equal(viewerPayload.total, 1);
  assert.equal(viewerPayload.launches[0].votes, 2);
  assert.equal(viewerPayload.launches[0].viewerHasVoted, true);
  assert.equal(viewerPayload.providerEvidence.listings, "community-submitted");
  assert.equal(viewerPayload.providerEvidence.moderation, "unreviewed");

  const missing = await voteLaunch(
    jsonRequest("https://drops.example/api/product-hunt/launches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/vote", {}, sessionC),
    { params: Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );
  assert.equal(missing.status, 404);

  const crossSite = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({ url: "https://another-product.example" }),
    sessionC,
    { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  ));
  assert.equal(crossSite.status, 403);
});

test("a listing claims Drops Studio publish evidence only after the stored artifact is found", async (context) => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = new Map([
    ["verified-radio-7f3a21b", {
      id: "published-id",
      slug: "verified-radio-7f3a21b",
      title: "Verified Radio",
      presetId: "crypto-radio",
      spec: {},
      html: "<main>Published artifact</main>",
      createdAt: new Date().toISOString(),
    }],
  ]);
  context.after(() => {
    globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  const verified = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({
      name: "Verified Crypto Radio",
      url: "https://drops.example/p/verified-radio-7f3a21b",
      dropsStudioSlug: "verified-radio-7f3a21b",
      category: "media",
    }),
    sessionC,
  ));
  assert.equal(verified.status, 201);
  const payload = await verified.json();
  assert.equal(payload.launch.evidence.destination, "verified-drops-studio-publish");
  assert.equal(payload.providerEvidence.destination, "verified-drops-studio-publish");

  const missing = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({
      name: "Missing Studio Build",
      url: "https://drops.example/p/missing-build-123",
      dropsStudioSlug: "missing-build-123",
      category: "media",
    }),
    sessionD,
  ));
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /publish the Drops Studio project/i);
});

test("community launch submissions enforce the documented daily browser or network ceiling", async (context) => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  context.after(() => {
    globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  for (let index = 1; index <= 3; index += 1) {
    const response = await submitLaunch(jsonRequest(
      "https://drops.example/api/product-hunt/launches",
      launchBody({
        name: `Daily launch ${index}`,
        url: `https://daily-launch-${index}.example/app`,
      }),
      sessionA,
    ));
    assert.equal(response.status, 201);
  }
  const limited = await submitLaunch(jsonRequest(
    "https://drops.example/api/product-hunt/launches",
    launchBody({ name: "Daily launch 4", url: "https://daily-launch-4.example/app" }),
    sessionA,
  ));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "86400");
  assert.match((await limited.json()).error, /daily launch submission limit/i);
});
