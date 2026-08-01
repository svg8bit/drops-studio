import assert from "node:assert/strict";
import test from "node:test";

import {
  forgetStudioConnection,
  migrateSessionConnectionsToAccount,
  preferredRememberedModelProvider,
  readStudioAccountSnapshot,
  StudioAccountSnapshotError,
} from "../lib/studio-account-connections-client.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("account hydration checks HTTP status and retries only transient failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "temporary" }, 503);
      return jsonResponse({
        authenticated: true,
        profile: { provider: "google", name: "Fixture member" },
        connections: [{
          provider: "openrouter",
          connected: true,
          model: "openrouter/free",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
        vault: { available: true },
      });
    };
    const snapshot = await readStudioAccountSnapshot({
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    assert.equal(calls, 2);
    assert.equal(snapshot.authenticated, true);
    assert.equal(snapshot.connections[0]?.provider, "openrouter");
    assert.equal(snapshot.connections[0]?.updatedAt, "2026-08-01T00:00:00.000Z");

    calls = 0;
    globalThis.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      calls += 1;
      return jsonResponse({ error: "Sign in required." }, 401);
    };
    await assert.rejects(
      () => readStudioAccountSnapshot({ maxAttempts: 3, retryDelayMs: 0 }),
      (error) => {
        assert.ok(error instanceof StudioAccountSnapshotError);
        assert.equal(error.status, 401);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session migration clears only confirmed writes and remains retryable after a partial failure", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    "drops-studio:openai": "openai-session-fixture",
    "drops-studio:openai:model": "gpt-fixture",
    "drops-studio:anthropic": "anthropic-session-fixture",
  });
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      calls += 1;
      const input = JSON.parse(init.body);
      if (input.provider === "openai") {
        return jsonResponse({
          saved: true,
          connections: [{
            provider: "openai",
            connected: true,
            model: "gpt-fixture",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        });
      }
      return jsonResponse({ error: "Invalid fixture credential." }, 400);
    };
    const migration = await migrateSessionConnectionsToAccount({
      snapshot: {
        authenticated: true,
        profile: { provider: "google", name: "Fixture member" },
        connections: [],
        vaultAvailable: true,
      },
      storage,
      requestOptions: { maxAttempts: 3, retryDelayMs: 0 },
    });
    assert.equal(calls, 2);
    assert.deepEqual(migration.migrated, ["openai"]);
    assert.equal(migration.complete, false);
    assert.equal(storage.getItem("drops-studio:openai"), null);
    assert.equal(storage.getItem("drops-studio:openai:model"), null);
    assert.equal(storage.getItem("drops-studio:anthropic"), "anthropic-session-fixture");
    assert.equal(migration.snapshot.connections[0]?.provider, "openai");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saved model preference uses the current connected provider or the newest remembered provider", () => {
  const connections = [
    {
      provider: "anthropic",
      connected: true,
      updatedAt: "2026-07-31T23:00:00.000Z",
    },
    {
      provider: "openrouter",
      connected: true,
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  assert.equal(preferredRememberedModelProvider(connections, "free"), "openrouter");
  assert.equal(preferredRememberedModelProvider(connections, "anthropic"), "anthropic");
});

test("failed account disconnect does not report optimistic success", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      calls += 1;
      return jsonResponse({ error: "Vault busy." }, 503);
    };
    const result = await forgetStudioConnection("telegram", {
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    assert.equal(calls, 2);
    assert.equal(result.deleted, false);
    assert.equal(result.retryable, true);
    assert.equal(result.error, "Vault busy.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
