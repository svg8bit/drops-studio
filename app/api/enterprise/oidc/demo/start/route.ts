import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

import { oidcProviderConfig } from "../../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  createDemoFlow,
  enforceOidcRateLimit,
  OIDC_NO_STORE_HEADERS,
  oidcErrorResponse,
  setDemoCookie,
  studioMember,
} from "../../../../../../lib/enterprise-platform/oidc-provider-route.ts";

export async function GET(request: NextRequest) {
  try {
    const config = oidcProviderConfig();
    const account = studioMember(request);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-member:${account.identity}`,
      namespace: "enterprise-oidc-demo-start",
      max: 10,
      windowMs: 10 * 60_000,
    });
    const flow = createDemoFlow(config);
    const authorizationUrl = new URL(`${config.issuer}/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      response_mode: "query",
      client_id: config.clientId,
      redirect_uri: flow.redirectUri,
      scope: "openid",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: flow.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    const response = NextResponse.redirect(authorizationUrl, 302);
    for (const [header, value] of Object.entries(OIDC_NO_STORE_HEADERS)) {
      response.headers.set(header, value);
    }
    setDemoCookie(response, flow.cookie);
    return response;
  } catch (error) {
    return oidcErrorResponse(error);
  }
}
