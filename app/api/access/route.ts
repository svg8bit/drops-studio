import { NextRequest, NextResponse } from "next/server.js";
import {
  accessMetadata,
  GUEST_IDENTITY_COOKIE,
  GUEST_USAGE_COOKIE,
  memberProjectSyncReadiness,
  platformAiReadiness,
  projectV2SyncReadiness,
  resolveFundedBuildQuota,
  resolveGuestAccess,
  resolveStudioAccount,
  resolveStudioProjectActor,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../lib/access-tier.ts";
import {
  PROJECT_STORE_SCOPE_COOKIE,
  projectStoreScopeCookieValue,
  type ProjectStoreScope,
} from "../../../lib/project-store.ts";
import { readRequestLimitState } from "../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";

function requestOidcToken(request: NextRequest): string | undefined {
  const value = request.headers.get("x-vercel-oidc-token")?.trim() ?? "";
  return value && value.length <= 4_096 && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function setProjectStoreScope(
  response: NextResponse,
  scope: ProjectStoreScope,
): void {
  response.cookies.set(
    PROJECT_STORE_SCOPE_COOKIE,
    projectStoreScopeCookieValue(scope),
    {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
      path: "/",
    },
  );
}

export async function GET(request: NextRequest) {
  const oidcToken = requestOidcToken(request);
  const readinessEnvironment = oidcToken
    ? { ...process.env, VERCEL_OIDC_TOKEN: oidcToken }
    : process.env;
  const date = new Date().toISOString().slice(0, 10);
  const account = resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
  if (account) {
    const fundedQuota = await resolveFundedBuildQuota({ kind: "account", account });
    const memberTier = fundedQuota.tier;
    const memberLimit = fundedQuota.limit;
    const readiness = platformAiReadiness("member", readinessEnvironment);
    const quota = readiness.available
      ? await readRequestLimitState({
          identity: account.identity,
          namespace: "member-ai-plan",
          max: memberLimit,
          windowMs: 24 * 60 * 60 * 1_000,
        })
      : { status: "unavailable" as const, count: null, remaining: null };
    const platformAvailable = readiness.available && quota.status !== "unavailable" && quota.count !== null;
    const projectStoreScope = {
      kind: "member" as const,
      identity: account.identity,
    };
    const response = NextResponse.json(
      {
        access: accessMetadata({
          tier: platformAvailable ? memberTier : "fallback",
          used: quota.count ?? 0,
          account,
          projectSyncAvailable: projectV2SyncReadiness(readinessEnvironment),
          accountProjectSyncAvailable: memberProjectSyncReadiness(readinessEnvironment),
          platformLimit: memberLimit,
        }),
        projectStoreScope,
        quotaSigningConfigured: readiness.signingConfigured,
      },
      { headers: { "cache-control": "no-store" } },
    );
    setProjectStoreScope(response, projectStoreScope);
    return response;
  }
  const context = resolveGuestAccess({
    identityCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
    usageCookie: request.cookies.get(GUEST_USAGE_COOKIE)?.value,
    date,
  });
  const readiness = platformAiReadiness("guest", readinessEnvironment);
  const access = accessMetadata({
    tier: context.configured && readiness.available ? "guest" : "fallback",
    used: context.used,
    projectSyncAvailable: context.configured
      && projectV2SyncReadiness(readinessEnvironment),
  });
  const signedGuestCookie = context.identityCookie
    ?? request.cookies.get(GUEST_IDENTITY_COOKIE)?.value;
  const actor = signedGuestCookie
    ? resolveStudioProjectActor(
        { guestCookie: signedGuestCookie },
        readinessEnvironment,
      )
    : null;
  const projectStoreScope = actor?.kind === "guest"
    ? { kind: "guest" as const, identity: actor.identity }
    : null;
  const response = NextResponse.json(
    {
      access,
      ...(projectStoreScope ? { projectStoreScope } : {}),
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
  if (projectStoreScope) setProjectStoreScope(response, projectStoreScope);
  return response;
}
