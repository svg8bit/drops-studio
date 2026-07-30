import { NextRequest, NextResponse } from "next/server.js";

import {
  BillingUnavailableError,
  BillingValidationError,
  createCustomerPortal,
  stripeBillingProvider,
  stripeCheckoutConfiguration,
} from "@/lib/billing";
import {
  billingRepository,
  billingStorageConfigured,
  BillingStorageUnavailableError,
} from "@/db/billing";
import {
  readStudioBillingAccount,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import { consumeRequestLimit } from "@/lib/request-rate-limit";

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
  const limit = await consumeRequestLimit({
    identity: account.identity,
    legacyIdentity: account.legacyIdentity,
    namespace: "billing-portal",
    max: 20,
    windowMs: 60 * 60 * 1_000,
  });
  if (limit === "limited") return json("Too many portal requests. Try again later.", 429);
  if (limit === "unavailable") return json("Billing request protection is unavailable.", 503);
  try {
    await readStudioBillingAccount(account);
    const receipt = await createCustomerPortal(
      { accountIdentity: account.identity, origin: request.nextUrl.origin },
      {
        config,
        repository: billingRepository,
        provider: stripeBillingProvider(config.secretKey),
      },
    );
    return NextResponse.json(receipt, { headers: HEADERS });
  } catch (error) {
    if (error instanceof BillingValidationError) return json(error.message, 404);
    if (
      error instanceof BillingUnavailableError
      || error instanceof BillingStorageUnavailableError
    ) {
      return json("Billing is not configured or unavailable.", 503);
    }
    return json("Stripe customer portal could not be created.", 502);
  }
}
