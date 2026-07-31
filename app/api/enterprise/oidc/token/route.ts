import type { NextRequest } from "next/server.js";

import {
  exchangeOidcAuthorizationCode,
  oidcProviderConfig,
} from "../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  enforceOidcRateLimit,
  oidcErrorResponse,
  oidcJson,
  parseTokenRequest,
} from "../../../../../lib/enterprise-platform/oidc-provider-route.ts";
import { durableOidcAuthorizationCodeStore } from "../../../../../lib/enterprise-platform/oidc-provider-storage.ts";

export async function POST(request: NextRequest) {
  try {
    await enforceOidcRateLimit({
      request,
      namespace: "enterprise-oidc-token-ingress",
      max: 60,
      windowMs: 60_000,
    });
    const config = oidcProviderConfig();
    const tokenRequest = await parseTokenRequest(request, config);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-client:${config.clientId}`,
      namespace: "enterprise-oidc-token",
      max: 120,
      windowMs: 60_000,
    });
    const tokenSet = await exchangeOidcAuthorizationCode({
      ...tokenRequest,
      config,
      store: await durableOidcAuthorizationCodeStore(),
    });
    return oidcJson(tokenSet);
  } catch (error) {
    return oidcErrorResponse(error);
  }
}
