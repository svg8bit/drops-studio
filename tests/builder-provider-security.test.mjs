import assert from "node:assert/strict";
import test from "node:test";

const {
  BuilderModelUnavailableError,
  createPinnedCustomProviderFetch,
  resolveCustomProviderEndpoint,
} = await import("../lib/builder-agent/providers.ts");

test("custom provider endpoints reject credentials, IP literals, and private DNS answers", async () => {
  const cases = [
    "http://provider.example/v1",
    "https://user:password@provider.example/v1",
    "https://127.0.0.1/v1",
    "https://provider.local/v1",
    "https://provider.example/v1?token=value",
  ];
  for (const value of cases) {
    await assert.rejects(
      resolveCustomProviderEndpoint(value, async () => [{ address: "8.8.8.8", family: 4 }]),
      BuilderModelUnavailableError,
    );
  }
  await assert.rejects(
    resolveCustomProviderEndpoint(
      "https://provider.example/v1",
      async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    ),
    /private network/i,
  );
});

test("custom provider transport pins validated public addresses and refuses endpoint escapes", async () => {
  const endpoint = await resolveCustomProviderEndpoint(
    "https://provider.example/v1",
    async () => [{ address: "8.8.8.8", family: 4 }],
  );
  assert.deepEqual(endpoint, {
    baseURL: "https://provider.example/v1",
    hostname: "provider.example",
    addresses: [{ address: "8.8.8.8", family: 4 }],
  });
  const pinnedFetch = createPinnedCustomProviderFetch(endpoint);
  await assert.rejects(
    pinnedFetch("https://evil.example/v1/chat/completions"),
    /outside its validated HTTPS endpoint/i,
  );
  await assert.rejects(
    pinnedFetch("https://provider.example/other"),
    /outside its validated HTTPS endpoint/i,
  );
});
