import assert from "node:assert/strict";
import test from "node:test";
import { fetchDropsTabCoins, normalizeDropsTabCoins } from "../lib/dropstab-client.ts";

test("normalizes documented DropsTab list response shapes", () => {
  const row = { symbol: "btc", name: "Bitcoin", price: { USD: 118420 }, marketCap: 2_350_000_000_000, priceChange24h: 4.21 };
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

test("uses the documented default page size for non-finite input", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{ symbol: "BTC", name: "Bitcoin", price: 1, marketCap: 1, priceChange24h: 0 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await fetchDropsTabCoins("test-key", { pageSize: Number.NaN });
    assert.match(requestedUrl, /pageSize=10/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a transient upstream failure and returns normalized data", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ data: { content: [{ symbol: "ETH", name: "Ethereum", price: 1900, marketCap: 1, priceChange24h: 2 }] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const [coin] = await fetchDropsTabCoins("test-key");
    assert.equal(attempts, 2);
    assert.equal(coin.symbol, "ETH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
