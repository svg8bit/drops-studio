import { NextRequest, NextResponse } from "next/server.js";

import { saveStudioAccountProfile } from "@/db/studio-account-state";
import {
  createStudioAccountCookie,
  resolveAccountCookieSecret,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import {
  exchangeGoogleAuthorizationCode,
  GOOGLE_OIDC_TRANSACTION_COOKIE,
  readGoogleOidcTransaction,
} from "@/lib/google-oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clearTransaction(response: NextResponse) {
  response.cookies.set(GOOGLE_OIDC_TRANSACTION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/api/auth/google",
  });
}

function redirectError(request: NextRequest, code: string) {
  const response = NextResponse.redirect(new URL(`/?auth=${encodeURIComponent(code)}`, request.nextUrl.origin));
  clearTransaction(response);
  return response;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const signingSecret = resolveAccountCookieSecret();
  if (!clientId || !clientSecret || !signingSecret) return redirectError(request, "google-unavailable");
  const transaction = readGoogleOidcTransaction(
    request.cookies.get(GOOGLE_OIDC_TRANSACTION_COOKIE)?.value,
    signingSecret,
  );
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!transaction || state !== transaction.state || !code || code.length > 4_096) {
    return redirectError(request, "google-state-invalid");
  }
  try {
    const identity = await exchangeGoogleAuthorizationCode({
      code,
      clientId,
      clientSecret,
      redirectUri: `${request.nextUrl.origin}/api/auth/google/callback`,
      transaction,
    });
    const accountCookie = createStudioAccountCookie(
      { provider: "google", subject: identity.subject },
      signingSecret,
    );
    const account = await import("@/lib/access-tier").then(({ readStudioAccountCookie }) =>
      readStudioAccountCookie(accountCookie, signingSecret),
    );
    if (!account) throw new Error("The signed Studio account could not be created.");
    await saveStudioAccountProfile(account.identity, {
      provider: "google",
      subject: identity.subject,
      name: identity.name,
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.picture ? { picture: identity.picture } : {}),
    });
    const returnTo = new URL(transaction.returnTo, request.nextUrl.origin);
    returnTo.searchParams.set("auth", "google-connected");
    const response = NextResponse.redirect(returnTo);
    response.cookies.set(STUDIO_ACCOUNT_COOKIE, accountCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
      path: "/",
    });
    clearTransaction(response);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    console.error("[google-auth] callback failed", error instanceof Error ? error.message : "unknown");
    return redirectError(request, "google-failed");
  }
}
