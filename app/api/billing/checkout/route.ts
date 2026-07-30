import { NextRequest, NextResponse } from "next/server.js";

import {
  BillingUnavailableError,
  BillingValidationError,
  createProCheckout,
  stripeBillingProvider,
  stripeCheckoutConfiguration,
} from "@/lib/billing";
import {
  billingRepository,
  billingStorageConfigured,
  BillingStorageUnavailableError,
} from "@/db/billing";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import { consumeRequestLimit } from "@/lib/request-rate-limit";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store, max-age=0", vary: "Cookie" };

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const config = stripeCheckoutConfiguration();
  if (!config || !billingStorageConfigured()) {
    return json("Billing is not configured or unavailable.", 503);
  }
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!account) return json("A signed Studio member account is required.", 401);
  if (!sameOrigin(request)) return json("Cross-origin billing request rejected.", 403);
  if (!hasJsonMediaType(request)) {
    return json("Billing checkout requires application/json.", 415);
  }
  let raw: string;
  try {
    raw = decodeUtf8Body(await readBoundedRequestBody(request, 2_048));
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      return json("Billing checkout request is too large.", 413);
    }
    return json("Billing checkout request is invalid.", 400);
  }
  let consent = false;
  try {
    consent = (JSON.parse(raw) as { consent?: unknown }).consent === true;
  } catch {
    return json("Billing checkout request is invalid.", 400);
  }
  const limit = await consumeRequestLimit({
    identity: account.identity,
    namespace: "billing-checkout",
    max: 8,
    windowMs: 60 * 60 * 1_000,
  });
  if (limit === "limited") return json("Too many checkout requests. Try again later.", 429);
  if (limit === "unavailable") return json("Billing request protection is unavailable.", 503);
  try {
    const receipt = await createProCheckout(
      { accountIdentity: account.identity, origin: request.nextUrl.origin, consent },
      {
        config,
        repository: billingRepository,
        provider: stripeBillingProvider(config.secretKey),
      },
    );
    return NextResponse.json(receipt, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof BillingValidationError) return json(error.message, 400);
    if (
      error instanceof BillingUnavailableError
      || error instanceof BillingStorageUnavailableError
    ) {
      return json("Billing is not configured or unavailable.", 503);
    }
    return json("Stripe checkout could not be created.", 502);
  }
}
