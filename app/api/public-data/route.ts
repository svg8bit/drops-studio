import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const assets = [
  { symbol: "BTC", name: "Bitcoin", product: "BTC-USD", marketCap: "$2.35T" },
  { symbol: "ETH", name: "Ethereum", product: "ETH-USD", marketCap: "$463B" },
  { symbol: "SOL", name: "Solana", product: "SOL-USD", marketCap: "$91.7B" },
];

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

export async function GET() {
  try {
    const [tickers, predictionResponse] = await Promise.all([
      Promise.all(assets.map(async (asset) => {
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
      })),
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

    return cors({ coins: tickers, events, source: "Live market adapter · DropsTab research handoff" });
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
