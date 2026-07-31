import { createHash } from "node:crypto";
import type { NextRequest } from "next/server.js";

import {
  exchangeOidcAuthorizationCode,
  oidcProviderConfig,
  oidcUserInfo,
  safeEqual,
  verifyOidcJwt,
} from "../../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  clearDemoCookie,
  enforceOidcRateLimit,
  OIDC_DEMO_COOKIE,
  oidcErrorResponse,
  oidcJson,
  readDemoFlow,
  studioMember,
} from "../../../../../../lib/enterprise-platform/oidc-provider-route.ts";
import { durableOidcAuthorizationCodeStore } from "../../../../../../lib/enterprise-platform/oidc-provider-storage.ts";

export async function GET(request: NextRequest) {
  let response;
  try {
    const config = oidcProviderConfig();
    const account = studioMember(request);
    await enforceOidcRateLimit({
      request,
      identity: `oidc-member:${account.identity}`,
      namespace: "enterprise-oidc-demo-callback",
      max: 10,
      windowMs: 10 * 60_000,
    });
    const flow = readDemoFlow(request.cookies.get(OIDC_DEMO_COOKIE)?.value, config);
    const errors = request.nextUrl.searchParams.getAll("error");
    if (errors.length) throw new Error("OIDC demo authorization failed.");
    const codes = request.nextUrl.searchParams.getAll("code");
    const states = request.nextUrl.searchParams.getAll("state");
    if (codes.length !== 1 || states.length !== 1 || !safeEqual(states[0], flow.state)) {
      throw new Error("OIDC demo callback is invalid.");
    }
    const tokenSet = await exchangeOidcAuthorizationCode({
      code: codes[0],
      codeVerifier: flow.codeVerifier,
      redirectUri: `${config.issuer}/demo/callback`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      config,
      store: await durableOidcAuthorizationCodeStore(),
    });
    const idToken = verifyOidcJwt(tokenSet.id_token, config, {
      type: "JWT",
      audience: config.clientId,
    });
    if (idToken.claims.nonce !== flow.nonce) throw new Error("OIDC demo nonce is invalid.");
    const userInfo = oidcUserInfo(tokenSet.access_token, config);
    if (idToken.claims.sub !== userInfo.sub) throw new Error("OIDC demo subject mismatch.");
    response = oidcJson({
      status: "working",
      issuer: config.issuer,
      providerEvidence: true,
      flow: ["signed-member", "authorize", "authorization-code", "token", "userinfo"],
      subjectHash: createHash("sha256").update(userInfo.sub, "utf8").digest("hex").slice(0, 24),
      token: {
        type: tokenSet.token_type,
        expiresIn: tokenSet.expires_in,
        scope: tokenSet.scope,
        signingAlgorithm: "EdDSA",
        idTokenVerified: true,
        accessTokenVerified: true,
      },
    });
  } catch (error) {
    response = oidcErrorResponse(error);
  }
  clearDemoCookie(response);
  return response;
}
