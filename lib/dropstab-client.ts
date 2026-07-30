export const DROPSTAB_API_BASE = "https://public-api.dropstab.com/api/v1";
export const DROPSTAB_SHARED_CACHE_SECONDS = 15 * 60;
export const DROPSTAB_MAX_ATTEMPTS = 3;
export const DROPSTAB_REQUEST_TIMEOUT_MS = 30_000;

const DROPSTAB_RETRY_BASE_MS = 1_000;
const DROPSTAB_MAX_PAGE_SIZE = 100;

export interface DropsTabMarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number | null;
  marketCap: string;
}

export interface DropsTabUnlockSignal {
  symbol: string;
  slug: string;
  nextUnlockAt: string | null;
  unlockedPercent: number | null;
  lockedPercent: number | null;
  marketCap: string;
  fdv: string;
}

export interface DropsTabFundingSignal {
  symbol: string;
  slug: string;
  stage: string;
  raised: string;
  raisedUsd: number | null;
  announcedAt: string | null;
  investors: string[];
}

export interface DropsTabActivitySignal {
  symbol: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  startsAt: string | null;
  summary: string;
}

export interface DropsTabIntelligence {
  coins: DropsTabMarketCoin[];
  unlocks: DropsTabUnlockSignal[];
  funding: DropsTabFundingSignal[];
  activities: DropsTabActivitySignal[];
  capabilities: {
    coins: true;
    unlocks: boolean;
    funding: boolean;
    activities: boolean;
  };
  warnings: string[];
}

export type DropsTabClientErrorCode =
  | "missing_key"
  | "bad_request"
  | "page_end"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream"
  | "timeout"
  | "network"
  | "invalid_response";

export class DropsTabClientError extends Error {
  readonly code: DropsTabClientErrorCode;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;

  constructor(message: string, options: { code: DropsTabClientErrorCode; retryable: boolean; upstreamStatus?: number }) {
    super(message);
    this.name = "DropsTabClientError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.upstreamStatus = options.upstreamStatus;
  }
}

export interface DropsTabFetchOptions {
  mode?: "platform" | "byok";
  pageSize?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

interface DropsTabOperationContext {
  deadlineAt: number;
  fetchImpl: typeof fetch;
  now: () => number;
  random: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  startedAt: number;
}

type PlatformCacheEntry = { expiresAt: number; value: DropsTabMarketCoin[] };
type PlatformIntelligenceCacheEntry = { expiresAt: number; value: DropsTabIntelligence };

const platformCache = new Map<number, PlatformCacheEntry>();
const platformInFlight = new Map<number, Promise<DropsTabMarketCoin[]>>();
const platformIntelligenceCache = new Map<number, PlatformIntelligenceCacheEntry>();
const platformIntelligenceInFlight = new Map<number, Promise<DropsTabIntelligence>>();

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

function rowsFrom(body: unknown): unknown[] {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const nested = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  return Array.isArray(body) ? body
    : Array.isArray(record.data) ? record.data
      : Array.isArray(nested.content) ? nested.content
        : Array.isArray(nested.items) ? nested.items
          : Array.isArray(record.content) ? record.content
            : Array.isArray(record.items) ? record.items
              : [];
}

function cleanText(value: unknown, fallback = "", maxLength = 120): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function safeIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" || /^\d{10,13}$/.test(String(value))
    ? new Date(Number(value) < 10_000_000_000 ? Number(value) * 1_000 : Number(value))
    : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeDropsTabCoins(body: unknown, limit = 10): DropsTabMarketCoin[] {
  return rowsFrom(body).slice(0, limit).map((raw): DropsTabMarketCoin | null => {
    if (!raw || typeof raw !== "object") return null;
    const coin = raw as Record<string, unknown>;
    const symbol = String(coin.symbol ?? coin.ticker ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);
    if (!symbol) return null;
    return {
      symbol,
      name: cleanText(coin.name ?? coin.title, symbol, 48),
      price: money(firstNumber(coin.price, coin.currentPrice, coin.priceUsd)),
      change: firstNumber(coin.priceChange24h, coin.change24h, coin.percentChange24h, coin.priceChangePercentage24h),
      marketCap: money(firstNumber(coin.marketCap, coin.marketCapUsd, coin.cap)),
    };
  }).filter((coin): coin is DropsTabMarketCoin => Boolean(coin));
}

export function normalizeDropsTabUnlocks(
  body: unknown,
  limit = 6,
  referenceTime: number | Date = Date.now(),
): DropsTabUnlockSignal[] {
  const referenceTimestamp = referenceTime instanceof Date ? referenceTime.getTime() : referenceTime;
  const notBefore = Number.isFinite(referenceTimestamp) ? referenceTimestamp : Date.now();
  return rowsFrom(body).slice(0, limit).map((raw): DropsTabUnlockSignal | null => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const symbol = cleanText(item.coinSymbol ?? item.symbol, "", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const slug = cleanText(item.coinSlug ?? item.slug, "", 80).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!symbol || !slug) return null;
    const allocations = Array.isArray(item.allocations) ? item.allocations : [];
    const upcoming = allocations
      .map((allocation) => allocation && typeof allocation === "object"
        ? safeIsoDate((allocation as Record<string, unknown>).tokenUnlockProgress && typeof (allocation as Record<string, unknown>).tokenUnlockProgress === "object"
          ? ((allocation as Record<string, unknown>).tokenUnlockProgress as Record<string, unknown>).nextTokenUnlockDate
          : null)
        : null)
      .filter((value): value is string => Boolean(value))
      .filter((value) => Date.parse(value) >= notBefore)
      .sort()[0] ?? null;
    return {
      symbol,
      slug,
      nextUnlockAt: upcoming,
      unlockedPercent: firstNumber(item.totalTokensUnlockedPercent),
      lockedPercent: firstNumber(item.totalTokensLockedPercent),
      marketCap: money(firstNumber(item.marketCap)),
      fdv: money(firstNumber(item.fdv)),
    };
  }).filter((item): item is DropsTabUnlockSignal => Boolean(item));
}

export function normalizeDropsTabFunding(body: unknown, limit = 6): DropsTabFundingSignal[] {
  return rowsFrom(body).slice(0, limit).map((raw): DropsTabFundingSignal | null => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const symbol = cleanText(item.coinSymbol ?? item.symbol, "", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const slug = cleanText(item.coinSlug ?? item.slug, "", 80).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!symbol || !slug) return null;
    const investors = (Array.isArray(item.investors) ? item.investors : [])
      .map((investor) => investor && typeof investor === "object"
        ? cleanText((investor as Record<string, unknown>).name, "", 80)
        : cleanText(investor, "", 80))
      .filter(Boolean)
      .slice(0, 5);
    const raisedUsd = firstNumber(item.fundsRaised);
    return {
      symbol,
      slug,
      stage: cleanText(item.stage, "Undisclosed round", 60),
      raised: money(raisedUsd),
      raisedUsd,
      announcedAt: safeIsoDate(item.date),
      investors,
    };
  }).filter((item): item is DropsTabFundingSignal => Boolean(item));
}

export function normalizeDropsTabActivities(body: unknown, limit = 6): DropsTabActivitySignal[] {
  return rowsFrom(body).slice(0, limit).map((raw): DropsTabActivitySignal | null => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const symbol = cleanText(item.coinSymbol ?? item.symbol, "", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const slug = cleanText(item.coinSlug ?? item.slug, "", 80).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!symbol || !slug) return null;
    const description = item.description && typeof item.description === "object"
      ? item.description as Record<string, unknown>
      : {};
    return {
      symbol,
      slug,
      name: cleanText(item.coinName, symbol, 80),
      type: cleanText(item.activityType, "Crypto activity", 80),
      status: cleanText(item.status, "UPCOMING", 24).toUpperCase(),
      startsAt: safeIsoDate(item.startDate ?? item.approxStartDate),
      summary: cleanText(description.overview ?? description.description ?? item.activityType, "Open the source activity for details.", 220),
    };
  }).filter((item): item is DropsTabActivitySignal => Boolean(item));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function operationContext(options: DropsTabFetchOptions): DropsTabOperationContext {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const requestedTimeout = options.timeoutMs ?? DROPSTAB_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(DROPSTAB_REQUEST_TIMEOUT_MS, Math.round(requestedTimeout)))
    : DROPSTAB_REQUEST_TIMEOUT_MS;
  return {
    deadlineAt: startedAt + timeoutMs,
    fetchImpl: options.fetchImpl ?? fetch,
    now,
    random: options.random ?? Math.random,
    sleep: options.sleep ?? wait,
    startedAt,
  };
}

function remainingBudget(context: DropsTabOperationContext): number {
  return Math.max(0, Math.floor(context.deadlineAt - context.now()));
}

function budgetError(): DropsTabClientError {
  return new DropsTabClientError("DropsTab operation time budget was exhausted.", {
    code: "timeout",
    retryable: true,
  });
}

function retryDelay(attempt: number, random: () => number): number {
  const sample = Number(random());
  const boundedSample = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  const exponential = DROPSTAB_RETRY_BASE_MS * (2 ** attempt);
  return Math.round(exponential * (0.75 + boundedSample * 0.5));
}

function cloneCoins(coins: DropsTabMarketCoin[]): DropsTabMarketCoin[] {
  return coins.map((coin) => ({ ...coin }));
}

async function responseError(response: Response, resource = "request"): Promise<DropsTabClientError> {
  const upstreamStatus = response.status;
  if (upstreamStatus === 400) {
    const detail = await response.text().catch(() => "");
    const pageEnd = /page\b.*does not exist/i.test(detail);
    return new DropsTabClientError(
      pageEnd ? "DropsTab reported that the requested page does not exist." : `DropsTab rejected the documented ${resource} request.`,
      { code: pageEnd ? "page_end" : "bad_request", retryable: false, upstreamStatus },
    );
  }
  if (upstreamStatus === 401) {
    return new DropsTabClientError("DropsTab rejected this API key.", { code: "unauthorized", retryable: false, upstreamStatus });
  }
  if (upstreamStatus === 403) {
    return new DropsTabClientError(`This DropsTab API key does not have access to the ${resource} endpoint.`, { code: "forbidden", retryable: false, upstreamStatus });
  }
  if (upstreamStatus === 404) {
    return new DropsTabClientError(`The documented DropsTab ${resource} endpoint was not found.`, { code: "not_found", retryable: false, upstreamStatus });
  }
  if (upstreamStatus === 408) {
    return new DropsTabClientError("DropsTab request timed out.", { code: "timeout", retryable: true, upstreamStatus });
  }
  if (upstreamStatus === 429) {
    return new DropsTabClientError("DropsTab rate limit reached.", { code: "rate_limited", retryable: true, upstreamStatus });
  }
  if (upstreamStatus >= 500) {
    return new DropsTabClientError(`DropsTab returned ${upstreamStatus}.`, { code: "upstream", retryable: true, upstreamStatus });
  }
  return new DropsTabClientError(`DropsTab rejected the ${resource} request with status ${upstreamStatus}.`, {
    code: "bad_request",
    retryable: false,
    upstreamStatus,
  });
}

function transportError(error: unknown): DropsTabClientError {
  if (error instanceof DropsTabClientError) return error;
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  const timedOut = name === "TimeoutError" || name === "AbortError" || /timed?\s*out|timeout/i.test(message);
  return new DropsTabClientError(
    timedOut ? "DropsTab request timed out." : "DropsTab is temporarily unreachable.",
    { code: timedOut ? "timeout" : "network", retryable: true },
  );
}

async function requestDropsTabCoins(
  apiKey: string,
  pageSize: number,
  context: DropsTabOperationContext,
): Promise<DropsTabMarketCoin[]> {
  const body = await requestDropsTabJson(apiKey, "/coins", {
    page: "0",
    pageSize: String(pageSize),
  }, context, "coins");
  const rows = normalizeDropsTabCoins(body, pageSize);
  if (!rows.length) {
    throw new DropsTabClientError("DropsTab responded, but no coin rows were found.", { code: "invalid_response", retryable: false });
  }
  return rows;
}

async function requestDropsTabJson(
  apiKey: string,
  endpoint: "/coins" | "/tokenUnlocks" | "/fundingRounds" | "/cryptoActivities",
  params: Record<string, string>,
  context: DropsTabOperationContext,
  resource: string,
): Promise<unknown> {
  const url = new URL(`${DROPSTAB_API_BASE}${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  for (let attempt = 0; attempt < DROPSTAB_MAX_ATTEMPTS; attempt += 1) {
    const timeoutMs = remainingBudget(context);
    if (timeoutMs <= 0) throw budgetError();
    try {
      const response = await context.fetchImpl(url, {
        headers: { "x-dropstab-api-key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!response.ok) throw await responseError(response, resource);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DropsTabClientError("DropsTab returned an unreadable response.", { code: "invalid_response", retryable: false });
      }
      return body;
    } catch (error) {
      const failure = transportError(error);
      if (!failure.retryable || attempt === DROPSTAB_MAX_ATTEMPTS - 1) throw failure;
      const delay = retryDelay(attempt, context.random);
      if (remainingBudget(context) <= delay) throw budgetError();
      await context.sleep(delay);
    }
  }

  throw new DropsTabClientError("DropsTab is temporarily unavailable.", { code: "upstream", retryable: true });
}

function cloneIntelligence(value: DropsTabIntelligence): DropsTabIntelligence {
  return {
    coins: cloneCoins(value.coins),
    unlocks: value.unlocks.map((item) => ({ ...item })),
    funding: value.funding.map((item) => ({ ...item, investors: [...item.investors] })),
    activities: value.activities.map((item) => ({ ...item })),
    capabilities: { ...value.capabilities },
    warnings: [...value.warnings],
  };
}

async function requestDropsTabIntelligence(
  apiKey: string,
  pageSize: number,
  context: DropsTabOperationContext,
): Promise<DropsTabIntelligence> {
  const coins = await requestDropsTabCoins(apiKey, pageSize, context);
  const enrichment = await Promise.allSettled([
    requestDropsTabJson(apiKey, "/tokenUnlocks", {
      page: "0",
      pageSize: "6",
      sortingOrder: "ASC",
      sortingField: "MARKET_CAP",
    }, context, "token unlocks"),
    requestDropsTabJson(apiKey, "/fundingRounds", {
      page: "0",
      pageSize: "6",
      sortingOrder: "DESC",
      sortingField: "DATE",
    }, context, "funding rounds"),
    requestDropsTabJson(apiKey, "/cryptoActivities", {
      page: "0",
      pageSize: "6",
      sortingOrder: "ASC",
      sortingField: "START_DATE",
      status: "UPCOMING",
    }, context, "crypto activities"),
  ]);
  const warnings: string[] = [];
  const value = <T>(index: number, normalize: (body: unknown) => T[]): T[] => {
    const result = enrichment[index];
    if (result.status === "fulfilled") return normalize(result.value);
    warnings.push(result.reason instanceof Error ? result.reason.message : `DropsTab enrichment ${index + 1} is unavailable.`);
    return [];
  };
  const unlocks = value(0, (body) => normalizeDropsTabUnlocks(body, 6, context.startedAt));
  const funding = value(1, normalizeDropsTabFunding);
  const activities = value(2, normalizeDropsTabActivities);
  return {
    coins,
    unlocks,
    funding,
    activities,
    capabilities: {
      coins: true,
      unlocks: enrichment[0].status === "fulfilled",
      funding: enrichment[1].status === "fulfilled",
      activities: enrichment[2].status === "fulfilled",
    },
    warnings: warnings.slice(0, 3),
  };
}

export function dropsTabErrorHttpStatus(error: unknown): number {
  if (!(error instanceof DropsTabClientError)) return 502;
  if (error.code === "missing_key" || error.code === "unauthorized") return 401;
  if (error.code === "forbidden") return 403;
  if (error.code === "bad_request" || error.code === "page_end") return 400;
  if (error.code === "rate_limited") return 429;
  if (error.code === "timeout") return 504;
  return 502;
}

export async function fetchDropsTabCoins(apiKey: string, options: DropsTabFetchOptions = {}): Promise<DropsTabMarketCoin[]> {
  const key = apiKey.trim();
  if (!key) throw new DropsTabClientError("A DropsTab API key is required.", { code: "missing_key", retryable: false });
  const requestedPageSize = options.pageSize ?? 10;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.min(DROPSTAB_MAX_PAGE_SIZE, Math.round(requestedPageSize)))
    : 10;
  const mode = options.mode ?? "byok";
  if (mode === "byok") return requestDropsTabCoins(key, pageSize, operationContext(options));

  const now = options.now ?? Date.now;
  const cached = platformCache.get(pageSize);
  if (cached && cached.expiresAt > now()) return cloneCoins(cached.value);
  const shared = platformInFlight.get(pageSize);
  if (shared) return shared.then(cloneCoins);

  const pending = requestDropsTabCoins(key, pageSize, operationContext(options))
    .then((coins) => {
      const snapshot = cloneCoins(coins);
      platformCache.set(pageSize, { expiresAt: now() + DROPSTAB_SHARED_CACHE_SECONDS * 1_000, value: snapshot });
      return snapshot;
    })
    .finally(() => { platformInFlight.delete(pageSize); });
  platformInFlight.set(pageSize, pending);
  return pending.then(cloneCoins);
}

/**
 * Fetches the four official DropsTab data families used by Studio recipes.
 * Coins are required. Unlocks, funding and activities fail independently so a
 * plan-restricted endpoint never erases otherwise valid DropsTab market data.
 */
export async function fetchDropsTabIntelligence(
  apiKey: string,
  options: DropsTabFetchOptions = {},
): Promise<DropsTabIntelligence> {
  const key = apiKey.trim();
  if (!key) throw new DropsTabClientError("A DropsTab API key is required.", { code: "missing_key", retryable: false });
  const requestedPageSize = options.pageSize ?? 10;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.min(DROPSTAB_MAX_PAGE_SIZE, Math.round(requestedPageSize)))
    : 10;
  const mode = options.mode ?? "byok";
  if (mode === "byok") return requestDropsTabIntelligence(key, pageSize, operationContext(options));

  const now = options.now ?? Date.now;
  const cached = platformIntelligenceCache.get(pageSize);
  if (cached && cached.expiresAt > now()) return cloneIntelligence(cached.value);
  const shared = platformIntelligenceInFlight.get(pageSize);
  if (shared) return shared.then(cloneIntelligence);

  const pending = requestDropsTabIntelligence(key, pageSize, operationContext(options))
    .then((intelligence) => {
      const snapshot = cloneIntelligence(intelligence);
      platformIntelligenceCache.set(pageSize, {
        expiresAt: now() + DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
        value: snapshot,
      });
      return snapshot;
    })
    .finally(() => { platformIntelligenceInFlight.delete(pageSize); });
  platformIntelligenceInFlight.set(pageSize, pending);
  return pending.then(cloneIntelligence);
}
