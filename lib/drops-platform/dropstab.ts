import {
  DROPSTAB_MAX_ATTEMPTS,
  DROPSTAB_REQUEST_TIMEOUT_MS,
  DROPSTAB_SHARED_CACHE_SECONDS,
  normalizeDropsTabActivities,
  normalizeDropsTabCoins,
  normalizeDropsTabFunding,
  normalizeDropsTabUnlocks,
  type DropsTabActivitySignal,
  type DropsTabFundingSignal,
  type DropsTabMarketCoin,
  type DropsTabUnlockSignal,
} from "../dropstab-client.ts";

export type DropsTabCapability = "coins" | "unlocks" | "funding" | "activities";
export type DropsTabProvider = "dropstab" | "fallback" | "unverified";
export type DropsTabConnectionMode = "platform" | "byok" | "demo";

export interface DropsTabEndpointDefinition {
  readonly capability: DropsTabCapability;
  readonly path: "/coins" | "/tokenUnlocks" | "/fundingRounds" | "/cryptoActivities";
  readonly method: "GET";
  readonly pagination: "zero-based";
  readonly attribution: "DropsTab";
  readonly cacheTtlMs: number;
}

export const DROPSTAB_ENDPOINT_REGISTRY = {
  coins: {
    capability: "coins",
    path: "/coins",
    method: "GET",
    pagination: "zero-based",
    attribution: "DropsTab",
    cacheTtlMs: DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
  },
  unlocks: {
    capability: "unlocks",
    path: "/tokenUnlocks",
    method: "GET",
    pagination: "zero-based",
    attribution: "DropsTab",
    cacheTtlMs: DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
  },
  funding: {
    capability: "funding",
    path: "/fundingRounds",
    method: "GET",
    pagination: "zero-based",
    attribution: "DropsTab",
    cacheTtlMs: DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
  },
  activities: {
    capability: "activities",
    path: "/cryptoActivities",
    method: "GET",
    pagination: "zero-based",
    attribution: "DropsTab",
    cacheTtlMs: DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
  },
} as const satisfies Record<DropsTabCapability, DropsTabEndpointDefinition>;

export const DROPSTAB_RETRY_POLICY = Object.freeze({
  maxAttempts: DROPSTAB_MAX_ATTEMPTS,
  timeoutMs: DROPSTAB_REQUEST_TIMEOUT_MS,
  backoffMs: [1_000, 2_000] as const,
  retryableStatuses: [408, 429, 500, 502, 503, 504] as const,
  terminalStatuses: [400, 401, 403, 404] as const,
  pageEndSignal: "400 response whose body says the requested page does not exist",
});

export const DROPSTAB_RATE_LIMIT_POLICY = Object.freeze({
  polling: "explicit-refresh-only" as const,
  warmRuntimeCacheMs: DROPSTAB_SHARED_CACHE_SECONDS * 1_000,
  inFlightDeduplication: true,
  quotaClaim: "provider-headers-only" as const,
  onRateLimited: "bounded-retry-then-honest-unavailable" as const,
});

export type DropsTabNormalizedPayload = {
  coins: DropsTabMarketCoin[];
  unlocks: DropsTabUnlockSignal[];
  funding: DropsTabFundingSignal[];
  activities: DropsTabActivitySignal[];
};

export function normalizeDropsTabPayload<K extends DropsTabCapability>(
  capability: K,
  value: unknown,
): DropsTabNormalizedPayload[K] {
  switch (capability) {
    case "coins":
      return normalizeDropsTabCoins(value) as DropsTabNormalizedPayload[K];
    case "unlocks":
      return normalizeDropsTabUnlocks(value) as DropsTabNormalizedPayload[K];
    case "funding":
      return normalizeDropsTabFunding(value) as DropsTabNormalizedPayload[K];
    case "activities":
      return normalizeDropsTabActivities(value) as DropsTabNormalizedPayload[K];
  }
}

export interface DropsTabRateLimitEvidence {
  limit?: number;
  remaining?: number;
  resetAt?: string;
  retryAfterMs?: number;
}

function nonNegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseDropsTabRateLimitHeaders(headers: Headers): DropsTabRateLimitEvidence {
  const result: DropsTabRateLimitEvidence = {};
  const limit = nonNegativeInteger(headers.get("x-ratelimit-limit"));
  const remaining = nonNegativeInteger(headers.get("x-ratelimit-remaining"));
  const resetSeconds = nonNegativeInteger(headers.get("x-ratelimit-reset"));
  const retryAfterSeconds = nonNegativeInteger(headers.get("retry-after"));
  if (limit !== undefined) result.limit = limit;
  if (remaining !== undefined) result.remaining = remaining;
  if (resetSeconds !== undefined) result.resetAt = new Date(resetSeconds * 1_000).toISOString();
  if (retryAfterSeconds !== undefined) result.retryAfterMs = retryAfterSeconds * 1_000;
  return result;
}

export interface DropsTabProviderEvidence {
  provider: DropsTabProvider;
  mode: DropsTabConnectionMode;
  providerVerified: boolean;
  label: string;
  attribution: "DropsTab" | "Demo data" | "Unverified source";
  fetchedAt: string;
  capabilities: Record<DropsTabCapability, boolean>;
  endpointEvidence: Record<DropsTabCapability, {
    path: DropsTabEndpointDefinition["path"];
    available: boolean;
  }>;
}

export function createDropsTabProviderEvidence(input: {
  provider: DropsTabProvider;
  mode: DropsTabConnectionMode;
  fetchedAt: string;
  capabilities: Record<DropsTabCapability, boolean>;
}): DropsTabProviderEvidence {
  const providerVerified = input.provider === "dropstab" && input.mode !== "demo";
  const label = providerVerified
    ? "Live DropsTab data"
    : input.provider === "fallback" || input.mode === "demo"
      ? "Demo sample data — DropsTab provider not connected"
      : "Unverified data source";
  const attribution = providerVerified
    ? "DropsTab"
    : input.provider === "fallback" || input.mode === "demo"
      ? "Demo data"
      : "Unverified source";
  return {
    provider: input.provider,
    mode: input.mode,
    providerVerified,
    label,
    attribution,
    fetchedAt: input.fetchedAt,
    capabilities: { ...input.capabilities },
    endpointEvidence: Object.fromEntries(
      (Object.keys(DROPSTAB_ENDPOINT_REGISTRY) as DropsTabCapability[]).map((capability) => [
        capability,
        {
          path: DROPSTAB_ENDPOINT_REGISTRY[capability].path,
          available: providerVerified && input.capabilities[capability],
        },
      ]),
    ) as DropsTabProviderEvidence["endpointEvidence"],
  };
}

export type {
  DropsTabActivitySignal,
  DropsTabFundingSignal,
  DropsTabMarketCoin,
  DropsTabUnlockSignal,
};
