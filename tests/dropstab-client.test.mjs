import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { readFile } from "node:fs/promises";
import {
  fetchDropsTabCoins,
  fetchDropsTabIntelligence,
  normalizeDropsTabActivities,
  normalizeDropsTabCoins,
  normalizeDropsTabFunding,
  normalizeDropsTabUnlocks,
} from "../lib/dropstab-client.ts";
import { GET as getDropsTab } from "../app/api/dropstab/route.ts";
import { GET as getPublicData } from "../app/api/public-data/route.ts";

const row = {
  symbol: "btc",
  name: "Bitcoin",
  price: { USD: 118420 },
  marketCap: 2_350_000_000_000,
  priceChange24h: 4.21,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(fetchImpl, operation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("normalizes documented DropsTab list response shapes", () => {
  for (const body of [[row], { data: [row] }, { data: { content: [row] } }, { content: [row] }]) {
    const [coin] = normalizeDropsTabCoins(body);
    assert.equal(coin.symbol, "BTC");
    assert.equal(coin.name, "Bitcoin");
    assert.equal(coin.change, 4.21);
    assert.match(coin.price, /^\$/);
  }
});

test("drops malformed rows without inventing symbols", () => {
  assert.deepEqual(normalizeDropsTabCoins({ data: { content: [{ name: "Missing symbol" }, null] } }), []);
});

test("normalizes official unlock, funding, and activity response contracts", () => {
  const [unlock] = normalizeDropsTabUnlocks({ data: { content: [{
    coinSlug: "arbitrum",
    coinSymbol: "ARB",
    totalTokensUnlockedPercent: 47.2,
    totalTokensLockedPercent: 52.8,
    marketCap: 1_200_000_000,
    fdv: 2_500_000_000,
    allocations: [
      { tokenUnlockProgress: { nextTokenUnlockDate: "2026-07-01T00:00:00Z" } },
      { tokenUnlockProgress: { nextTokenUnlockDate: "2026-08-16T00:00:00Z" } },
    ],
  }] } }, 6, Date.parse("2026-07-30T00:00:00Z"));
  assert.equal(unlock.symbol, "ARB");
  assert.equal(unlock.nextUnlockAt, "2026-08-16T00:00:00.000Z");
  assert.equal(unlock.lockedPercent, 52.8);

  const [funding] = normalizeDropsTabFunding({ data: { content: [{
    coinSlug: "jupiter",
    coinSymbol: "JUP",
    fundsRaised: 18_700_000,
    stage: "Series A",
    date: "2026-07-27T00:00:00Z",
    investors: [{ name: "Example Ventures" }],
  }] } });
  assert.equal(funding.symbol, "JUP");
  assert.equal(funding.raisedUsd, 18_700_000);
  assert.deepEqual(funding.investors, ["Example Ventures"]);

  const [activity] = normalizeDropsTabActivities({ data: { content: [{
    coinSlug: "solana",
    coinName: "Solana",
    coinSymbol: "SOL",
    activityType: "Protocol upgrade",
    status: "UPCOMING",
    startDate: 1785542400000,
    description: { overview: "A sourced network upgrade." },
  }] } });
  assert.equal(activity.name, "Solana");
  assert.equal(activity.status, "UPCOMING");
  assert.equal(activity.summary, "A sourced network upgrade.");
});

test("uses the documented base URL, page zero, and auth header", async () => {
  let requestedUrl = "";
  let requestedInit;
  await withFetch(async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return jsonResponse([row]);
  }, async () => {
    await fetchDropsTabCoins("test-key", { pageSize: Number.NaN });
  });
  assert.equal(requestedUrl, "https://public-api.dropstab.com/api/v1/coins?page=0&pageSize=10");
  assert.deepEqual(requestedInit.headers, {
    "x-dropstab-api-key": "test-key",
    accept: "application/json",
  });
});

test("uses official intelligence endpoints and keeps coins when one enrichment is plan-restricted", async () => {
  const requested = [];
  const result = await withFetch(async (input) => {
    const url = new URL(String(input));
    requested.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/coins")) return jsonResponse([row]);
    if (url.pathname.endsWith("/tokenUnlocks")) return jsonResponse({ data: { content: [] } });
    if (url.pathname.endsWith("/fundingRounds")) return new Response("plan access denied", { status: 403 });
    if (url.pathname.endsWith("/cryptoActivities")) return jsonResponse({ data: { content: [] } });
    throw new Error(`Unexpected URL ${url}`);
  }, () => fetchDropsTabIntelligence("visitor-key", {
    mode: "byok",
    sleep: async () => {},
  }));

  assert.equal(result.coins[0].symbol, "BTC");
  assert.deepEqual(result.capabilities, {
    coins: true,
    unlocks: true,
    funding: false,
    activities: true,
  });
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(requested, [
    "/api/v1/coins?page=0&pageSize=10",
    "/api/v1/tokenUnlocks?page=0&pageSize=6&sortingOrder=ASC&sortingField=MARKET_CAP",
    "/api/v1/fundingRounds?page=0&pageSize=6&sortingOrder=DESC&sortingField=DATE",
    "/api/v1/cryptoActivities?page=0&pageSize=6&sortingOrder=ASC&sortingField=START_DATE&status=UPCOMING",
  ]);
});

test("does not retry terminal 400, 401, 403, or 404 responses", async () => {
  for (const [status, code] of [[400, "bad_request"], [401, "unauthorized"], [403, "forbidden"], [404, "not_found"]]) {
    let attempts = 0;
    await withFetch(async () => {
      attempts += 1;
      return new Response(status === 400 ? "invalid request" : "rejected", { status });
    }, async () => {
      await assert.rejects(
        () => fetchDropsTabCoins("test-key", { sleep: async () => {} }),
        (error) => {
          assert.equal(error.code, code);
          assert.equal(error.upstreamStatus, status);
          assert.equal(error.retryable, false);
          return true;
        },
      );
    });
    assert.equal(attempts, 1, `HTTP ${status} must not spend retry budget`);
  }
});

test("classifies page-does-not-exist 400 without retrying", async () => {
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return new Response("page 251 does not exist", { status: 400 });
  }, async () => {
    await assert.rejects(
      () => fetchDropsTabCoins("test-key", { sleep: async () => {} }),
      (error) => error.code === "page_end" && error.retryable === false,
    );
  });
  assert.equal(attempts, 1);
});

test("retries 429 and 5xx with deterministic exponential backoff", async () => {
  for (const status of [429, 503]) {
    let attempts = 0;
    const delays = [];
    const [coin] = await withFetch(async () => {
      attempts += 1;
      return attempts === 1 ? new Response("busy", { status }) : jsonResponse({ data: { content: [row] } });
    }, () => fetchDropsTabCoins("test-key", {
      random: () => 0.5,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    }));
    assert.equal(coin.symbol, "BTC");
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [1_000]);
  }
});

test("retries timeout failures but never exceeds three attempts", async () => {
  let attempts = 0;
  const delays = [];
  await withFetch(async () => {
    attempts += 1;
    throw new DOMException("The operation timed out", "TimeoutError");
  }, async () => {
    await assert.rejects(
      () => fetchDropsTabCoins("test-key", {
        random: () => 0.5,
        sleep: async (milliseconds) => { delays.push(milliseconds); },
      }),
      (error) => error.code === "timeout" && error.retryable === true,
    );
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test("jitters retry backoff within a bounded equal-jitter window", async () => {
  for (const [randomValue, expectedDelay] of [[0, 750], [1, 1_250]]) {
    let attempts = 0;
    const delays = [];
    await withFetch(async () => {
      attempts += 1;
      return attempts === 1 ? new Response("busy", { status: 503 }) : jsonResponse([row]);
    }, () => fetchDropsTabCoins("test-key", {
      random: () => randomValue,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    }));
    assert.deepEqual(delays, [expectedDelay]);
  }
});

test("uses the remaining whole-operation budget for each retry attempt", async () => {
  const originalTimeout = AbortSignal.timeout;
  const attemptTimeouts = [];
  let currentTime = 0;
  let attempts = 0;
  AbortSignal.timeout = (milliseconds) => {
    attemptTimeouts.push(milliseconds);
    return new AbortController().signal;
  };
  try {
    const [coin] = await withFetch(async () => {
      attempts += 1;
      currentTime += attempts === 1 ? 400 : 0;
      return attempts === 1 ? new Response("busy", { status: 503 }) : jsonResponse([row]);
    }, () => fetchDropsTabCoins("test-key", {
      now: () => currentTime,
      random: () => 0,
      sleep: async (milliseconds) => { currentTime += milliseconds; },
      timeoutMs: 2_000,
    }));
    assert.equal(coin.symbol, "BTC");
    assert.deepEqual(attemptTimeouts, [2_000, 850]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test("stops retries when their shared deadline is exhausted", async () => {
  let currentTime = 0;
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return new Response("busy", { status: 503 });
  }, async () => {
    await assert.rejects(
      () => fetchDropsTabCoins("test-key", {
        now: () => currentTime,
        random: () => 0.5,
        sleep: async (milliseconds) => { currentTime += milliseconds; },
        timeoutMs: 1_500,
      }),
      (error) => error.code === "timeout" && error.retryable === true,
    );
  });
  assert.equal(attempts, 2);
});

test("shares one deadline across coins and all intelligence enrichments", async () => {
  let currentTime = 0;
  let enrichmentCalls = 0;
  const result = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/coins")) {
      currentTime = 1_000;
      return jsonResponse([row]);
    }
    enrichmentCalls += 1;
    return jsonResponse({ data: { content: [] } });
  }, () => fetchDropsTabIntelligence("visitor-key", {
    mode: "byok",
    now: () => currentTime,
    timeoutMs: 1_000,
  }));

  assert.equal(result.coins[0].symbol, "BTC");
  assert.equal(enrichmentCalls, 0);
  assert.deepEqual(result.capabilities, {
    coins: true,
    unlocks: false,
    funding: false,
    activities: false,
  });
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.every((warning) => /time budget/i.test(warning)));
});

test("deduplicates and caches platform requests without caching BYOK", async () => {
  let platformCalls = 0;
  let releasePlatform;
  const platformGate = new Promise((resolve) => { releasePlatform = resolve; });
  await withFetch(async () => {
    platformCalls += 1;
    await platformGate;
    return jsonResponse([row]);
  }, async () => {
    const first = fetchDropsTabCoins("platform-key", { mode: "platform", pageSize: 17 });
    const second = fetchDropsTabCoins("platform-key", { mode: "platform", pageSize: 17 });
    releasePlatform();
    await Promise.all([first, second]);
    await fetchDropsTabCoins("platform-key", { mode: "platform", pageSize: 17 });
  });
  assert.equal(platformCalls, 1);

  let byokCalls = 0;
  await withFetch(async () => {
    byokCalls += 1;
    return jsonResponse([row]);
  }, async () => {
    await fetchDropsTabCoins("visitor-key", { mode: "byok", pageSize: 18 });
    await fetchDropsTabCoins("visitor-key", { mode: "byok", pageSize: 18 });
  });
  assert.equal(byokCalls, 2);
});

test("BYOK route preserves upstream status and declares a no-polling private policy", async () => {
  await withFetch(async () => jsonResponse([row]), async () => {
    const response = await getDropsTab(new NextRequest("http://localhost/api/dropstab", {
      headers: { "x-dropstab-api-key": "visitor-key" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const payload = await response.json();
    assert.equal(payload.data.mode, "byok");
    assert.equal(payload.data.credentialOwner, "visitor");
    assert.equal(payload.data.sharedCache, false);
    assert.equal(payload.data.automaticPolling, false);
    assert.equal(payload.data.maxAttemptsPerRequest, 3);
    assert.equal(payload.data.provider, "dropstab");
    assert.equal(payload.capabilities.coins, true);
  });

  for (const status of [400, 401, 403]) {
    await withFetch(async () => new Response("rejected", { status }), async () => {
      const response = await getDropsTab(new NextRequest("http://localhost/api/dropstab", {
        headers: { "x-dropstab-api-key": "visitor-key" },
      }));
      assert.equal(response.status, status);
    });
  }
});

test("public adapter deduplicates platform requests and exposes budget evidence", async () => {
  const originalKey = process.env.DROPSTAB_API_KEY;
  process.env.DROPSTAB_API_KEY = "platform-key";
  let dropsTabCalls = 0;
  try {
    await withFetch(async (input) => {
      const url = String(input);
      if (url.startsWith("https://public-api.dropstab.com/")) {
        dropsTabCalls += 1;
        return jsonResponse([row]);
      }
      if (url.startsWith("https://gamma-api.polymarket.com/")) return jsonResponse([]);
      throw new Error(`Unexpected test URL: ${url}`);
    }, async () => {
      const [first, second] = await Promise.all([getPublicData(), getPublicData()]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const payload = await first.json();
      assert.equal(payload.data.mode, "platform");
      assert.equal(payload.data.credentialOwner, "platform");
      assert.equal(payload.data.automaticPolling, false);
      assert.equal(payload.data.maxAttemptsPerRequest, 3);
      assert.equal(payload.data.sharedCacheSeconds, 900);
    });
    assert.equal(dropsTabCalls, 4);
  } finally {
    if (originalKey === undefined) delete process.env.DROPSTAB_API_KEY;
    else process.env.DROPSTAB_API_KEY = originalKey;
  }
});

test("integration docs distinguish MTProto creation from existing-channel fallback", async () => {
  const [docs, envExample] = await Promise.all([
    readFile(new URL("../docs/INTEGRATIONS.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(docs, /MTProto/i);
  assert.match(docs, /existing-channel fallback/i);
  assert.match(docs, /platform-owned/i);
  assert.match(docs, /visitor-connected/i);
  for (const name of [
    "DROPSTAB_API_KEY",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TELEGRAM_SESSION_ENCRYPTION_KEY",
    "DROPS_STUDIO_TELEGRAM_BOT_TOKEN",
  ]) assert.match(envExample, new RegExp(`^${name}=`, "m"));
});
