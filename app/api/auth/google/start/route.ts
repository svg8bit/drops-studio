import { NextRequest, NextResponse } from "next/server.js";

import { resolveAccountCookieSecret } from "@/lib/access-tier";
import {
  createGoogleOidcTransaction,
  GOOGLE_OIDC_TRANSACTION_COOKIE,
  GOOGLE_OIDC_TRANSACTION_TTL_SECONDS,
  googleAuthorizationUrl,
  serializeGoogleOidcTransaction,
} from "@/lib/google-oidc";
import { safeSameOriginReturnPath } from "@/lib/safe-return-to";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = resolveAccountCookieSecret();
  if (!clientId || !secret) {
    return NextResponse.redirect(new URL("/?auth=google-unavailable", request.nextUrl.origin));
  }
  const returnTo = safeSameOriginReturnPath(
    request.nextUrl.searchParams.get("returnTo"),
    request.nextUrl.origin,
  );
  const transaction = createGoogleOidcTransaction(returnTo, request.nextUrl.origin);
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  const response = NextResponse.redirect(googleAuthorizationUrl({ clientId, redirectUri, transaction }));
  response.cookies.set(
    GOOGLE_OIDC_TRANSACTION_COOKIE,
    serializeGoogleOidcTransaction(transaction, secret),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: GOOGLE_OIDC_TRANSACTION_TTL_SECONDS,
      path: "/api/auth/google",
    },
  );
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
