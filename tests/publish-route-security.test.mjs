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

const publishRoute = await import("../app/api/projects/publish/route.ts");

const TEST_SECRET = "publish-route-security-secret-that-is-longer-than-32-bytes";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const handlers = {
  POST: publishRoute.POST,
  PUT: publishRoute.PUT,
  DELETE: publishRoute.DELETE,
};

async function withLocalPublish(run) {
  const previous = {
    localStore: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE,
    publishSecret: process.env.DROPS_PUBLISH_CAPABILITY_SECRET,
    vercel: process.env.VERCEL,
  };
  process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = "1";
  process.env.DROPS_PUBLISH_CAPABILITY_SECRET = TEST_SECRET;
  delete process.env.VERCEL;
  globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = new Map();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();
  try {
    await run();
  } finally {
    globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ = undefined;
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = undefined;
    if (previous.localStore === undefined) delete process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE;
    else process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE = previous.localStore;
    if (previous.publishSecret === undefined) delete process.env.DROPS_PUBLISH_CAPABILITY_SECRET;
    else process.env.DROPS_PUBLISH_CAPABILITY_SECRET = previous.publishSecret;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
  }
}

function request(method, body, headers = {}) {
  return new NextRequest("https://drops.example/api/projects/publish", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://drops.example",
      "sec-fetch-site": "same-origin",
      "x-drops-session": SESSION_ID,
      ...headers,
    },
    body,
  });
}

test("every publish mutation rejects cross-origin and non-JSON requests before parsing", async () => {
  await withLocalPublish(async () => {
    for (const [method, handler] of Object.entries(handlers)) {
      const crossOrigin = await handler(request(method, "{", {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }));
      assert.equal(crossOrigin.status, 403, `${method} must reject cross-origin requests`);

      const nonJson = await handler(request(method, "{", {
        "content-type": "text/plain",
      }));
      assert.equal(nonJson.status, 415, `${method} must require application/json`);
    }
  });
});

test("publish mutations reject declared and streamed oversized bodies before JSON parsing", async () => {
  await withLocalPublish(async () => {
    for (const [method, handler] of Object.entries(handlers)) {
      const declaredOversize = await handler(request(method, "{", {
        "content-length": "2000000",
      }));
      assert.equal(declaredOversize.status, 413, `${method} must enforce Content-Length`);
    }

    const streamedOversize = await publishRoute.POST(
      request("POST", " ".repeat(1_500_000)),
    );
    assert.equal(streamedOversize.status, 413);
  });
});

test("publish mutations consume the request limit before reading malformed JSON", async () => {
  await withLocalPublish(async () => {
    const windowMs = 60 * 60 * 1_000;
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `project-publish:${bucket}:session:${SESSION_ID}`;

    for (const [method, handler] of Object.entries(handlers)) {
      globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map([
        [key, { count: 200, expiresAt: (bucket + 1) * windowMs }],
      ]);
      const response = await handler(request(method, "{"));
      assert.equal(response.status, 429, `${method} must rate-limit before JSON parsing`);
    }
  });
});
