import { NextRequest, NextResponse } from "next/server.js";
import {
  accessMetadata,
  GUEST_IDENTITY_COOKIE,
  GUEST_USAGE_COOKIE,
  MEMBER_DAILY_LIMIT,
  memberProjectSyncReadiness,
  platformAiReadiness,
  resolveGuestAccess,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../lib/access-tier.ts";
import { readRequestLimitState } from "../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const date = new Date().toISOString().slice(0, 10);
  const account = resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
  if (account) {
    const readiness = platformAiReadiness("member");
    const quota = readiness.available
      ? await readRequestLimitState({
          identity: account.identity,
          namespace: "member-ai-plan",
          max: MEMBER_DAILY_LIMIT,
          windowMs: 24 * 60 * 60 * 1_000,
        })
      : { status: "unavailable" as const, count: null, remaining: null };
    const platformAvailable = readiness.available && quota.status !== "unavailable" && quota.count !== null;
    return NextResponse.json(
      {
        access: accessMetadata({
          tier: platformAvailable ? "member" : "fallback",
          used: quota.count ?? 0,
          account,
          projectSyncAvailable: memberProjectSyncReadiness(),
        }),
        quotaSigningConfigured: readiness.signingConfigured,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const context = resolveGuestAccess({
    identityCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
    usageCookie: request.cookies.get(GUEST_USAGE_COOKIE)?.value,
    date,
  });
  const readiness = platformAiReadiness("guest");
  const access = accessMetadata({
    tier: context.configured && readiness.available ? "guest" : "fallback",
    used: context.used,
  });
  const response = NextResponse.json(
    {
      access,
      quotaSigningConfigured: readiness.signingConfigured,
    },
    { headers: { "cache-control": "no-store" } },
  );
  if (context.identityCookie) {
    response.cookies.set(GUEST_IDENTITY_COOKIE, context.identityCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
      path: "/",
    });
  }
  return response;
}
