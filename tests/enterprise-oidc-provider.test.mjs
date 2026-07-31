import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server.js";

import {
  OidcProviderError,
  exchangeOidcAuthorizationCode,
  issueOidcAuthorizationCode,
  oidcDiscovery,
  oidcJwks,
  oidcProviderConfig,
  oidcProviderSelfCheck,
  oidcUserInfo,
  parseOidcAuthorizationRequest,
  pkceChallenge,
  verifyOidcJwt,
} from "../lib/enterprise-platform/oidc-provider.ts";
import {
  authenticateConfidentialClient,
  createDemoFlow,
  parseTokenRequest,
  readDemoFlow,
} from "../lib/enterprise-platform/oidc-provider-route.ts";
import { BlobOidcAuthorizationCodeStore } from "../lib/enterprise-platform/oidc-provider-storage.ts";

const NOW = new Date("2026-07-31T09:00:00.000Z");
const ISSUER = "https://drops.example/api/enterprise/oidc";
const CLIENT_ID = "drops-studio-enterprise-client";
const CLIENT_SECRET = "c".repeat(48);
const SIGNING_SECRET = "s".repeat(48);
const REDIRECT_URI = `${ISSUER}/demo/callback`;

function config(overrides = {}) {
  return oidcProviderConfig({
    DROPS_ENTERPRISE_OIDC_ISSUER: ISSUER,
    DROPS_ENTERPRISE_OIDC_CLIENT_ID: CLIENT_ID,
    DROPS_ENTERPRISE_OIDC_CLIENT_SECRET: CLIENT_SECRET,
    DROPS_ENTERPRISE_OIDC_SIGNING_SECRET: SIGNING_SECRET,
    DROPS_ENTERPRISE_OIDC_REDIRECT_URIS: "https://client.example/callback",
    ...overrides,
  });
}

class MemoryGrantStore {
  records = new Map();
  healthy = true;

  async issue(code, record) {
    if (this.records.has(code)) throw new Error("collision");
    this.records.set(code, structuredClone(record));
  }

  async consume(code, nowSeconds) {
    const record = this.records.get(code);
    if (!record || record.consumedAt !== null || record.expiresAt < nowSeconds) return null;
    record.consumedAt = nowSeconds;
    return structuredClone({ ...record, consumedAt: null });
  }

  async health() {
    return this.healthy;
  }
}

function authorizationParams(providerConfig = config(), overrides = {}) {
  const verifier = "v".repeat(64);
  return {
    verifier,
    params: new URLSearchParams({
      response_type: "code",
      response_mode: "query",
      client_id: providerConfig.clientId,
      redirect_uri: REDIRECT_URI,
      scope: "openid profile",
      state: "state_" + "a".repeat(43),
      nonce: "nonce_" + "b".repeat(43),
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      ...overrides,
    }),
  };
}

function hasCode(code) {
  return (error) => error instanceof OidcProviderError && error.code === code;
}

test("provider configuration requires independent strong secrets, canonical HTTPS and exact redirects", () => {
  const providerConfig = config();
  assert.equal(providerConfig.issuer, ISSUER);
  assert.equal(providerConfig.redirectUris.has(REDIRECT_URI), true);
  assert.equal(providerConfig.redirectUris.has("https://client.example/callback"), true);
  assert.throws(() => config({ DROPS_ENTERPRISE_OIDC_ISSUER: "http://drops.example/api/enterprise/oidc" }), hasCode("temporarily_unavailable"));
  assert.throws(() => config({ DROPS_ENTERPRISE_OIDC_ISSUER: "https://drops.example//" }), hasCode("temporarily_unavailable"));
  assert.throws(() => config({ DROPS_ENTERPRISE_OIDC_CLIENT_SECRET: "short" }), hasCode("temporarily_unavailable"));
  assert.throws(() => config({ DROPS_ENTERPRISE_OIDC_SIGNING_SECRET: CLIENT_SECRET }), hasCode("temporarily_unavailable"));
  assert.throws(() => config({ DROPS_ENTERPRISE_OIDC_REDIRECT_URIS: "https://client.example/*" }), hasCode("temporarily_unavailable"));
});

test("discovery and JWKS expose only the asymmetric public verification contract", () => {
  const providerConfig = config();
  const discovery = oidcDiscovery(providerConfig);
  assert.equal(discovery.issuer, ISSUER);
  assert.equal(discovery.authorization_endpoint, `${ISSUER}/authorize`);
  assert.equal(discovery.drops_studio_health_endpoint, `${ISSUER}/health`);
  assert.deepEqual(discovery.id_token_signing_alg_values_supported, ["EdDSA"]);
  assert.deepEqual(discovery.token_endpoint_auth_methods_supported, ["client_secret_basic"]);
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
  const jwks = oidcJwks(providerConfig);
  assert.equal(jwks.keys.length, 1);
  assert.deepEqual(Object.keys(jwks.keys[0]).sort(), ["alg", "crv", "kid", "kty", "use", "x"]);
  assert.equal(jwks.keys[0].kty, "OKP");
  assert.equal(jwks.keys[0].crv, "Ed25519");
  assert.equal(JSON.stringify(jwks).includes(CLIENT_SECRET), false);
  assert.equal(JSON.stringify(jwks).includes(SIGNING_SECRET), false);
});

test("authorization requests require exact client, redirect, state, nonce and PKCE S256", () => {
  const providerConfig = config();
  const { params } = authorizationParams(providerConfig);
  const parsed = parseOidcAuthorizationRequest(params, providerConfig);
  assert.equal(parsed.redirectUri, REDIRECT_URI);
  assert.equal(parsed.scope, "openid profile");

  assert.throws(
    () => parseOidcAuthorizationRequest(authorizationParams(providerConfig, { redirect_uri: `${REDIRECT_URI}.evil` }).params, providerConfig),
    hasCode("invalid_request"),
  );
  assert.throws(
    () => parseOidcAuthorizationRequest(authorizationParams(providerConfig, { code_challenge_method: "plain" }).params, providerConfig),
    hasCode("invalid_request"),
  );
  assert.throws(
    () => parseOidcAuthorizationRequest(authorizationParams(providerConfig, { scope: "openid email" }).params, providerConfig),
    hasCode("invalid_scope"),
  );
  const duplicated = authorizationParams(providerConfig).params;
  duplicated.append("state", "state_" + "z".repeat(43));
  assert.throws(() => parseOidcAuthorizationRequest(duplicated, providerConfig), hasCode("invalid_request"));
});

test("signed Studio member issues a one-time code and receives verifiable short-lived tokens", async () => {
  const providerConfig = config();
  const store = new MemoryGrantStore();
  const request = parseOidcAuthorizationRequest(authorizationParams(providerConfig).params, providerConfig);
  const code = await issueOidcAuthorizationCode({
    request,
    member: { identity: "a".repeat(64), issuedAt: Math.floor(NOW.getTime() / 1_000) - 10, provider: "openrouter" },
    store,
    config: providerConfig,
    now: NOW,
  });
  const tokenSet = await exchangeOidcAuthorizationCode({
    code,
    codeVerifier: authorizationParams(providerConfig).verifier,
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    config: providerConfig,
    store,
    now: NOW,
  });
  assert.equal(tokenSet.token_type, "Bearer");
  assert.equal(tokenSet.expires_in, 300);
  const idToken = verifyOidcJwt(tokenSet.id_token, providerConfig, { type: "JWT", audience: CLIENT_ID, now: NOW });
  assert.equal(idToken.claims.nonce, request.nonce);
  assert.equal(idToken.claims.azp, CLIENT_ID);
  const userInfo = oidcUserInfo(tokenSet.access_token, providerConfig, NOW);
  assert.equal(userInfo.sub, idToken.claims.sub);
  assert.match(userInfo.sub, /^[A-Za-z0-9_-]{43}$/);
  assert.equal("email" in userInfo, false);
  await assert.rejects(
    exchangeOidcAuthorizationCode({
      code,
      codeVerifier: authorizationParams(providerConfig).verifier,
      redirectUri: REDIRECT_URI,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      config: providerConfig,
      store,
      now: NOW,
    }),
    hasCode("invalid_grant"),
  );
});

test("public JWKS verifies the ID token and tampering is rejected", async () => {
  const providerConfig = config();
  const store = new MemoryGrantStore();
  const requestBundle = authorizationParams(providerConfig);
  const request = parseOidcAuthorizationRequest(requestBundle.params, providerConfig);
  const code = await issueOidcAuthorizationCode({
    request,
    member: { identity: "b".repeat(64), issuedAt: Math.floor(NOW.getTime() / 1_000), provider: "openrouter" },
    store,
    config: providerConfig,
    now: NOW,
  });
  const tokens = await exchangeOidcAuthorizationCode({
    code,
    codeVerifier: requestBundle.verifier,
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    config: providerConfig,
    store,
    now: NOW,
  });
  const parts = tokens.id_token.split(".");
  const jwk = oidcJwks(providerConfig).keys[0];
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  assert.equal(
    verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), publicKey, Buffer.from(parts[2], "base64url")),
    true,
  );
  const tampered = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;
  assert.throws(() => verifyOidcJwt(tampered, providerConfig, { type: "JWT", audience: CLIENT_ID, now: NOW }), hasCode("invalid_token"));
  assert.throws(
    () => oidcUserInfo(tokens.access_token, providerConfig, new Date(NOW.getTime() + 6 * 60_000)),
    hasCode("invalid_token"),
  );
});

test("confidential client auth is Basic-only and form bodies are bounded", async () => {
  const providerConfig = config();
  const authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64")}`;
  const credentials = authenticateConfidentialClient(new Request("https://drops.example", { headers: { authorization } }), providerConfig);
  assert.deepEqual(credentials, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  const encodedSecret = `${"p".repeat(40)}+/=`;
  const encodedConfig = config({ DROPS_ENTERPRISE_OIDC_CLIENT_SECRET: encodedSecret });
  const encodedAuthorization = `Basic ${Buffer.from(
    `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(encodedSecret)}`,
    "utf8",
  ).toString("base64")}`;
  assert.deepEqual(
    authenticateConfidentialClient(new Request("https://drops.example", {
      headers: { authorization: encodedAuthorization },
    }), encodedConfig),
    { clientId: CLIENT_ID, clientSecret: encodedSecret },
  );
  assert.throws(
    () => authenticateConfidentialClient(new Request("https://drops.example", { headers: { authorization: "Basic not-base64!" } }), providerConfig),
    hasCode("invalid_client"),
  );
  const request = new NextRequest(`${ISSUER}/token`, {
    method: "POST",
    headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "c".repeat(43),
      redirect_uri: REDIRECT_URI,
      code_verifier: "v".repeat(64),
    }),
  });
  const parsed = await parseTokenRequest(request, providerConfig);
  assert.equal(parsed.clientId, CLIENT_ID);
  assert.equal(parsed.codeVerifier, "v".repeat(64));
  const bodySecretRequest = new NextRequest(`${ISSUER}/token`, {
    method: "POST",
    headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "c".repeat(43),
      redirect_uri: REDIRECT_URI,
      code_verifier: "v".repeat(64),
      client_secret: CLIENT_SECRET,
    }),
  });
  await assert.rejects(parseTokenRequest(bodySecretRequest, providerConfig), hasCode("invalid_request"));
});

test("demo flow cookie is signed, short-lived and contains no provider token", () => {
  const providerConfig = config();
  const flow = createDemoFlow(providerConfig, NOW);
  const parsed = readDemoFlow(flow.cookie, providerConfig, NOW);
  assert.equal(parsed.state, flow.state);
  assert.equal(flow.redirectUri, REDIRECT_URI);
  assert.equal(flow.cookie.includes(CLIENT_SECRET), false);
  assert.throws(() => readDemoFlow(`${flow.cookie.slice(0, -1)}x`, providerConfig, NOW), hasCode("invalid_request"));
  assert.throws(() => readDemoFlow(flow.cookie, providerConfig, new Date(NOW.getTime() + 301_000)), hasCode("invalid_request"));
});

test("bounded self-check proves signing and durable-store readiness without synthetic user claims", async () => {
  const store = new MemoryGrantStore();
  const receipt = await oidcProviderSelfCheck(config(), store, NOW);
  assert.equal(receipt.status, "working");
  assert.equal(receipt.signingAlgorithm, "EdDSA");
  assert.equal(receipt.storage, "private-blob-cas");
  store.healthy = false;
  await assert.rejects(oidcProviderSelfCheck(config(), store, NOW), hasCode("temporarily_unavailable"));
});

class MockBlobStorage {
  records = new Map();
  version = 0;
  accesses = [];

  async get(pathname, options) {
    this.accesses.push(options.access);
    const record = this.records.get(pathname);
    if (!record) return null;
    return {
      statusCode: 200,
      stream: new Blob([record.body]).stream(),
      headers: new Headers(),
      blob: {
        url: `https://private.example/${pathname}`,
        downloadUrl: `https://private.example/${pathname}?download=1`,
        pathname,
        contentDisposition: "inline",
        cacheControl: "private",
        uploadedAt: new Date(),
        etag: record.etag,
        contentType: "application/json",
        size: Buffer.byteLength(record.body),
      },
    };
  }

  async put(pathname, body, options) {
    this.accesses.push(options.access);
    const current = this.records.get(pathname);
    if (current && !options.allowOverwrite) throw new Error("exists");
    if (options.ifMatch && current?.etag !== options.ifMatch) throw new Error("precondition");
    const etag = `etag-${++this.version}`;
    this.records.set(pathname, { body: String(body), etag });
    return { pathname, etag, url: `https://private.example/${pathname}` };
  }

  async del(pathname, options = {}) {
    const current = this.records.get(pathname);
    if (options.ifMatch && current?.etag !== options.ifMatch) throw new Error("precondition");
    this.records.delete(pathname);
  }
}

test("Blob grant store uses opaque private paths and atomic one-time consumption", async () => {
  const storage = new MockBlobStorage();
  const store = new BlobOidcAuthorizationCodeStore(storage);
  const code = "z".repeat(43);
  const record = {
    version: 1,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    subject: "q".repeat(43),
    scope: "openid profile",
    nonce: "n".repeat(43),
    codeChallenge: "p".repeat(43),
    authTime: Math.floor(NOW.getTime() / 1_000),
    issuedAt: Math.floor(NOW.getTime() / 1_000),
    expiresAt: Math.floor(NOW.getTime() / 1_000) + 120,
    consumedAt: null,
  };
  await store.issue(code, record);
  const pathname = [...storage.records.keys()][0];
  assert.equal(pathname.includes(code), false);
  assert.equal(storage.accesses.every((access) => access === "private"), true);
  const nowSeconds = Math.floor(NOW.getTime() / 1_000);
  const [first, second] = await Promise.all([store.consume(code, nowSeconds), store.consume(code, nowSeconds)]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(await store.consume(code, nowSeconds), null);
  assert.equal(await store.health(), true);
  assert.equal(storage.accesses.every((access) => access === "private"), true);
});
