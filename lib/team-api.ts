import { NextRequest, NextResponse } from "next/server.js";

import {
  billingEntitlements,
  billingTierForAccount,
  stripeProPriceId,
  type BillingEntitlements,
} from "./billing.ts";
import {
  billingStorageConfigured,
  readBillingAccount,
} from "../db/billing.ts";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
  type StudioAccount,
} from "./access-tier.ts";
import { consumeRequestLimit } from "./request-rate-limit.ts";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "./http-request-boundary.ts";

export const TEAM_API_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

export class TeamApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "TeamApiError";
    this.status = status;
    this.code = code;
  }
}

export function teamJson(
  payload: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(payload, { status, headers: TEAM_API_HEADERS });
}

export function teamAccount(request: NextRequest): StudioAccount {
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!account) throw new TeamApiError(401, "A signed Studio member account is required.");
  return account;
}

export function requireTeamSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new TeamApiError(403, "Cross-origin team request rejected.");
  }
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error();
  } catch {
    throw new TeamApiError(403, "Cross-origin team request rejected.");
  }
}

export async function teamRequestBody(
  request: NextRequest,
  maxBytes = 16 * 1_024,
): Promise<Record<string, unknown>> {
  if (!hasJsonMediaType(request)) {
    throw new TeamApiError(415, "Team request requires application/json.");
  }
  let raw: string;
  try {
    raw = decodeUtf8Body(await readBoundedRequestBody(request, maxBytes));
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      throw new TeamApiError(413, "Team request payload is too large.");
    }
    throw new TeamApiError(400, "Team request body is invalid.");
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new TeamApiError(400, "Team request body is invalid.");
  }
}

export async function enforceTeamRateLimit(
  identity: string,
  namespace: string,
): Promise<void> {
  const status = await consumeRequestLimit({
    identity,
    namespace,
    max: 60,
    windowMs: 60 * 60 * 1_000,
  });
  if (status === "limited") throw new TeamApiError(429, "Too many team requests. Try again later.");
  if (status === "unavailable") throw new TeamApiError(503, "Team request protection is unavailable.");
}

export async function proTeamEntitlements(
  ownerIdentity: string,
): Promise<BillingEntitlements> {
  const priceId = stripeProPriceId();
  if (!priceId || !billingStorageConfigured()) {
    throw new TeamApiError(503, "Team billing entitlement is not configured or unavailable.");
  }
  const billing = await readBillingAccount(ownerIdentity).catch(() => {
    throw new TeamApiError(503, "Team billing entitlement is unavailable.");
  });
  const tier = billingTierForAccount(billing, priceId);
  if (tier !== "pro") {
    throw new TeamApiError(
      403,
      "An active subscription to the configured Pro Price is required for team writes.",
      "PRO_REQUIRED",
    );
  }
  return billingEntitlements(tier);
}

export function teamApiError(error: unknown) {
  if (!(error instanceof TeamApiError)) return null;
  return teamJson({
    ...(error.code ? { code: error.code } : {}),
    error: error.message,
  }, error.status);
}
