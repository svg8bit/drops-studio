import { NextResponse } from "next/server";
import { DROPSTAB_SHARED_CACHE_SECONDS, fetchDropsTabCoins, type DropsTabMarketCoin } from "@/lib/dropstab-client";

export const revalidate = DROPSTAB_SHARED_CACHE_SECONDS;

const assets = [
  { symbol: "BTC", name: "Bitcoin", product: "BTC-USD", marketCap: "$2.35T" },
  { symbol: "ETH", name: "Ethereum", product: "ETH-USD", marketCap: "$463B" },
  { symbol: "SOL", name: "Solana", product: "SOL-USD", marketCap: "$91.7B" },
];

type MarketResult = {
  coins: DropsTabMarketCoin[];
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
      change: Number.isFinite(price) && Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : 0,
      marketCap: asset.marketCap,
    };
  }));
}

async function fetchMarket(dropsTabKey?: string): Promise<MarketResult> {
  if (marketCache && marketCache.expiresAt > Date.now()) return marketCache.value;
  if (marketRequest) return marketRequest;

  marketRequest = (async () => {
    const fetchedAt = new Date().toISOString();
    const value = dropsTabKey
      ? await fetchDropsTabCoins(dropsTabKey, { mode: "platform", pageSize: 10 })
        .then((coins) => ({ coins, source: "DropsTab Public API · shared 15-minute cache", provider: "dropstab" as const, fetchedAt }))
        .catch(() => fetchPublicFallbackMarket().then((coins) => ({ coins, source: "Live public fallback · connect DropsTab for full context", provider: "fallback" as const, fetchedAt })))
      : await fetchPublicFallbackMarket()
        .then((coins) => ({ coins, source: "Live public fallback · connect DropsTab for full context", provider: "fallback" as const, fetchedAt }));
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

    const events: Array<{ title: string; probability: number; change: number; url: string }> = [];
    if (predictionResponse?.ok) {
      const rows = await predictionResponse.json() as Array<Record<string, unknown>>;
      for (const event of rows.slice(0, 6)) {
        const markets = Array.isArray(event.markets) ? event.markets : [];
        const market = markets[0] as Record<string, unknown> | undefined;
        try {
          const outcomes = typeof market?.outcomes === "string" ? JSON.parse(market.outcomes) : market?.outcomes;
          const prices = typeof market?.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market?.outcomePrices;
          const yesIndex = Array.isArray(outcomes) ? outcomes.findIndex((item) => String(item).toLowerCase() === "yes") : 0;
          const probability = Array.isArray(prices) ? Math.round(Number(prices[yesIndex >= 0 ? yesIndex : 0]) * 100) : 50;
          if (probability <= 1 || probability >= 99) continue;
          events.push({
            title: String(event.title ?? event.question ?? "Live crypto prediction"),
            probability,
            change: Math.round(Number(market?.oneDayPriceChange ?? 0) * 100),
            url: event.slug ? `https://polymarket.com/event/${event.slug}` : "https://polymarket.com/",
          });
        } catch { /* Ignore malformed upstream event rows. */ }
      }
    }

    return cors({
      coins: marketResult.coins,
      events,
      source: marketResult.source,
      data: {
        provider: marketResult.provider,
        fetchedAt: marketResult.fetchedAt,
        sharedCacheSeconds: DROPSTAB_SHARED_CACHE_SECONDS,
        budgetPolicy: "Targets one shared DropsTab market request per warm cache window; generated apps never poll the API.",
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
