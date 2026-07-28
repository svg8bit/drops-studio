import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function compact(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(numeric);
}

function money(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (numeric >= 1_000) return `$${compact(numeric)}`;
  if (numeric >= 1) return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${numeric.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const candidate = typeof value === "object" && value !== null && "USD" in value ? (value as { USD?: unknown }).USD : value;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

export async function GET(request: NextRequest) {
  const key = request.headers.get("x-dropstab-api-key")?.trim();
  if (!key) return NextResponse.json({ error: "A DropsTab API key is required." }, { status: 401 });

  try {
    const upstream = await fetch("https://public-api.dropstab.com/api/v1/coins?page=0&pageSize=10&sortingOrder=ASC&sortingField=RANK", {
      headers: { "x-dropstab-api-key": key, accept: "application/json" },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: upstream.status === 401 || upstream.status === 403 ? "DropsTab rejected this API key." : `DropsTab returned ${upstream.status}.` }, { status: upstream.status === 429 ? 429 : 502 });
    }
    const body = await upstream.json() as Record<string, unknown>;
    const nested = body.data as Record<string, unknown> | undefined;
    const rows = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : Array.isArray(nested?.content) ? nested.content : Array.isArray(nested?.items) ? nested.items : Array.isArray(body.content) ? body.content : Array.isArray(body.items) ? body.items : [];
    const coins = rows.slice(0, 10).map((raw) => {
      const coin = raw as Record<string, unknown>;
      return {
        symbol: String(coin.symbol ?? coin.ticker ?? "—").toUpperCase(),
        name: String(coin.name ?? coin.title ?? coin.symbol ?? "Unknown"),
        price: money(firstNumber(coin.price, coin.currentPrice, coin.priceUsd)),
        change: firstNumber(coin.priceChange24h, coin.change24h, coin.percentChange24h, coin.priceChangePercentage24h),
        marketCap: money(firstNumber(coin.marketCap, coin.marketCapUsd, coin.cap)),
      };
    }).filter((coin) => coin.symbol !== "—");
    if (!coins.length) return NextResponse.json({ error: "DropsTab responded, but no coin rows were found in this account response." }, { status: 502 });
    return NextResponse.json({ coins, source: "DropsTab Public API" });
  } catch {
    return NextResponse.json({ error: "DropsTab is temporarily unreachable. The builder remains available in sample-data mode." }, { status: 502 });
  }
}
