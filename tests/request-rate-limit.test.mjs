import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
// Next 16 does not publish a package exports map, so direct Node ESM tests
// must address the public server entry with its file extension.
import { NextRequest } from "next/server.js";

import * as requestLimitModule from "../lib/request-rate-limit.ts";

const { consumeRequestLimit, requestIdentity } = requestLimitModule;

test("request identity prefers trusted edge headers and safely falls back to a browser session", () => {
  const edgeRequest = new NextRequest("http://localhost/api/projects/publish", {
    headers: {
      "cf-connecting-ip": "203.0.113.12",
      "x-forwarded-for": "198.51.100.10, 192.0.2.20",
      "x-drops-session": "11111111-1111-4111-8111-111111111111",
    },
  });
  assert.equal(requestIdentity(edgeRequest), "ip:203.0.113.12");

  const sessionRequest = new NextRequest("http://localhost/api/projects/publish", {
    headers: {
      "x-forwarded-for": "not-an-address",
      "x-drops-session": "11111111-1111-4111-8111-111111111111",
    },
  });
  assert.equal(
    requestIdentity(sessionRequest),
    "session:11111111-1111-4111-8111-111111111111",
  );
});

test("development limiter allows a valid identity but never invents one", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercel = process.env.VERCEL;
  const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const previousBlobStore = process.env.BLOB_STORE_ID;
  const previousOidc = process.env.VERCEL_OIDC_TOKEN;
  process.env.NODE_ENV = "test";
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL_OIDC_TOKEN;
  try {
    assert.equal(
      await consumeRequestLimit({
        identity: "session:11111111-1111-4111-8111-111111111111",
        namespace: "project-publish-test",
        max: 1,
        windowMs: 60_000,
      }),
      "allowed",
    );
    assert.equal(
      await consumeRequestLimit({
        identity: null,
        namespace: "project-publish-test",
        max: 1,
        windowMs: 60_000,
      }),
      "unavailable",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken;
    if (previousBlobStore === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previousBlobStore;
    if (previousOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previousOidc;
  }
});

test("the explicit local proof store enforces its in-memory request ceiling", async () => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();

  const options = {
    identity: "session:33333333-3333-4333-8333-333333333333",
    namespace: "local-proof-limit",
    max: 1,
    windowMs: 60_000,
  };

  try {
    assert.equal(await consumeRequestLimit(options), "allowed");
    assert.equal(await consumeRequestLimit(options), "limited");
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("counted limiter returns authoritative count and remaining allowance", async () => {
  assert.equal(typeof requestLimitModule.consumeRequestLimitState, "function");
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  const options = {
    identity: "member:authoritative-count",
    namespace: "member-ai-plan",
    max: 2,
    windowMs: 60_000,
  };
  try {
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options), {
      status: "allowed",
      count: 1,
      remaining: 1,
    });
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options), {
      status: "allowed",
      count: 2,
      remaining: 0,
    });
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options), {
      status: "limited",
      count: 3,
      remaining: 0,
    });
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("counted limiter normalizes Blob import/read/parse failures to unavailable", async () => {
  assert.equal(typeof requestLimitModule.consumeRequestLimitState, "function");
  const options = {
    identity: "member:storage-failure",
    namespace: "member-ai-plan",
    max: 10,
    windowMs: 60_000,
  };
  const unavailable = await requestLimitModule.consumeRequestLimitState(options, {
    get: async () => { throw new Error("blob unavailable"); },
    put: async () => { throw new Error("unexpected write"); },
  });
  assert.deepEqual(unavailable, { status: "unavailable", count: null, remaining: null });

  const malformed = await requestLimitModule.consumeRequestLimitState(options, {
    get: async () => ({
      statusCode: 200,
      stream: new Blob(["not-json"]).stream(),
      blob: { etag: "etag" },
    }),
    put: async () => { throw new Error("unexpected write"); },
  });
  assert.deepEqual(malformed, { status: "unavailable", count: null, remaining: null });
});

test("an explicit storage override wins over the local proof store when consuming", async () => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  let reads = 0;
  let writes = 0;

  try {
    const state = await requestLimitModule.consumeRequestLimitState({
      identity: "member:storage-override-consume",
      namespace: "member-ai-plan",
      max: 10,
      windowMs: 60_000,
    }, {
      get: async () => {
        reads += 1;
        return null;
      },
      put: async () => {
        writes += 1;
        return { pathname: "override.json", etag: "etag-1" };
      },
    });

    assert.deepEqual(state, { status: "allowed", count: 1, remaining: 9 });
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__.size, 0);
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("an explicit storage override wins over the local proof store when reading", async () => {
  const previousLocalStore = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
  const previousVercel = process.env.VERCEL;
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  let reads = 0;

  try {
    const state = await requestLimitModule.readRequestLimitState({
      identity: "member:storage-override-read",
      namespace: "member-ai-plan",
      max: 10,
      windowMs: 60_000,
    }, {
      get: async () => {
        reads += 1;
        return {
          statusCode: 200,
          stream: new Blob([JSON.stringify({ count: 4, windowEndsAt: Date.now() + 60_000 })]).stream(),
          blob: { etag: "etag-4" },
        };
      },
      put: async () => {
        throw new Error("read must not write");
      },
    });

    assert.deepEqual(state, { status: "allowed", count: 4, remaining: 6 });
    assert.equal(reads, 1);
    assert.equal(globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__.size, 0);
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previousLocalStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previousLocalStore;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("durable limiter reuses one blob and atomically resets an expired window", async () => {
  const originalNow = Date.now;
  let now = Date.parse("2026-07-30T00:00:10.000Z");
  Date.now = () => now;
  let record = null;
  let version = 0;
  const pathnames = [];
  const storage = {
    async get(pathname) {
      pathnames.push(pathname);
      if (!record) return null;
      return {
        statusCode: 200,
        stream: new Blob([record.body]).stream(),
        blob: { etag: record.etag },
      };
    },
    async put(pathname, body, options = {}) {
      pathnames.push(pathname);
      if (options.allowOverwrite === false && record) throw new Error("exists");
      if (options.ifMatch && options.ifMatch !== record?.etag) throw new Error("etag mismatch");
      version += 1;
      record = { body: String(body), etag: `etag-${version}` };
      return { pathname, etag: record.etag };
    },
  };
  const options = {
    identity: "member:stable-window",
    namespace: "member-ai-plan",
    max: 2,
    windowMs: 60_000,
  };

  try {
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options, storage), {
      status: "allowed",
      count: 1,
      remaining: 1,
    });
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options, storage), {
      status: "allowed",
      count: 2,
      remaining: 0,
    });
    const firstWindow = JSON.parse(record.body);
    now = firstWindow.windowEndsAt + 1;
    assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options, storage), {
      status: "allowed",
      count: 1,
      remaining: 1,
    });
    assert.equal(new Set(pathnames).size, 1);
    assert.doesNotMatch(pathnames[0], /\/\d{8,}\//);
  } finally {
    Date.now = originalNow;
  }
});

test("durable limiter retries a transient read failure before consuming", async () => {
  let reads = 0;
  let writes = 0;
  const state = await requestLimitModule.consumeRequestLimitState({
    identity: "member:transient-read",
    namespace: "member-ai-plan",
    max: 3,
    windowMs: 60_000,
  }, {
    async get() {
      reads += 1;
      if (reads === 1) throw new Error("temporary read failure");
      return null;
    },
    async put(pathname) {
      writes += 1;
      return { pathname, etag: "etag-1" };
    },
  });

  assert.deepEqual(state, { status: "allowed", count: 1, remaining: 2 });
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("durable limiter survives repeated public-store CAS conflicts without failing open", async () => {
  let record = {
    body: JSON.stringify({ count: 4, windowEndsAt: Date.now() + 60_000 }),
    etag: "etag-4",
  };
  let publicWrites = 0;
  const state = await requestLimitModule.consumeRequestLimitState({
    identity: "session:public-cas-retry",
    namespace: "project-build-run",
    max: 10,
    windowMs: 60_000,
  }, {
    async get(_pathname, options) {
      if (options.access === "private") throw new Error("store access is public");
      return {
        statusCode: 200,
        stream: new Blob([record.body]).stream(),
        blob: { etag: record.etag },
      };
    },
    async put(pathname, body, options) {
      assert.equal(options.access, "public");
      publicWrites += 1;
      if (publicWrites <= 3) {
        record = {
          body: JSON.stringify({ count: 4, windowEndsAt: Date.now() + 60_000 }),
          etag: `concurrent-etag-${publicWrites}`,
        };
        throw new Error("etag mismatch");
      }
      assert.equal(options.ifMatch, record.etag);
      record = { body: String(body), etag: "etag-5" };
      return { pathname, etag: record.etag };
    },
  });

  assert.deepEqual(state, { status: "allowed", count: 5, remaining: 5 });
  assert.equal(publicWrites, 4);
  assert.equal(JSON.parse(record.body).count, 5);
});

test("durable limiter supports an existing public Blob store without weakening the limit", async () => {
  const accesses = [];
  let record = null;
  let version = 0;
  const storage = {
    async get(_pathname, options) {
      accesses.push(`get:${options.access}`);
      if (options.access === "private") throw new Error("store access is public");
      if (!record) return null;
      return {
        statusCode: 200,
        stream: new Blob([record.body]).stream(),
        blob: { etag: record.etag },
      };
    },
    async put(_pathname, body, options) {
      accesses.push(`put:${options.access}`);
      assert.equal(options.access, "public");
      if (options.allowOverwrite === false && record) throw new Error("exists");
      if (options.ifMatch && options.ifMatch !== record?.etag) throw new Error("etag mismatch");
      version += 1;
      record = { body: String(body), etag: `etag-${version}` };
      return { pathname: "rate-limit.json", etag: record.etag };
    },
  };
  const options = {
    identity: "session:public-store",
    namespace: "project-build-run",
    max: 1,
    windowMs: 60_000,
  };

  assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options, storage), {
    status: "allowed",
    count: 1,
    remaining: 0,
  });
  assert.deepEqual(await requestLimitModule.consumeRequestLimitState(options, storage), {
    status: "limited",
    count: 2,
    remaining: 0,
  });
  assert.deepEqual(accesses.slice(0, 3), ["get:private", "get:public", "put:public"]);
});

test("peppered public fallback preserves the active legacy private counter", async () => {
  const previousPepper = process.env.DROPS_ACCOUNT_IDENTITY_PEPPER;
  process.env.DROPS_ACCOUNT_IDENTITY_PEPPER = "test-rate-limit-pepper";
  const identity = "member:legacy-counter";
  const namespace = "project-build-run";
  const legacyHash = createHash("sha256")
    .update(`${namespace}:${identity}`)
    .digest("hex")
    .slice(0, 32);
  const legacyPathname = `drops-studio/rate-limit/${namespace}/${legacyHash}.json`;
  let stored = {
    body: JSON.stringify({ count: 7, windowEndsAt: Date.now() + 60_000 }),
    etag: "legacy-etag",
  };

  try {
    const state = await requestLimitModule.consumeRequestLimitState({
      identity,
      namespace,
      max: 10,
      windowMs: 60_000,
    }, {
      async get(pathname, options) {
        assert.equal(options.access, "private");
        assert.equal(pathname, legacyPathname);
        return {
          statusCode: 200,
          stream: new Blob([stored.body]).stream(),
          blob: { etag: stored.etag },
        };
      },
      async put(pathname, body, options) {
        assert.equal(pathname, legacyPathname);
        assert.equal(options.access, "private");
        assert.equal(options.ifMatch, "legacy-etag");
        stored = { body: String(body), etag: "next-etag" };
        return { pathname, etag: stored.etag };
      },
    });

    assert.deepEqual(state, { status: "allowed", count: 8, remaining: 2 });
    assert.equal(JSON.parse(stored.body).count, 8);
  } finally {
    if (previousPepper === undefined) delete process.env.DROPS_ACCOUNT_IDENTITY_PEPPER;
    else process.env.DROPS_ACCOUNT_IDENTITY_PEPPER = previousPepper;
  }
});
