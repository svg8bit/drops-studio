export const PROJECT_TEMPLATE_DROPSTAB_TYPES = String.raw`export interface DropsTabCoin {
  symbol: string;
  name: string;
  price: number | null;
  priceLabel: string;
  change24h: number | null;
  marketCap: number | null;
  marketCapLabel: string;
}

export interface DropsTabProviderEvidence {
  provider: "dropstab" | "demo";
  verified: boolean;
  source: string;
  endpoint: "/coins" | null;
  attributionUrl: "https://dropstab.com/";
  fetchedAt: string | null;
  reason: "missing-credential" | "upstream-unavailable" | "invalid-response" | null;
}

export interface DropsTabMarketSnapshot {
  coins: DropsTabCoin[];
  evidence: DropsTabProviderEvidence;
  cache: {
    ttlSeconds: 900;
    automaticPolling: false;
  };
}
`;

export const PROJECT_TEMPLATE_DROPSTAB_SERVER = String.raw`import "server-only";

import type { DropsTabCoin, DropsTabMarketSnapshot } from "./dropstab-types";

const DROPSTAB_COINS_URL = "https://public-api.dropstab.com/api/v1/coins?page=0&pageSize=10";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_COINS = 10;

const EMBEDDED_DEMO_COINS: DropsTabCoin[] = [
  { symbol: "BTC", name: "Bitcoin", price: 118240, priceLabel: "$118,240", change24h: 2.8, marketCap: 2350000000000, marketCapLabel: "$2.35T" },
  { symbol: "ETH", name: "Ethereum", price: 4480, priceLabel: "$4,480", change24h: -1.2, marketCap: 540000000000, marketCapLabel: "$540B" },
  { symbol: "SOL", name: "Solana", price: 214, priceLabel: "$214", change24h: 8.4, marketCap: 101000000000, marketCapLabel: "$101B" },
  { symbol: "ARB", name: "Arbitrum", price: 1.34, priceLabel: "$1.34", change24h: 3.1, marketCap: 7100000000, marketCapLabel: "$7.1B" },
];

let cache: { expiresAt: number; snapshot: DropsTabMarketSnapshot } | null = null;
let inFlight: Promise<DropsTabMarketSnapshot> | null = null;

function rowsFrom(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) return root.data;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  if (Array.isArray(data.content)) return data.content;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(root.content)) return root.content;
  if (Array.isArray(root.items)) return root.items;
  return [];
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const candidate = typeof value === "object" && value && "USD" in value
      ? (value as { USD?: unknown }).USD
      : value;
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function compactMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1_000) {
    return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  if (value >= 1) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return "$" + value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function normalizeDropsTabCoins(payload: unknown): DropsTabCoin[] {
  return rowsFrom(payload).slice(0, MAX_COINS).map((row): DropsTabCoin | null => {
    if (!row || typeof row !== "object") return null;
    const coin = row as Record<string, unknown>;
    const symbol = String(coin.symbol ?? coin.ticker ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);
    if (!symbol) return null;
    const price = firstNumber(coin.price, coin.currentPrice, coin.priceUsd);
    const marketCap = firstNumber(coin.marketCap, coin.marketCapUsd, coin.cap);
    return {
      symbol,
      name: cleanText(coin.name ?? coin.title, symbol, 48),
      price,
      priceLabel: compactMoney(price),
      change24h: firstNumber(coin.priceChange24h, coin.change24h, coin.percentChange24h, coin.priceChangePercentage24h),
      marketCap,
      marketCapLabel: compactMoney(marketCap),
    };
  }).filter((coin): coin is DropsTabCoin => Boolean(coin));
}

function cloneSnapshot(snapshot: DropsTabMarketSnapshot): DropsTabMarketSnapshot {
  return { ...snapshot, coins: snapshot.coins.map((coin) => ({ ...coin })), evidence: { ...snapshot.evidence }, cache: { ...snapshot.cache } };
}

function demoSnapshot(reason: DropsTabMarketSnapshot["evidence"]["reason"]): DropsTabMarketSnapshot {
  return {
    coins: EMBEDDED_DEMO_COINS.map((coin) => ({ ...coin })),
    evidence: {
      provider: "demo",
      verified: false,
      source: "Embedded demo snapshot — not live DropsTab data",
      endpoint: null,
      attributionUrl: "https://dropstab.com/",
      fetchedAt: null,
      reason,
    },
    cache: { ttlSeconds: 900, automaticPolling: false },
  };
}

function failureReason(error: unknown): DropsTabMarketSnapshot["evidence"]["reason"] {
  return error instanceof Error && /empty|shape|json/i.test(error.message)
    ? "invalid-response"
    : "upstream-unavailable";
}

export async function loadDropsTabMarketSnapshot(options: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}): Promise<DropsTabMarketSnapshot> {
  const now = options.now ?? Date.now;
  if (cache && cache.expiresAt > now()) return cloneSnapshot(cache.snapshot);
  if (inFlight) return cloneSnapshot(await inFlight);

  const apiKey = options.apiKey?.trim() || process.env.DROPSTAB_API_KEY?.trim();
  if (!apiKey) return demoSnapshot("missing-credential");

  const timeoutMs = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, Math.round(options.timeoutMs ?? REQUEST_TIMEOUT_MS)));
  const fetchImpl = options.fetchImpl ?? fetch;
  inFlight = (async () => {
    try {
      const response = await fetchImpl(DROPSTAB_COINS_URL, {
        method: "GET",
        headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error("DropsTab upstream status " + response.status);
      const coins = normalizeDropsTabCoins(await response.json());
      if (!coins.length) throw new Error("DropsTab returned an empty or invalid response shape");
      const snapshot: DropsTabMarketSnapshot = {
        coins,
        evidence: {
          provider: "dropstab",
          verified: true,
          source: "DropsTab Public API",
          endpoint: "/coins",
          attributionUrl: "https://dropstab.com/",
          fetchedAt: new Date(now()).toISOString(),
          reason: null,
        },
        cache: { ttlSeconds: 900, automaticPolling: false },
      };
      cache = { expiresAt: now() + CACHE_TTL_MS, snapshot };
      return snapshot;
    } catch (error) {
      console.warn("[dropstab-capability] using embedded demo fallback", { reason: failureReason(error) });
      return demoSnapshot(failureReason(error));
    }
  })().finally(() => { inFlight = null; });

  return cloneSnapshot(await inFlight);
}
`;

export const PROJECT_TEMPLATE_DROPSTAB_CLIENT = String.raw`"use client";

import { useCallback, useEffect, useState } from "react";
import type { DropsTabMarketSnapshot } from "./dropstab-types";

export interface DropsTabCapabilityState {
  snapshot: DropsTabMarketSnapshot | null;
  status: "loading" | "ready" | "unavailable";
  error: string | null;
  refresh: () => void;
}

function isSnapshot(value: unknown): value is DropsTabMarketSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DropsTabMarketSnapshot>;
  if (!Array.isArray(snapshot.coins) || snapshot.coins.length > 10) return false;
  if (!snapshot.evidence || (snapshot.evidence.provider !== "dropstab" && snapshot.evidence.provider !== "demo")) return false;
  if (snapshot.evidence.provider === "dropstab" && (!snapshot.evidence.verified || snapshot.evidence.endpoint !== "/coins")) return false;
  if (snapshot.evidence.provider === "demo" && snapshot.evidence.verified) return false;
  return snapshot.coins.every((coin) => Boolean(coin) && typeof coin.symbol === "string" && typeof coin.name === "string");
}

export function useDropsTabCoins(): DropsTabCapabilityState {
  const [snapshot, setSnapshot] = useState<DropsTabMarketSnapshot | null>(null);
  const [status, setStatus] = useState<DropsTabCapabilityState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const refresh = useCallback(() => {
    setStatus("loading");
    setError(null);
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/capabilities/dropstab", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market capability unavailable");
        const payload: unknown = await response.json();
        if (!isSnapshot(payload)) throw new Error("Market capability returned an invalid response");
        if (!active) return;
        setSnapshot(payload);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("unavailable");
        setError("Market capability unavailable — local product fixtures remain active.");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [requestVersion]);

  return { snapshot, status, error, refresh };
}
`;

export const PROJECT_TEMPLATE_DROPSTAB_ROUTE = String.raw`import { NextResponse } from "next/server";
import { loadDropsTabMarketSnapshot } from "../../../../lib/dropstab-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await loadDropsTabMarketSnapshot();
  const response = NextResponse.json(snapshot);
  response.headers.set("cache-control", "public, max-age=60, s-maxage=900, stale-while-revalidate=3600");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
`;

export const PROJECT_TEMPLATE_DROPSTAB_TEST = String.raw`import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DropsTab capability stays server-only and returns honest provider evidence", async () => {
  const [server, client, route, types] = await Promise.all([
    readFile(new URL("../lib/dropstab-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/use-dropstab-coins.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/capabilities/dropstab/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dropstab-types.ts", import.meta.url), "utf8"),
  ]);
  assert.match(server, /import "server-only"/);
  assert.match(server, /https:\/\/public-api\.dropstab\.com\/api\/v1\/coins\?page=0&pageSize=10/);
  assert.match(server, /process\.env\.DROPSTAB_API_KEY/);
  assert.match(server, /"x-dropstab-api-key": apiKey/);
  assert.match(server, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(server, /CACHE_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(server, /normalizeDropsTabCoins/);
  assert.match(server, /provider: "demo"/);
  assert.match(server, /provider: "dropstab"/);
  assert.match(types, /verified: boolean/);
  assert.match(route, /loadDropsTabMarketSnapshot/);
  assert.doesNotMatch(route, /process\.env|x-dropstab-api-key|public-api\.dropstab/);
  assert.match(client, /\/api\/capabilities\/dropstab/);
  assert.doesNotMatch(client, /DROPSTAB_API_KEY|x-dropstab-api-key|public-api\.dropstab/);
});
`;
