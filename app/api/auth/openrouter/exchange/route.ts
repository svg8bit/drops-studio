import { NextRequest, NextResponse } from "next/server.js";
import {
  createStudioAccountCookie,
  memberProjectSyncReadiness,
  resolveAccountCookieSecret,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../../../lib/access-tier.ts";
import { saveStudioConnection } from "../../../../../db/studio-account-state.ts";
import { consumeRequestLimit, requestIdentity } from "../../../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";

const MAX_EXCHANGE_BODY_BYTES = 8 * 1_024;

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const secret = resolveAccountCookieSecret();
  if (!secret) return jsonError("Studio account signing is not configured.", 503);

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) {
        return jsonError("Cross-origin authorization exchange rejected.", 403);
      }
    } catch {
      return jsonError("Cross-origin authorization exchange rejected.", 403);
    }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EXCHANGE_BODY_BYTES) {
    return jsonError("OpenRouter authorization response is too large.", 413);
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_EXCHANGE_BODY_BYTES) {
    return jsonError("OpenRouter authorization response is too large.", 413);
  }
  let body: { code?: string; codeVerifier?: string } | null = null;
  try {
    body = JSON.parse(rawBody) as { code?: string; codeVerifier?: string };
  } catch {
    return jsonError("Invalid OpenRouter authorization response.", 400);
  }
  const code = body?.code?.trim() ?? "";
  const codeVerifier = body?.codeVerifier?.trim() ?? "";

  if (!code || !codeVerifier || code.length > 2_048 || codeVerifier.length > 256) {
    return jsonError("Invalid OpenRouter authorization response.", 400);
  }

  const requestLimit = await consumeRequestLimit({
    identity: requestIdentity(request),
    namespace: "openrouter-oauth-exchange",
    max: 5,
    windowMs: 10 * 60 * 1_000,
  });
  if (requestLimit === "limited") {
    return jsonError("Too many OpenRouter authorization attempts. Try again later.", 429);
  }
  if (requestLimit === "unavailable" && process.env.NODE_ENV === "production") {
    return jsonError("Authorization protection is temporarily unavailable.", 503);
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        code_challenge_method: "S256",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { key?: string; user_id?: string; error?: { message?: string }; message?: string };
    if (!response.ok || !payload.key || !payload.user_id) {
      return NextResponse.json(
        { error: payload.error?.message ?? payload.message ?? "OpenRouter did not return a complete account identity." },
        {
          status: response.status >= 400 && response.status < 500 ? response.status : 502,
          headers: { "cache-control": "no-store" },
        },
      );
    }

    const existingAccount = resolveStudioAccount(
      request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    );
    const accountCookie = existingAccount
      ? request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value ?? ""
      : createStudioAccountCookie({ provider: "openrouter", subject: payload.user_id }, secret);
    const account = existingAccount ?? resolveStudioAccount(accountCookie);
    if (account) {
      await saveStudioConnection(account.identity, {
        provider: "openrouter",
        credential: payload.key,
        model: "openrouter/free",
        label: "OpenRouter OAuth",
      }).catch(() => undefined);
    }
    // The API key is returned once to the initiating browser. For a signed-in
    // Studio profile it is also stored only as an AES-GCM encrypted vault entry.
    const result = NextResponse.json(
      {
        key: payload.key,
        account: {
          provider: account?.provider ?? "openrouter",
          connected: true,
          projectSync: memberProjectSyncReadiness(),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
    if (!existingAccount) {
      result.cookies.set(STUDIO_ACCOUNT_COOKIE, accountCookie, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
      });
    }
    return result;
  } catch (error) {
    console.error("[openrouter-auth] key exchange failed", error);
    return jsonError("OpenRouter authorization failed. Try again.", 502);
  }
}
