import assert from "node:assert/strict";
import test from "node:test";

import {
  DROPSBOT_CAPABILITY_REGISTRY,
  DROPSTAB_ENDPOINT_REGISTRY,
  DROPSTAB_RATE_LIMIT_POLICY,
  DROPSTAB_RETRY_POLICY,
  GENERATED_APP_PRIMITIVE_CONTRACTS,
  capabilityStateForDropsBot,
  createDropsTabProviderEvidence,
  normalizeDropsBotWebhookEvent,
  normalizeDropsTabPayload,
  parseDropsTabRateLimitHeaders,
  processWalletIntelligenceEvent,
  whaleSwapFixture,
} from "../lib/drops-platform/index.ts";

test("DropsTab registry exposes only documented endpoints with bounded policies", () => {
  assert.deepEqual(Object.keys(DROPSTAB_ENDPOINT_REGISTRY), [
    "coins",
    "unlocks",
    "funding",
    "activities",
  ]);
  assert.equal(DROPSTAB_ENDPOINT_REGISTRY.coins.path, "/coins");
  assert.equal(DROPSTAB_ENDPOINT_REGISTRY.unlocks.path, "/tokenUnlocks");
  assert.equal(DROPSTAB_ENDPOINT_REGISTRY.funding.path, "/fundingRounds");
  assert.equal(DROPSTAB_ENDPOINT_REGISTRY.activities.path, "/cryptoActivities");
  assert.equal(DROPSTAB_RETRY_POLICY.maxAttempts, 3);
  assert.deepEqual(DROPSTAB_RETRY_POLICY.retryableStatuses, [408, 429, 500, 502, 503, 504]);
  assert.equal(DROPSTAB_RATE_LIMIT_POLICY.polling, "explicit-refresh-only");
});

test("DropsTab platform normalizes official list envelopes without inventing records", () => {
  const [coin] = normalizeDropsTabPayload("coins", {
    data: { content: [{
      symbol: "btc",
      name: "Bitcoin",
      price: { USD: 118_420 },
      marketCap: 2_350_000_000_000,
      priceChange24h: 4.21,
    }] },
  });
  assert.equal(coin.symbol, "BTC");
  assert.equal(coin.name, "Bitcoin");
  assert.equal(normalizeDropsTabPayload("coins", [{ name: "No symbol" }]).length, 0);
});

test("DropsTab evidence distinguishes verified live data from labelled demo fallback", () => {
  const live = createDropsTabProviderEvidence({
    provider: "dropstab",
    mode: "platform",
    fetchedAt: "2026-07-30T00:00:00.000Z",
    capabilities: { coins: true, unlocks: true, funding: false, activities: false },
  });
  assert.equal(live.providerVerified, true);
  assert.equal(live.label, "Live DropsTab data");

  const fallback = createDropsTabProviderEvidence({
    provider: "fallback",
    mode: "demo",
    fetchedAt: "2026-07-30T00:00:00.000Z",
    capabilities: { coins: true, unlocks: false, funding: false, activities: false },
  });
  assert.equal(fallback.providerVerified, false);
  assert.match(fallback.label, /demo|sample/i);
  assert.doesNotMatch(fallback.label, /live DropsTab/i);
});

test("DropsTab rate-limit evidence is parsed without claiming missing quotas", () => {
  const parsed = parseDropsTabRateLimitHeaders(new Headers({
    "retry-after": "15",
    "x-ratelimit-limit": "100",
    "x-ratelimit-remaining": "7",
    "x-ratelimit-reset": "1785370000",
  }));
  assert.deepEqual(parsed, {
    limit: 100,
    remaining: 7,
    resetAt: "2026-07-30T00:06:40.000Z",
    retryAfterMs: 15_000,
  });
  assert.deepEqual(parseDropsTabRateLimitHeaders(new Headers()), {});
});

test("generated-app primitive contracts are editable source modules with honest states", () => {
  const ids = GENERATED_APP_PRIMITIVE_CONTRACTS.map((item) => item.id);
  assert.deepEqual(ids, [
    "market-table",
    "coin-search",
    "price-card",
    "market-cap-card",
    "unlock-calendar",
    "funding-feed",
    "activity-timeline",
    "comparison",
    "research-links",
    "async-states",
  ]);
  for (const primitive of GENERATED_APP_PRIMITIVE_CONTRACTS) {
    assert.match(primitive.sourcePath, /^components\/drops\/[a-z0-9-]+\.tsx$/);
    assert.match(primitive.moduleSource, /export function/);
    assert.match(primitive.fallbackLabel, /demo|sample|unavailable|setup/i);
    assert.doesNotMatch(primitive.moduleSource, /DROPSTAB_API_KEY|x-dropstab-api-key/i);
  }
});

test("Drops Bot registry keeps undocumented wallet writes in setup-required state", () => {
  assert.equal(DROPSBOT_CAPABILITY_REGISTRY.webhookInbox.support, "documented");
  assert.equal(DROPSBOT_CAPABILITY_REGISTRY.telegramHandoff.support, "documented-handoff");
  assert.equal(DROPSBOT_CAPABILITY_REGISTRY.walletCrud.support, "setup-required");
  const state = capabilityStateForDropsBot("walletCrud");
  assert.equal(state.status, "setup_required");
  assert.equal(state.completed, false);
  assert.match(state.instructions, /@drops|manual/i);
});

test("Drops Bot webhook payloads normalize defensively with explicit evidence", () => {
  const event = normalizeDropsBotWebhookEvent(whaleSwapFixture.payload, {
    receivedAt: whaleSwapFixture.receivedAt,
    providerEvidence: "callback-received",
  });
  assert.equal(event.kind, "swap");
  assert.equal(event.walletAddress, whaleSwapFixture.walletAddress);
  assert.equal(event.chain, "solana");
  assert.equal(event.transactionHash, whaleSwapFixture.transactionHash);
  assert.equal(event.valueUsd, 275_000);
  assert.equal(event.evidence.providerVerified, false);
  assert.equal(event.evidence.providerSignatureVerified, false);
});

test("wallet intelligence pipeline enriches, filters, scores, saves, and requires delivery approval", async () => {
  const saved = [];
  const result = await processWalletIntelligenceEvent({
    payload: whaleSwapFixture.payload,
    receivedAt: whaleSwapFixture.receivedAt,
    providerEvidence: "callback-received",
    rule: {
      id: "whale-sol-swaps",
      name: "Whale SOL swaps",
      enabled: true,
      filters: {
        eventKinds: ["swap"],
        chains: ["solana"],
        minimumValueUsd: 100_000,
      },
      scoreThreshold: 50,
      delivery: { channel: "telegram", destinationLabel: "Alpha desk" },
    },
    enrich: async () => ({
      provider: "dropstab",
      providerVerified: true,
      marketCapUsd: 85_000_000_000,
      fdvUsd: 90_000_000_000,
      nextUnlockAt: "2026-08-16T00:00:00.000Z",
      fundingContext: "Sourced funding context",
    }),
    summarize: async () => "Large SOL swap with upcoming unlock context.",
    save: async (event) => { saved.push(event); },
  });

  assert.equal(result.matched, true);
  assert.ok(result.score >= 50);
  assert.equal(result.enrichment.providerVerified, true);
  assert.equal(result.summary, "Large SOL swap with upcoming unlock context.");
  assert.equal(saved.length, 1);
  assert.equal(result.delivery.status, "approval_required");
  assert.equal(result.delivery.sent, false);
  assert.deepEqual(result.steps, ["normalize", "enrich", "filter", "score", "summarize", "save", "approval"]);
});
