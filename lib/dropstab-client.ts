export const DROPSTAB_API_BASE = "https://public-api.dropstab.com/api/v1";
export const DROPSTAB_SHARED_CACHE_SECONDS = 15 * 60;

export interface DropsTabMarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number | null;
  marketCap: string;
}

interface DropsTabFetchOptions {
  mode?: "platform" | "byok";
  pageSize?: number;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1_000) return `$${compact(value)}`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const candidate = typeof value === "object" && "USD" in value
      ? (value as { USD?: unknown }).USD
      : value;
    if (candidate === null || candidate === undefined || (typeof candidate === "string" && !candidate.trim())) continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function normalizeDropsTabCoins(body: unknown, limit = 10): DropsTabMarketCoin[] {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const nested = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  const rows = Array.isArray(body) ? body
    : Array.isArray(record.data) ? record.data
      : Array.isArray(nested.content) ? nested.content
        : Array.isArray(nested.items) ? nested.items
          : Array.isArray(record.content) ? record.content
            : Array.isArray(record.items) ? record.items
              : [];

  return rows.slice(0, limit).map((raw): DropsTabMarketCoin | null => {
    if (!raw || typeof raw !== "object") return null;
    const coin = raw as Record<string, unknown>;
    const symbol = String(coin.symbol ?? coin.ticker ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);
    if (!symbol) return null;
    return {
      symbol,
      name: String(coin.name ?? coin.title ?? symbol).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 48) || symbol,
      price: money(firstNumber(coin.price, coin.currentPrice, coin.priceUsd)),
      change: firstNumber(coin.priceChange24h, coin.change24h, coin.percentChange24h, coin.priceChangePercentage24h),
      marketCap: money(firstNumber(coin.marketCap, coin.marketCapUsd, coin.cap)),
    };
  }).filter((coin): coin is DropsTabMarketCoin => Boolean(coin));
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchDropsTabCoins(apiKey: string, options: DropsTabFetchOptions = {}): Promise<DropsTabMarketCoin[]> {
  const key = apiKey.trim();
  if (!key) throw new Error("A DropsTab API key is required.");
  const requestedPageSize = options.pageSize ?? 10;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.min(50, Math.round(requestedPageSize)))
    : 10;
  const url = `${DROPSTAB_API_BASE}/coins?page=0&pageSize=${pageSize}&sortingOrder=ASC&sortingField=RANK`;
  let lastError = "DropsTab is temporarily unavailable.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const init: RequestInit = {
        headers: { "x-dropstab-api-key": key, accept: "application/json" },
        signal: AbortSignal.timeout(7_000),
        cache: "no-store",
      };
      const response = await fetch(url, init);
      if (response.ok) {
        const rows = normalizeDropsTabCoins(await response.json(), pageSize);
        if (!rows.length) throw new Error("DropsTab responded, but no coin rows were found.");
        return rows;
      }
      if (response.status === 401 || response.status === 403) throw new Error("DropsTab rejected this API key.");
      if (response.status === 400) throw new Error("DropsTab rejected the documented coins request.");
      lastError = response.status === 429 ? "DropsTab rate limit reached." : `DropsTab returned ${response.status}.`;
      if (!retryable(response.status) || attempt === 2) throw new Error(lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (/rejected this API key|rejected the documented|no coin rows/i.test(lastError) || attempt === 2) throw new Error(lastError);
    }
    await wait(250 * (2 ** attempt));
  }

  throw new Error(lastError);
}
