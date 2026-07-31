import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";

import { pkceChallenge } from "../lib/enterprise-platform/oidc-provider.ts";

const ISSUER = "https://drops.example/api/enterprise/oidc";
const CLIENT_ID = "drops-studio-enterprise-client";
const CLIENT_SECRET = "c".repeat(48);
const REDIRECT_URI = `${ISSUER}/demo/callback`;
const ENVIRONMENT_KEYS = [
  "DROPS_ENTERPRISE_OIDC_ISSUER",
  "DROPS_ENTERPRISE_OIDC_CLIENT_ID",
  "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET",
  "DROPS_ENTERPRISE_OIDC_SIGNING_SECRET",
  "DROPS_ENTERPRISE_OIDC_REDIRECT_URIS",
];

async function withProviderEnvironment(callback) {
  const original = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DROPS_ENTERPRISE_OIDC_ISSUER: ISSUER,
    DROPS_ENTERPRISE_OIDC_CLIENT_ID: CLIENT_ID,
    DROPS_ENTERPRISE_OIDC_CLIENT_SECRET: CLIENT_SECRET,
    DROPS_ENTERPRISE_OIDC_SIGNING_SECRET: "s".repeat(48),
    DROPS_ENTERPRISE_OIDC_REDIRECT_URIS: "https://client.example/callback",
  });
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
    scope: "openid profile",
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
    const jwksResponse = await jwksRoute.GET();
    const jwks = await jwksResponse.json();
    assert.equal(jwksResponse.status, 200);
    assert.equal(jwks.keys[0].alg, "EdDSA");
    assert.equal("d" in jwks.keys[0], false);
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
    const healthResponse = await healthRoute.GET(new NextRequest(`${ISSUER}/health`));
    assert.equal(healthResponse.status, 401);
    assert.equal(healthResponse.headers.get("www-authenticate"), 'Basic realm="Drops Studio OIDC"');
    assert.equal((await healthResponse.json()).error, "invalid_client");
  });
});
