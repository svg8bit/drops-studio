import { NextRequest, NextResponse } from "next/server.js";

import {
  readStudioAccountState,
  StudioAccountStateUnavailableError,
} from "@/db/studio-account-state";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import {
  connectionVaultConfigured,
  publicConnectionStatuses,
} from "@/lib/studio-account-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
  if (!account) {
    return NextResponse.json(
      { authenticated: false, profile: null, connections: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const state = await readStudioAccountState(account.identity);
    return NextResponse.json(
      {
        authenticated: true,
        account: { provider: account.provider },
        profile: state.profile ?? {
          provider: account.provider,
          name: account.provider === "google" ? "Google member" : "OpenRouter member",
        },
        connections: publicConnectionStatuses(state),
        vault: { available: connectionVaultConfigured() },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const unavailable = error instanceof StudioAccountStateUnavailableError;
    return NextResponse.json(
      {
        authenticated: true,
        account: { provider: account.provider },
        profile: null,
        connections: [],
        vault: { available: false },
        error: unavailable ? error.message : "Studio account state could not be read.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
