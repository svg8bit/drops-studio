import assert from "node:assert/strict";
import test from "node:test";

test("Google OIDC transaction is signed, bounded and preserves only safe local return paths", async () => {
  const oidc = await import("../lib/google-oidc.ts");
  const secret = "signed-cookie-secret-fixture-with-more-than-32-bytes";
  const transaction = oidc.createGoogleOidcTransaction("/studio/project-fixture?panel=director");
  const serialized = oidc.serializeGoogleOidcTransaction(transaction, secret);
  const parsed = oidc.readGoogleOidcTransaction(serialized, secret, transaction.createdAt + 30);

  assert.deepEqual(parsed, transaction);
  assert.equal(
    oidc.createGoogleOidcTransaction("https://attacker.example/path").returnTo,
    "/",
  );
  assert.equal(oidc.createGoogleOidcTransaction("//attacker.example/path").returnTo, "/");
  assert.equal(oidc.createGoogleOidcTransaction("/\\attacker.example/path").returnTo, "/");
  assert.equal(oidc.createGoogleOidcTransaction("///attacker.example/path").returnTo, "/");
  assert.equal(oidc.readGoogleOidcTransaction(`${serialized}tampered`, secret), null);
  assert.equal(
    oidc.readGoogleOidcTransaction(
      serialized,
      secret,
      transaction.createdAt + oidc.GOOGLE_OIDC_TRANSACTION_TTL_SECONDS + 1,
    ),
    null,
  );
});

test("same-origin return paths are normalized against the active application origin", async () => {
  const { safeSameOriginReturnPath } = await import("../lib/safe-return-to.ts");
  const origin = "https://drops.example.test";

  assert.equal(
    safeSameOriginReturnPath("/studio/project?panel=director#build", origin),
    "/studio/project?panel=director#build",
  );
  assert.equal(safeSameOriginReturnPath("https://attacker.example", origin), "/");
  assert.equal(safeSameOriginReturnPath("/\\attacker.example", origin), "/");
  assert.equal(safeSameOriginReturnPath("//attacker.example", origin), "/");
  assert.equal(safeSameOriginReturnPath("\n/studio/project", origin, ""), "");
});

test("Google authorization URL uses OIDC, nonce and PKCE without exposing the client secret", async () => {
  const oidc = await import("../lib/google-oidc.ts");
  const transaction = oidc.createGoogleOidcTransaction("/");
  const url = oidc.googleAuthorizationUrl({
    clientId: "google-client-id-fixture",
    redirectUri: "https://drops.example.test/api/auth/google/callback",
    transaction,
  });

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), transaction.state);
  assert.equal(url.searchParams.get("nonce"), transaction.nonce);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok((url.searchParams.get("code_challenge") ?? "").length >= 43);
  assert.equal(url.toString().includes("client_secret"), false);
});
