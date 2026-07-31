import assert from "node:assert/strict";
import test from "node:test";

import {
  collaborationHealth,
  externalOidcHealth,
} from "../lib/platform-provider-health.ts";

const ENVIRONMENT_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "DROPS_COLLABORATION_TRANSPORT_URL",
  "DROPS_PLATFORM_HEALTH_OPERATOR_SECRET",
  "DROPS_ENTERPRISE_OIDC_ISSUER",
  "DROPS_ENTERPRISE_OIDC_CLIENT_ID",
  "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET",
];

function preserveEnvironment(context) {
  const previous = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("collaboration health requires same-origin authenticated durable evidence", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_COLLABORATION_TRANSPORT_URL = "https://drops.example/api/collaboration/transport";
  process.env.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET = "operator-secret-with-more-than-32-bytes";

  let authorization = "";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.href, "https://drops.example/api/collaboration/transport?health=1");
    authorization = new Headers(init.headers).get("authorization") ?? "";
    return Response.json({
      status: "working",
      mode: "neon-postgres",
      evidence: [
        "collaboration-durable-write-live",
        "collaboration-durable-read-live",
        "collaboration-two-actor-order-live",
        "collaboration-idempotency-live",
        "collaboration-cleanup-live",
      ],
    });
  };

  const receipt = await collaborationHealth();
  assert.equal(receipt.status, "working");
  assert.equal(receipt.mode, "durable-realtime-transport-live");
  assert.equal(authorization, `Bearer ${process.env.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET}`);
  assert.doesNotMatch(JSON.stringify(receipt), /operator-secret/);
});

test("collaboration health rejects cross-origin transport before sending authorization", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_COLLABORATION_TRANSPORT_URL = "https://attacker.example/transport";
  process.env.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET = "operator-secret-with-more-than-32-bytes";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("must not fetch");
  };

  const receipt = await collaborationHealth();
  assert.equal(receipt.status, "unavailable");
  assert.equal(called, false);
});

test("collaboration health rejects non-durable fallback evidence", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_COLLABORATION_TRANSPORT_URL = "https://drops.example/api/collaboration/transport";
  process.env.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET = "operator-secret-with-more-than-32-bytes";
  globalThis.fetch = async () => Response.json({
    status: "working",
    mode: "memory-local-fallback",
    evidence: [
      "collaboration-durable-write-live",
      "collaboration-durable-read-live",
      "collaboration-two-actor-order-live",
      "collaboration-idempotency-live",
      "collaboration-cleanup-live",
    ],
  });

  const receipt = await collaborationHealth();
  assert.equal(receipt.status, "unavailable");
});

test("OIDC health verifies same-origin discovery, public JWKS and durable self-check", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const issuer = "https://drops.example/api/enterprise/oidc";
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_ENTERPRISE_OIDC_ISSUER = issuer;
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_ID = "drops-studio-enterprise";
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET = "oidc-client-secret-with-more-than-32-bytes";

  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init.headers).get("authorization") });
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        drops_studio_health_endpoint: `${issuer}/health`,
      });
    }
    if (url.endsWith("/jwks")) {
      return Response.json({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "public-key", kid: "key-1", alg: "EdDSA", use: "sig" }],
      });
    }
    if (url.endsWith("/health")) {
      return Response.json({
        status: "working",
        issuer,
        signingAlgorithm: "EdDSA",
        storage: "private-blob-cas",
        evidence: [
          "https-canonical-issuer",
          "ed25519-sign-verify",
          "public-jwks-no-secret",
          "private-blob-cas",
          "authorization-code-pkce-s256",
          "authorization-code-replay-rejected",
        ],
      });
    }
    return Response.json({ error: "unexpected request" }, { status: 404 });
  };

  const receipt = await externalOidcHealth();
  assert.equal(receipt.status, "working");
  assert.equal(receipt.mode, "drops-studio-oidc-provider-live");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].authorization, null);
  assert.equal(requests[1].authorization, null);
  assert.equal(
    requests[2].authorization,
    `Basic ${Buffer.from("drops-studio-enterprise:oidc-client-secret-with-more-than-32-bytes").toString("base64")}`,
  );
  assert.doesNotMatch(JSON.stringify(receipt), /oidc-client-secret/);
});

test("OIDC health rejects a JWKS containing private key material", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const issuer = "https://drops.example/api/enterprise/oidc";
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_ENTERPRISE_OIDC_ISSUER = issuer;
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_ID = "drops-studio-enterprise";
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET = "oidc-client-secret-with-more-than-32-bytes";
  globalThis.fetch = async (input) => String(input).endsWith("/jwks")
    ? Response.json({ keys: [{ kty: "OKP", kid: "key-1", x: "public", d: "private" }] })
    : Response.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      drops_studio_health_endpoint: `${issuer}/health`,
    });

  const receipt = await externalOidcHealth();
  assert.equal(receipt.status, "unavailable");
  assert.equal(receipt.mode, "oidc-discovery-health-failed");
});

test("external OIDC health uses pinned discovery and JWKS without claiming client authentication", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const issuer = "https://login.identity.example/tenant";
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_ENTERPRISE_OIDC_ISSUER = issuer;
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_ID = "external-enterprise-client";
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET = "external-secret-that-must-not-be-transmitted";
  const requests = [];
  const pinned = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init.headers).get("authorization") });
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer,
        authorization_endpoint: "https://authorize.identity.example/tenant/oauth2/authorize",
        token_endpoint: "https://token.identity.example/tenant/oauth2/token",
        jwks_uri: "https://keys.identity.example/tenant/jwks",
      });
    }
    if (url === "https://keys.identity.example/tenant/jwks") {
      return Response.json({
        keys: [{ kty: "RSA", kid: "external-key-1", n: "public-modulus", e: "AQAB" }],
      });
    }
    return Response.json({ error: "unexpected request" }, { status: 404 });
  };

  const receipt = await externalOidcHealth({
    resolvePinnedFetch: async (url) => {
      pinned.push(url.toString());
      return globalThis.fetch;
    },
  });
  assert.equal(receipt.status, "unavailable");
  assert.equal(receipt.mode, "external-oidc-auth-receipt-required");
  assert.equal(requests.length, 2);
  assert.deepEqual(pinned, [
    `${issuer}/.well-known/openid-configuration`,
    "https://keys.identity.example/tenant/jwks",
  ]);
  assert.ok(requests.every((request) => request.authorization === null));
  assert.doesNotMatch(JSON.stringify(requests), /external-secret/);
  assert.doesNotMatch(JSON.stringify(receipt), /external-secret/);
});

test("first-party OIDC health form-encodes Basic client credentials", async (context) => {
  preserveEnvironment(context);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const issuer = "https://drops.example/api/enterprise/oidc";
  const clientId = "drops+studio:enterprise";
  const clientSecret = "secret+with:reserved%characters-and-32-bytes";
  process.env.NEXT_PUBLIC_APP_URL = "https://drops.example";
  process.env.DROPS_ENTERPRISE_OIDC_ISSUER = issuer;
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_ID = clientId;
  process.env.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET = clientSecret;
  let authorization = "";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        drops_studio_health_endpoint: `${issuer}/health`,
      });
    }
    if (url.endsWith("/jwks")) {
      return Response.json({ keys: [{ kty: "OKP", kid: "key-1", x: "public" }] });
    }
    authorization = new Headers(init.headers).get("authorization") ?? "";
    return Response.json({
      status: "working",
      issuer,
      signingAlgorithm: "EdDSA",
      evidence: [
        "ed25519-sign-verify",
        "public-jwks-no-secret",
        "private-blob-cas",
        "authorization-code-pkce-s256",
        "authorization-code-replay-rejected",
      ],
    });
  };

  const receipt = await externalOidcHealth();
  const encodedId = new URLSearchParams({ value: clientId }).toString().slice("value=".length);
  const encodedSecret = new URLSearchParams({ value: clientSecret }).toString().slice("value=".length);
  assert.equal(receipt.status, "working");
  assert.equal(authorization, `Basic ${Buffer.from(`${encodedId}:${encodedSecret}`).toString("base64")}`);
});
