import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";

import {
  createStudioAccountCookie,
  STUDIO_ACCOUNT_COOKIE,
} from "../lib/access-tier.ts";
import { pkceChallenge } from "../lib/enterprise-platform/oidc-provider.ts";
import {
  createDemoFlow,
  OIDC_DEMO_COOKIE,
} from "../lib/enterprise-platform/oidc-provider-route.ts";

const ISSUER = "https://drops.example/api/enterprise/oidc";
const CLIENT_ID = "drops-studio-enterprise-client";
const CLIENT_SECRET = "c".repeat(48);
const ACCOUNT_SECRET = "a".repeat(48);
const REDIRECT_URI = `${ISSUER}/demo/callback`;
const ENVIRONMENT_KEYS = [
  "DROPS_ENTERPRISE_OIDC_ISSUER",
  "DROPS_ENTERPRISE_OIDC_CLIENT_ID",
  "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET",
  "DROPS_ENTERPRISE_OIDC_SIGNING_SECRET",
  "DROPS_ENTERPRISE_OIDC_SUBJECT_SALT",
  "DROPS_ENTERPRISE_OIDC_REDIRECT_URIS",
  "DROPS_ACCOUNT_COOKIE_SECRET",
  "DROPS_STUDIO_LOCAL_PROJECT_STORE",
  "VERCEL",
];

async function withProviderEnvironment(callback) {
  const original = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DROPS_ENTERPRISE_OIDC_ISSUER: ISSUER,
    DROPS_ENTERPRISE_OIDC_CLIENT_ID: CLIENT_ID,
    DROPS_ENTERPRISE_OIDC_CLIENT_SECRET: CLIENT_SECRET,
    DROPS_ENTERPRISE_OIDC_SIGNING_SECRET: "s".repeat(48),
    DROPS_ENTERPRISE_OIDC_SUBJECT_SALT: "p".repeat(48),
    DROPS_ENTERPRISE_OIDC_REDIRECT_URIS: "https://client.example/callback",
    DROPS_ACCOUNT_COOKIE_SECRET: ACCOUNT_SECRET,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
  });
  delete process.env.VERCEL;
  try {
    await callback();
  } finally {
    for (const key of ENVIRONMENT_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

function authorizationUrl(redirectUri = REDIRECT_URI) {
  const verifier = "v".repeat(64);
  const url = new URL(`${ISSUER}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    response_mode: "query",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid",
    state: "state_" + "a".repeat(43),
    nonce: "nonce_" + "b".repeat(43),
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url;
}

test("public discovery and JWKS route expose a consistent asymmetric contract", async () => {
  await withProviderEnvironment(async () => {
    const discoveryRoute = await import("../app/api/enterprise/oidc/.well-known/openid-configuration/route.ts");
    const jwksRoute = await import("../app/api/enterprise/oidc/jwks/route.ts");
    const discoveryResponse = await discoveryRoute.GET();
    const discovery = await discoveryResponse.json();
    assert.equal(discoveryResponse.status, 200);
    assert.equal(discovery.issuer, ISSUER);
    assert.equal(discovery.jwks_uri, `${ISSUER}/jwks`);
    assert.equal(discovery.drops_studio_health_endpoint, `${ISSUER}/health`);
    assert.match(discoveryResponse.headers.get("cache-control") ?? "", /public, max-age=300/);
    const jwksResponse = await jwksRoute.GET();
    const jwks = await jwksResponse.json();
    assert.equal(jwksResponse.status, 200);
    assert.equal(jwks.keys[0].alg, "EdDSA");
    assert.equal("d" in jwks.keys[0], false);
    assert.match(jwksResponse.headers.get("cache-control") ?? "", /public, max-age=300/);
  });
});

test("authorize route never synthesizes a user when the signed Studio member cookie is absent", async () => {
  await withProviderEnvironment(async () => {
    const { GET } = await import("../app/api/enterprise/oidc/authorize/route.ts");
    const response = await GET(new NextRequest(authorizationUrl()));
    assert.equal(response.status, 302);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin + location.pathname, REDIRECT_URI);
    assert.equal(location.searchParams.get("error"), "login_required");
    assert.equal(location.searchParams.get("state"), "state_" + "a".repeat(43));
  });
});

test("authorize route never redirects to an unregistered URI and health requires confidential Basic auth", async () => {
  await withProviderEnvironment(async () => {
    const authorizeRoute = await import("../app/api/enterprise/oidc/authorize/route.ts");
    const invalidRedirect = await authorizeRoute.GET(new NextRequest(authorizationUrl("https://attacker.example/callback")));
    assert.equal(invalidRedirect.status, 400);
    assert.equal(invalidRedirect.headers.get("location"), null);
    assert.equal((await invalidRedirect.json()).error, "invalid_request");

    const healthRoute = await import("../app/api/enterprise/oidc/health/route.ts");
    const healthResponse = await healthRoute.GET(new NextRequest(`${ISSUER}/health`, {
      headers: { "x-drops-session": "11111111-1111-4111-8111-111111111111" },
    }));
    assert.equal(healthResponse.status, 401);
    assert.equal(healthResponse.headers.get("www-authenticate"), 'Basic realm="Drops Studio OIDC"');
    assert.equal((await healthResponse.json()).error, "invalid_client");
  });
});

test("token and health ingress rate limits run before confidential client authentication", async () => {
  await withProviderEnvironment(async () => {
    const tokenRoute = await import("../app/api/enterprise/oidc/token/route.ts");
    const healthRoute = await import("../app/api/enterprise/oidc/health/route.ts");
    const tokenHeaders = {
      "content-type": "application/x-www-form-urlencoded",
      "x-drops-session": "22222222-2222-4222-8222-222222222222",
    };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await tokenRoute.POST(new NextRequest(`${ISSUER}/token`, {
        method: "POST",
        headers: tokenHeaders,
        body: "grant_type=authorization_code",
      }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "invalid_client");
    }
    const limitedToken = await tokenRoute.POST(new NextRequest(`${ISSUER}/token`, {
      method: "POST",
      headers: tokenHeaders,
      body: "grant_type=authorization_code",
    }));
    assert.equal(limitedToken.status, 429);
    assert.equal((await limitedToken.json()).error, "temporarily_unavailable");
    assert.match(limitedToken.headers.get("cache-control") ?? "", /no-store/);

    const healthHeaders = {
      "x-drops-session": "33333333-3333-4333-8333-333333333333",
    };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await healthRoute.GET(new NextRequest(`${ISSUER}/health`, {
        headers: healthHeaders,
      }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "invalid_client");
    }
    const limitedHealth = await healthRoute.GET(new NextRequest(`${ISSUER}/health`, {
      headers: healthHeaders,
    }));
    assert.equal(limitedHealth.status, 429);
    assert.equal((await limitedHealth.json()).error, "temporarily_unavailable");
    assert.match(limitedHealth.headers.get("cache-control") ?? "", /no-store/);
  });
});

test("demo authorization requests only the provider's supported openid scope", async () => {
  await withProviderEnvironment(async () => {
    const startRoute = await import("../app/api/enterprise/oidc/demo/start/route.ts");
    const accountCookie = createStudioAccountCookie(
      { provider: "openrouter", subject: "oidc-route-scope-member" },
      ACCOUNT_SECRET,
    );
    const response = await startRoute.GET(new NextRequest(`${ISSUER}/demo/start`, {
      headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}` },
    }));
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("scope"), "openid");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });
});

test("demo callback maps malformed authorization responses to bounded OIDC errors", async () => {
  await withProviderEnvironment(async () => {
    const callbackRoute = await import("../app/api/enterprise/oidc/demo/callback/route.ts");
    const config = {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      signingSecret: "s".repeat(48),
      subjectSalt: "p".repeat(48),
      redirectUris: new Set([REDIRECT_URI]),
    };
    const flow = createDemoFlow(config);
    const accountCookie = createStudioAccountCookie(
      { provider: "openrouter", subject: "oidc-route-test-member" },
      ACCOUNT_SECRET,
    );
    const request = new NextRequest(
      `${ISSUER}/demo/callback?error=access_denied&state=${encodeURIComponent(flow.state)}`,
      {
        headers: {
          cookie: `${STUDIO_ACCOUNT_COOKIE}=${accountCookie}; ${OIDC_DEMO_COOKIE}=${flow.cookie}`,
        },
      },
    );
    const response = await callbackRoute.GET(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_request");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${OIDC_DEMO_COOKIE}=`));
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  });
});
