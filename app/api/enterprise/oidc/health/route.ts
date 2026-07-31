import type { NextRequest } from "next/server.js";

import {
  oidcProviderConfig,
  oidcProviderSelfCheck,
} from "../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  authenticateConfidentialClient,
  enforceOidcRateLimit,
  oidcErrorResponse,
  oidcJson,
} from "../../../../../lib/enterprise-platform/oidc-provider-route.ts";
import { durableOidcAuthorizationCodeStore } from "../../../../../lib/enterprise-platform/oidc-provider-storage.ts";

export async function GET(request: NextRequest) {
  try {
    const config = oidcProviderConfig();
    authenticateConfidentialClient(request, config);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-client:${config.clientId}`,
      namespace: "enterprise-oidc-health",
      max: 30,
      windowMs: 5 * 60_000,
    });
    const store = await durableOidcAuthorizationCodeStore();
    return oidcJson(await oidcProviderSelfCheck(config, store));
  } catch (error) {
    return oidcErrorResponse(error);
  }
}
