import { NextResponse } from "next/server.js";
import {
  DROPSTAB_MAX_ATTEMPTS,
  DROPSTAB_SHARED_CACHE_SECONDS,
  fetchDropsTabIntelligence,
  type DropsTabActivitySignal,
  type DropsTabFundingSignal,
  type DropsTabMarketCoin,
  type DropsTabUnlockSignal,
} from "../../../lib/dropstab-client.ts";

// Next.js segment config must be statically analyzable at build time.
export const revalidate = 900;

const assets = [
  { symbol: "BTC", name: "Bitcoin", product: "BTC-USD" },
  { symbol: "ETH", name: "Ethereum", product: "ETH-USD" },
  { symbol: "SOL", name: "Solana", product: "SOL-USD" },
];

type MarketResult = {
  coins: DropsTabMarketCoin[];
  unlocks: DropsTabUnlockSignal[];
  funding: DropsTabFundingSignal[];
  activities: DropsTabActivitySignal[];
  capabilities: {
    coins: boolean;
    unlocks: boolean;
    funding: boolean;
    activities: boolean;
  };
  warnings: string[];
  source: string;
  provider: "dropstab" | "fallback";
  fetchedAt: string;
};

let marketCache: { expiresAt: number; value: MarketResult } | null = null;
let marketRequest: Promise<MarketResult> | null = null;

function money(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function cors(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set(
    "cache-control",
    response.status >= 500 ? "no-store" : `public, max-age=60, s-maxage=${DROPSTAB_SHARED_CACHE_SECONDS}, stale-while-revalidate=3600`,
  );
  return response;
}

async function fetchPublicFallbackMarket(): Promise<DropsTabMarketCoin[]> {
  return Promise.all(assets.map(async (asset) => {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${asset.product}/stats`, {
      headers: { accept: "application/json", "user-agent": "Drops Studio/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) throw new Error(`Market feed returned ${response.status}`);
    const body = await response.json() as { last?: string; open?: string };
    const price = Number(body.last);
    const open = Number(body.open);
    return {
      symbol: asset.symbol,
      name: asset.name,
      price: money(price),
      change: Number.isFinite(price) && Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : null,
      marketCap: "—",
    };
  }));
}

async function fetchMarket(dropsTabKey?: string): Promise<MarketResult> {
  if (marketCache && marketCache.expiresAt > Date.now()) return marketCache.value;
  if (marketRequest) return marketRequest;

  marketRequest = (async () => {
    const fetchedAt = new Date().toISOString();
    const value = dropsTabKey
      ? await fetchDropsTabIntelligence(dropsTabKey, {
          mode: "platform",
          // One shared, de-duplicated 15-minute snapshot powers every project.
          // Returning the complete supported universe lets Aggregator and
          // custom watchlist products filter/rank real rows without polling or
          // spending a request per generated app.
          pageSize: 100,
        })
        .then((intelligence) => ({
          ...intelligence,
          source: "DropsTab Public API · coins, unlocks, funding and activities · shared 15-minute cache",
          provider: "dropstab" as const,
          fetchedAt,
        }))
        .catch(() => fetchPublicFallbackMarket().then((coins) => ({
          coins,
          unlocks: [],
          funding: [],
          activities: [],
          capabilities: { coins: false, unlocks: false, funding: false, activities: false },
          warnings: ["DropsTab platform data is unavailable; public price fallback is active."],
          source: "Live public price fallback · connect DropsTab for unlocks, funding and activities",
          provider: "fallback" as const,
          fetchedAt,
        })))
      : await fetchPublicFallbackMarket()
        .then((coins) => ({
          coins,
          unlocks: [],
          funding: [],
          activities: [],
          capabilities: { coins: false, unlocks: false, funding: false, activities: false },
          warnings: ["Connect a DropsTab API key for source-native market intelligence."],
          source: "Live public price fallback · connect DropsTab for unlocks, funding and activities",
          provider: "fallback" as const,
          fetchedAt,
        }));
    marketCache = { expiresAt: Date.now() + DROPSTAB_SHARED_CACHE_SECONDS * 1_000, value };
    return value;
  })().finally(() => { marketRequest = null; });

  return marketRequest;
}

export async function GET() {
  try {
    const dropsTabKey = process.env.DROPSTAB_API_KEY?.trim();
    const [marketResult, predictionResponse] = await Promise.all([
      fetchMarket(dropsTabKey),
      fetch("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&tag_slug=crypto&order=volume24hr&ascending=false", {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(7_000),
      }).catch(() => null),
    ]);

    const events: Array<{ title: string; probability: number; change: number | null; url: string }> = [];
    if (predictionResponse?.ok) {
      const rows = await predictionResponse.json() as Array<Record<string, unknown>>;
      for (const event of rows.slice(0, 6)) {
        const markets = Array.isArray(event.markets) ? event.markets : [];
        const market = markets[0] as Record<string, unknown> | undefined;
        try {
          const outcomes = typeof market?.outcomes === "string" ? JSON.parse(market.outcomes) : market?.outcomes;
          const prices = typeof market?.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market?.outcomePrices;
          const yesIndex = Array.isArray(outcomes) ? outcomes.findIndex((item) => String(item).toLowerCase() === "yes") : 0;
          const rawProbability = Array.isArray(prices) ? Number(prices[yesIndex >= 0 ? yesIndex : 0]) : Number.NaN;
          if (!Number.isFinite(rawProbability)) continue;
          const probability = Math.round(rawProbability * 100);
          if (probability <= 1 || probability >= 99) continue;
          const upstreamChange = market?.oneDayPriceChange;
          const rawChange = upstreamChange === null || upstreamChange === undefined ? Number.NaN : Number(upstreamChange);
          events.push({
            title: String(event.title ?? event.question ?? "Live crypto prediction"),
            probability,
            change: Number.isFinite(rawChange) ? Math.round(rawChange * 100) : null,
            url: event.slug ? `https://polymarket.com/event/${event.slug}` : "https://polymarket.com/",
          });
        } catch { /* Ignore malformed upstream event rows. */ }
      }
    }

    return cors({
      coins: marketResult.coins,
      unlocks: marketResult.unlocks,
      funding: marketResult.funding,
      activities: marketResult.activities,
      events,
      source: marketResult.source,
      provider: marketResult.provider,
      capabilities: marketResult.capabilities,
      data: {
        provider: marketResult.provider,
        capabilities: marketResult.capabilities,
        warnings: marketResult.warnings,
        mode: marketResult.provider === "dropstab" ? "platform" : "fallback",
        credentialOwner: marketResult.provider === "dropstab" ? "platform" : "none",
        fetchedAt: marketResult.fetchedAt,
        sharedCacheSeconds: DROPSTAB_SHARED_CACHE_SECONDS,
        sharedCache: true,
        automaticPolling: false,
        requestTrigger: "initial load or explicit user refresh",
        maxAttemptsPerRequest: DROPSTAB_MAX_ATTEMPTS,
        budgetPolicy: "At most one cached batch per 15-minute window: one required coins request plus three independent enrichment requests. In-flight calls are de-duplicated; generated apps never poll the API.",
      },
    });
  } catch (error) {
    console.error("[public-data] live adapters failed", error);
    return cors({ error: "The live market adapter is temporarily unavailable." }, { status: 502 });
  }
}

export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET, OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type");
  return response;
}
