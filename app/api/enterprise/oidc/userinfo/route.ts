import type { NextRequest } from "next/server.js";

import {
  oidcProviderConfig,
  oidcUserInfo,
} from "../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  bearerToken,
  enforceOidcRateLimit,
  oidcErrorResponse,
  oidcJson,
} from "../../../../../lib/enterprise-platform/oidc-provider-route.ts";

async function userInfoResponse(request: NextRequest) {
  try {
    const config = oidcProviderConfig();
    const userInfo = oidcUserInfo(bearerToken(request), config);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-sub:${userInfo.sub}`,
      namespace: "enterprise-oidc-userinfo",
      max: 120,
      windowMs: 60_000,
    });
    return oidcJson(userInfo);
  } catch (error) {
    return oidcErrorResponse(error);
  }
}

export const GET = userInfoResponse;
export const POST = userInfoResponse;
