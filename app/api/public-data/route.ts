import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const assets = [
  { symbol: "BTC", name: "Bitcoin", product: "BTC-USD", marketCap: "$2.35T" },
  { symbol: "ETH", name: "Ethereum", product: "ETH-USD", marketCap: "$463B" },
  { symbol: "SOL", name: "Solana", product: "SOL-USD", marketCap: "$91.7B" },
];

interface MarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number;
  marketCap: string;
}

function money(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function cors(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("cache-control", "public, max-age=15, s-maxage=30, stale-while-revalidate=120");
  return response;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const candidate = typeof value === "object" && value !== null && "USD" in value ? (value as { USD?: unknown }).USD : value;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function dropsTabRows(body: unknown): MarketCoin[] {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : {};
  const rows = Array.isArray(body) ? body
    : Array.isArray(record.data) ? record.data
      : Array.isArray(nested.content) ? nested.content
        : Array.isArray(nested.items) ? nested.items
          : Array.isArray(record.content) ? record.content
            : Array.isArray(record.items) ? record.items
              : [];
  return rows.slice(0, 10).map((raw): MarketCoin | null => {
    if (!raw || typeof raw !== "object") return null;
    const coin = raw as Record<string, unknown>;
    const symbol = String(coin.symbol ?? coin.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (!symbol) return null;
    return {
      symbol,
      name: String(coin.name ?? coin.title ?? symbol).slice(0, 48),
      price: money(firstNumber(coin.price, coin.currentPrice, coin.priceUsd)),
      change: firstNumber(coin.priceChange24h, coin.change24h, coin.percentChange24h, coin.priceChangePercentage24h),
      marketCap: money(firstNumber(coin.marketCap, coin.marketCapUsd, coin.cap)),
    };
  }).filter((coin): coin is MarketCoin => Boolean(coin));
}

async function fetchDropsTabMarket(key: string): Promise<MarketCoin[]> {
  const response = await fetch("https://public-api.dropstab.com/api/v1/coins?page=0&pageSize=10&sortingOrder=ASC&sortingField=RANK", {
    headers: { "x-dropstab-api-key": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`DropsTab returned ${response.status}`);
  const rows = dropsTabRows(await response.json());
  if (!rows.length) throw new Error("DropsTab returned no market rows");
  return rows;
}

async function fetchPublicFallbackMarket(): Promise<MarketCoin[]> {
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

export async function GET() {
  try {
    const dropsTabKey = process.env.DROPSTAB_API_KEY?.trim();
    const [marketResult, predictionResponse] = await Promise.all([
      dropsTabKey
        ? fetchDropsTabMarket(dropsTabKey)
          .then((coins) => ({ coins, source: "DropsTab Public API · live" }))
          .catch(() => fetchPublicFallbackMarket().then((coins) => ({ coins, source: "Live public fallback · DropsTab research handoff" })))
        : fetchPublicFallbackMarket().then((coins) => ({ coins, source: "Live public fallback · DropsTab research handoff" })),
      fetch("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&tag_slug=crypto&order=volume24hr&ascending=false", {
        headers: { accept: "application/json" },
        next: { revalidate: 60 },
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

    return cors({ coins: marketResult.coins, events, source: marketResult.source });
  } catch {
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
