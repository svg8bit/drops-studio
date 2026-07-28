import { NextResponse } from "next/server";

export const revalidate = 60;

function probability(markets: unknown): number {
  if (!Array.isArray(markets)) return 50;
  const market = markets[0] as Record<string, unknown> | undefined;
  if (!market) return 50;
  try {
    const outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : market.outcomes;
    const prices = typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices;
    if (Array.isArray(outcomes) && Array.isArray(prices)) {
      const yesIndex = outcomes.findIndex((item) => String(item).toLowerCase() === "yes");
      const value = Number(prices[yesIndex >= 0 ? yesIndex : 0]);
      if (Number.isFinite(value)) return Math.round(value * 100);
    }
  } catch { /* Fall through to a neutral probability. */ }
  return 50;
}

function dayChange(markets: unknown): number {
  if (!Array.isArray(markets)) return 0;
  const market = markets[0] as Record<string, unknown> | undefined;
  const value = Number(market?.oneDayPriceChange ?? market?.oneDayChange ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export async function GET() {
  try {
    const response = await fetch("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=50&tag_slug=crypto&order=volume24hr&ascending=false", { next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("Gamma unavailable");
    const payload = await response.json() as Array<Record<string, unknown>>;
    const impactTopics = /bitcoin|ethereum|solana|crypto|etf|sec|fed|rate|oil|iran|tariff|election/i;
    const events = payload.map((event) => ({
      title: String(event.title ?? event.question ?? "Live prediction market"),
      probability: probability(event.markets),
      change: dayChange(event.markets),
      url: event.slug ? `https://polymarket.com/event/${event.slug}` : "https://polymarket.com/",
    })).filter((event) => event.probability > 1 && event.probability < 99)
      .sort((a, b) => Number(impactTopics.test(b.title)) - Number(impactTopics.test(a.title)))
      .slice(0, 6);
    return NextResponse.json({ events, source: "Polymarket Gamma API" });
  } catch {
    return NextResponse.json({ events: [], error: "Live Polymarket events are temporarily unavailable." }, { status: 502 });
  }
}
