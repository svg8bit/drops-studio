import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

import {
  issueOidcAuthorizationCode,
  oidcProviderConfig,
  parseOidcAuthorizationRequest,
} from "../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  authorizationErrorResponse,
  enforceOidcRateLimit,
  OIDC_NO_STORE_HEADERS,
  oidcErrorResponse,
  studioMember,
} from "../../../../../lib/enterprise-platform/oidc-provider-route.ts";
import { durableOidcAuthorizationCodeStore } from "../../../../../lib/enterprise-platform/oidc-provider-storage.ts";

export async function GET(request: NextRequest) {
  let config;
  try {
    config = oidcProviderConfig();
  } catch (error) {
    return oidcErrorResponse(error);
  }
  const params = request.nextUrl.searchParams;
  try {
    const authorizationRequest = parseOidcAuthorizationRequest(params, config);
    const account = studioMember(request);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-member:${account.identity}`,
      namespace: "enterprise-oidc-authorize",
      max: 30,
      windowMs: 10 * 60_000,
    });
    const code = await issueOidcAuthorizationCode({
      request: authorizationRequest,
      member: account,
      store: await durableOidcAuthorizationCodeStore(),
      config,
    });
    const redirect = new URL(authorizationRequest.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", authorizationRequest.state);
    const response = NextResponse.redirect(redirect, 302);
    for (const [header, value] of Object.entries(OIDC_NO_STORE_HEADERS)) {
      response.headers.set(header, value);
    }
    return response;
  } catch (error) {
    return authorizationErrorResponse(error, params, config);
  }
}
