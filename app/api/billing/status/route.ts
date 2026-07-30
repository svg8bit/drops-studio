import { NextRequest, NextResponse } from "next/server.js";

import {
  billingEntitlements,
  billingTierForAccount,
  stripeProPriceId,
} from "@/lib/billing";
import {
  billingStorageConfigured,
  BillingStorageUnavailableError,
} from "@/db/billing";
import {
  readStudioBillingAccount,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store, max-age=0", vary: "Cookie" };

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!account) return json({ error: "A signed Studio member account is required." }, 401);
  if (!billingStorageConfigured()) {
    return json({ error: "Billing status is not configured or unavailable." }, 503);
  }
  try {
    const billing = await readStudioBillingAccount(account);
    const tier = billingTierForAccount(billing, stripeProPriceId());
    return json({
      tier,
      entitlements: billingEntitlements(tier),
      billing: billing
        ? {
            status: billing.status,
            cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
            currentPeriodEnd: billing.currentPeriodEnd,
          }
        : {
            status: "none",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
          },
    }, 200);
  } catch (error) {
    if (error instanceof BillingStorageUnavailableError) {
      return json({ error: "Billing status is temporarily unavailable." }, 503);
    }
    return json({ error: "Billing status could not be read safely." }, 500);
  }
}
