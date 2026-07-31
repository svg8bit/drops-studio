import { NextRequest, NextResponse } from "next/server.js";
import { DROPSTAB_MAX_ATTEMPTS, dropsTabErrorHttpStatus, fetchDropsTabIntelligence } from "../../../lib/dropstab-client.ts";
import { readStudioConnectionSecret } from "../../../db/studio-account-state.ts";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../lib/access-tier.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  const remembered = account
    ? await readStudioConnectionSecret(account.identity, "dropstab").catch(() => null)
    : null;
  const key = request.headers.get("x-dropstab-api-key")?.trim()
    || remembered?.credential;
  if (!key) return NextResponse.json({ error: "A DropsTab API key is required." }, { status: 401 });

  try {
    const intelligence = await fetchDropsTabIntelligence(key, { mode: "byok", pageSize: 10 });
    return NextResponse.json({
      ...intelligence,
      source: "DropsTab Public API · coins, unlocks, funding and activities · user refresh",
      data: {
        mode: "byok",
        provider: "dropstab",
        credentialOwner: "visitor",
        sharedCache: false,
        automaticPolling: false,
        requestTrigger: "explicit user connection or refresh",
        maxAttemptsPerRequest: DROPSTAB_MAX_ATTEMPTS,
        requestBudget: "One required coins request plus up to three independent enrichment requests per explicit refresh.",
      },
    }, { headers: { "cache-control": "private, no-store", vary: "Cookie, x-dropstab-api-key" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DropsTab is temporarily unreachable.";
    const status = dropsTabErrorHttpStatus(error);
    return NextResponse.json({ error: `${message} The builder remains available in sample-data mode.` }, { status });
  }
}
