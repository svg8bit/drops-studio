import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const {
  normalizeProviderModelCatalog,
  normalizeProviderModelPayload,
  providerModelCatalogStorageKey,
} = await import("../lib/provider-models.ts");
const { POST: testProviderConnection } = await import(
  "../app/api/connections/test/route.ts"
);

test("provider model payloads are sanitized, deduplicated and deterministic", () => {
  const catalog = normalizeProviderModelPayload({
    data: [
      { id: "zeta/model" },
      { id: " alpha/model " },
      { id: "alpha/model" },
      { id: "bad\nmodel" },
      { id: "" },
      null,
    ],
  });

  assert.deepEqual(catalog, {
    models: ["alpha/model", "zeta/model"],
    totalModelCount: 2,
    modelsTruncated: false,
  });
});

test("provider model payloads report bounded responses honestly", () => {
  const catalog = normalizeProviderModelPayload(
    { models: ["model-c", "model-a", "model-b"] },
    2,
  );

  assert.deepEqual(catalog, {
    models: ["model-a", "model-b"],
    totalModelCount: 3,
    modelsTruncated: true,
  });
});

test("session catalogs preserve only sanitized model metadata", () => {
  const catalog = normalizeProviderModelCatalog(
    {
      models: ["openrouter/free", "openrouter/free", "vendor/model"],
      totalModelCount: 7,
      modelsTruncated: true,
      verifiedAt: "2026-07-30T12:00:00.000Z",
      key: "must-not-be-retained",
    },
    "fallback",
  );

  assert.deepEqual(catalog, {
    models: ["openrouter/free", "vendor/model"],
    totalModelCount: 7,
    modelsTruncated: true,
    verifiedAt: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(
    providerModelCatalogStorageKey("openrouter"),
    "drops-studio:openrouter:models",
  );
  assert.equal(normalizeProviderModelCatalog({ nope: true }), null);
});

test("connection verification returns a no-store model catalog without echoing the key", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (_url, init) => {
    authorization = String(init?.headers?.authorization ?? "");
    return new Response(
      JSON.stringify({
        data: [{ id: "provider/model-b" }, { id: "provider/model-a" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const response = await testProviderConnection(
      new NextRequest("http://localhost/api/connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", key: "session-secret" }),
      }),
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(authorization, "Bearer session-secret");
    assert.deepEqual(payload.models, ["provider/model-a", "provider/model-b"]);
    assert.equal(payload.totalModelCount, 2);
    assert.equal(JSON.stringify(payload).includes("session-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
