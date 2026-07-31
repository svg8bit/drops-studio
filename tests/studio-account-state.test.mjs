import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const identity = createHash("sha256").update("account-fixture").digest("hex");
const vaultKey = createHash("sha256").update("vault-fixture").digest();

test("account connection vault encrypts credentials with account-bound authenticated data", async () => {
  const vault = await import("../lib/studio-account-state.ts");
  const credential = "provider-key-fixture-not-a-live-secret";
  const encrypted = vault.encryptStudioConnection({
    identity,
    provider: "openai",
    credential,
    model: "gpt-fixture",
    key: vaultKey,
    now: "2026-07-31T00:00:00.000Z",
  });

  assert.equal(encrypted.algorithm, "aes-256-gcm");
  assert.equal(JSON.stringify(encrypted).includes(credential), false);
  assert.equal(vault.decryptStudioConnection({ identity, connection: encrypted, key: vaultKey }), credential);

  await assert.rejects(
    async () => vault.decryptStudioConnection({
      identity: createHash("sha256").update("another-account").digest("hex"),
      connection: encrypted,
      key: vaultKey,
    }),
  );

  await assert.rejects(
    async () => vault.decryptStudioConnection({
      identity,
      connection: { ...encrypted, authTag: encrypted.authTag.replace(/^./, encrypted.authTag[0] === "A" ? "B" : "A") },
      key: vaultKey,
    }),
  );
});
test("account connection metadata is public-safe and the vault fails closed", async () => {
  const vault = await import("../lib/studio-account-state.ts");
  assert.equal(vault.resolveConnectionVaultKey({ DROPS_CONNECTION_VAULT_KEY: "too-short" }), null);
  assert.equal(vault.resolveConnectionVaultKey({ DROPS_CONNECTION_VAULT_KEY: "x".repeat(32) })?.length, 32);
  assert.equal(vault.endpointHost("https://api.example.test/v1"), "api.example.test");
  assert.equal(vault.endpointHost("http://api.example.test/v1"), undefined);
  assert.equal(vault.endpointHost("https://user:pass@example.test/v1"), undefined);

  const connection = vault.encryptStudioConnection({
    identity,
    provider: "custom",
    credential: "another-provider-key-fixture",
    endpoint: "https://models.example.test/v1",
    model: "fixture-model",
    key: vaultKey,
    now: "2026-07-31T00:00:00.000Z",
  });
  const statuses = vault.publicConnectionStatuses({
    schemaVersion: 1,
    revision: 1,
    updatedAt: "2026-07-31T00:00:00.000Z",
    connections: { custom: connection },
  });
  const custom = statuses.find((status) => status.provider === "custom");
  assert.deepEqual(custom, {
    provider: "custom",
    connected: true,
    model: "fixture-model",
    endpointHost: "models.example.test",
    updatedAt: "2026-07-31T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(statuses).includes("another-provider-key-fixture"), false);
});
