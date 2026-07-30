import { NextRequest, NextResponse } from "next/server.js";

import {
  BillingValidationError,
  stripeWebhookConfiguration,
  verifyStripeWebhook,
} from "@/lib/billing";
import {
  applyBillingWebhookEvent,
  billingStorageConfigured,
  BillingStorageUnavailableError,
} from "@/db/billing";
import {
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 512 * 1_024;
const HEADERS = { "cache-control": "no-store, max-age=0" };

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

export async function POST(request: NextRequest) {
  const config = stripeWebhookConfiguration();
  if (!config || !billingStorageConfigured()) {
    return json({ error: "Billing webhook is not configured or unavailable." }, 503);
  }
  const signature = request.headers.get("stripe-signature")?.trim() ?? "";
  let raw: Uint8Array;
  try {
    raw = await readBoundedRequestBody(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      return json({ error: "Stripe webhook payload is too large." }, 413);
    }
    return json({ error: "Stripe webhook payload is unreadable." }, 400);
  }
  try {
    const event = verifyStripeWebhook(raw, signature, config.webhookSecret);
    const result = await applyBillingWebhookEvent(event);
    return json({ received: true, duplicate: result.status === "duplicate" }, 200);
  } catch (error) {
    if (error instanceof BillingValidationError) {
      return json({ error: "Stripe webhook signature verification failed." }, 400);
    }
    if (error instanceof BillingStorageUnavailableError) {
      return json({ error: "Billing webhook storage is unavailable." }, 503);
    }
    return json({ error: "Billing webhook could not be processed safely." }, 500);
  }
}
