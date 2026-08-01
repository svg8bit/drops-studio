import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const identity = createHash("sha256").update("account-fixture").digest("hex");
const vaultKey = createHash("sha256").update("vault-fixture").digest();

function memoryAccountSql() {
  let row = null;
  const statements = [];
  return {
    statements,
    storedJson() {
      return row?.state_json ?? "";
    },
    async query(statement, parameters = []) {
      const normalized = statement.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("CREATE TABLE")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("SELECT state_revision")) {
        return row && row.account_identity === parameters[0]
          ? { rows: [{ ...row }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("INSERT INTO")) {
        if (row) return { rows: [], rowCount: 0 };
        row = {
          account_identity: parameters[0],
          state_revision: parameters[1],
          state_json: parameters[2],
        };
        return {
          rows: [{ state_revision: row.state_revision }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith("UPDATE drops_studio_account_states")) {
        if (
          !row
          || row.account_identity !== parameters[0]
          || row.state_revision !== parameters[3]
        ) {
          return { rows: [], rowCount: 0 };
        }
        row = {
          ...row,
          state_revision: parameters[1],
          state_json: parameters[2],
        };
        return {
          rows: [{ state_revision: row.state_revision }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected account-state SQL: ${normalized}`);
    },
  };
}

function memoryAccountBlob() {
  let body = null;
  let version = 0;
  return {
    async get() {
      if (body === null) return null;
      return {
        statusCode: 200,
        stream: new Blob([body]).stream(),
        blob: { etag: `etag-${version}` },
      };
    },
    async put(_pathname, value, options = {}) {
      if (options.ifMatch && options.ifMatch !== `etag-${version}`) {
        throw new Error("etag mismatch");
      }
      version += 1;
      body = String(value);
      return { etag: `etag-${version}` };
    },
  };
}

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

test("managed Postgres persists every encrypted provider envelope without plaintext credentials", async () => {
  const previousVaultKey = process.env.DROPS_CONNECTION_VAULT_KEY;
  process.env.DROPS_CONNECTION_VAULT_KEY = "account-vault-fixture-key-with-at-least-32-bytes";
  const storage = await import("../db/studio-account-state.ts");
  const sql = memoryAccountSql();
  try {
    await storage.saveStudioConnection(identity, {
      provider: "openrouter",
      credential: "openrouter-provider-key-fixture",
      model: "openrouter/free",
      label: "OpenRouter OAuth",
    }, undefined, sql);
    await storage.saveStudioConnection(identity, {
      provider: "telegram",
      credential: "telegram-account-session-fixture",
      label: "Telegram account session",
      telegramReceipt: {
        accountId: "777000123",
        id: "-1001234567890",
        title: "Fixture Alpha",
        username: "@fixture_alpha",
        url: "https://t.me/fixture_alpha",
        botUsername: "@DropsStudioFixtureBot",
        botAdded: true,
        firstPostSent: true,
        firstPostMessageId: 42,
        dmSent: false,
        dmStartUrl: "https://t.me/DropsStudioFixtureBot?start=drops_studio",
        warnings: [],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    }, undefined, sql);

    const state = await storage.readStudioAccountState(identity, undefined, sql);
    assert.equal(state.revision, 2);
    assert.deepEqual(Object.keys(state.connections).sort(), ["openrouter", "telegram"]);
    assert.doesNotMatch(sql.storedJson(), /openrouter-provider-key-fixture|telegram-account-session-fixture|fixture_alpha/);
    assert.equal(
      (await storage.readStudioConnectionSecret(identity, "openrouter", undefined, sql))?.credential,
      "openrouter-provider-key-fixture",
    );
    const telegram = await storage.readStudioConnectionSecret(identity, "telegram", undefined, sql);
    assert.equal(telegram?.credential, "telegram-account-session-fixture");
    assert.deepEqual(telegram?.telegramReceipt, {
      accountId: "777000123",
      id: "-1001234567890",
      title: "Fixture Alpha",
      username: "@fixture_alpha",
      url: "https://t.me/fixture_alpha",
      botUsername: "@DropsStudioFixtureBot",
      botAdded: true,
      firstPostSent: true,
      firstPostMessageId: 42,
      dmSent: false,
      dmStartUrl: "https://t.me/DropsStudioFixtureBot?start=drops_studio",
      warnings: [],
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    assert.ok(sql.statements.some((statement) => statement.startsWith("UPDATE drops_studio_account_states")));
  } finally {
    if (previousVaultKey === undefined) delete process.env.DROPS_CONNECTION_VAULT_KEY;
    else process.env.DROPS_CONNECTION_VAULT_KEY = previousVaultKey;
  }
});

test("Telegram receipt parsing rejects coerced message ids and malformed account ids", async () => {
  const previousVaultKey = process.env.DROPS_CONNECTION_VAULT_KEY;
  process.env.DROPS_CONNECTION_VAULT_KEY = "receipt-validation-vault-key-with-at-least-32-bytes";
  const storage = await import("../db/studio-account-state.ts");
  const sql = memoryAccountSql();
  const receipt = {
    accountId: "777000123",
    id: "-1001234567890",
    title: "Fixture Alpha",
    username: "@fixture_alpha",
    url: "https://t.me/fixture_alpha",
    botUsername: "@DropsStudioFixtureBot",
    botAdded: true,
    firstPostSent: true,
    firstPostMessageId: 42,
    dmSent: false,
    dmStartUrl: "https://t.me/DropsStudioFixtureBot?start=drops_studio",
    warnings: [],
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  try {
    for (const invalid of ["42", true]) {
      await assert.rejects(
        storage.saveStudioConnection(identity, {
          provider: "telegram",
          credential: "telegram-account-session-fixture",
          telegramReceipt: { ...receipt, firstPostMessageId: invalid },
        }, undefined, sql),
        /receipt is invalid/i,
      );
    }
    await assert.rejects(
      storage.saveStudioConnection(identity, {
        provider: "telegram",
        credential: "telegram-account-session-fixture",
        telegramReceipt: { ...receipt, accountId: "not-an-account" },
      }, undefined, sql),
      /receipt is invalid/i,
    );
  } finally {
    if (previousVaultKey === undefined) delete process.env.DROPS_CONNECTION_VAULT_KEY;
    else process.env.DROPS_CONNECTION_VAULT_KEY = previousVaultKey;
  }
});

test("managed Postgres reads through and migrates the existing private Blob envelope", async () => {
  const previousVaultKey = process.env.DROPS_CONNECTION_VAULT_KEY;
  process.env.DROPS_CONNECTION_VAULT_KEY = "blob-migration-vault-fixture-with-at-least-32-bytes";
  const storage = await import("../db/studio-account-state.ts");
  const blob = memoryAccountBlob();
  const sql = memoryAccountSql();
  try {
    await storage.saveStudioConnection(identity, {
      provider: "anthropic",
      credential: "anthropic-provider-key-fixture",
      model: "claude-fixture",
    }, blob);

    const migrated = await storage.readStudioAccountState(identity, blob, sql);
    assert.equal(migrated.revision, 1);
    assert.equal(migrated.connections.anthropic?.model, "claude-fixture");
    assert.equal(
      (await storage.readStudioConnectionSecret(identity, "anthropic", blob, sql))?.credential,
      "anthropic-provider-key-fixture",
    );
    assert.ok(sql.statements.some((statement) => statement.startsWith("INSERT INTO")));
    assert.doesNotMatch(sql.storedJson(), /anthropic-provider-key-fixture/);
  } finally {
    if (previousVaultKey === undefined) delete process.env.DROPS_CONNECTION_VAULT_KEY;
    else process.env.DROPS_CONNECTION_VAULT_KEY = previousVaultKey;
  }
});
