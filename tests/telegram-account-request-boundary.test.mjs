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

const routes = await Promise.all([
  ["send-code", await import("../app/api/telegram/account/send-code/route.ts")],
  ["sign-in", await import("../app/api/telegram/account/sign-in/route.ts")],
  ["status", await import("../app/api/telegram/account/status/route.ts")],
  ["create-channel", await import("../app/api/telegram/account/create-channel/route.ts")],
]);

const BODY_LIMIT_BYTES = 16 * 1024;
const SECRET_MARKER = "must-not-appear-in-response";

function request(path, { body = `{\"secret\":\"${SECRET_MARKER}\"}`, headers = {} } = {}) {
  return new NextRequest(`https://drops.example/api/telegram/account/${path}`, {
    method: "POST",
    headers,
    body,
  });
}

async function assertProtectedResponse(response, expectedStatus) {
  const payload = await response.json();
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(SECRET_MARKER, "i"));
}

test("Telegram account mutations reject cross-site and originless requests before parsing", async (t) => {
  for (const [path, route] of routes) {
    await t.test(`${path} rejects a cross-site request`, async () => {
      const response = await route.POST(request(path, {
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      }));
      await assertProtectedResponse(response, 403);
    });

    await t.test(`${path} requires an explicit same-origin Origin`, async () => {
      const response = await route.POST(request(path, {
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
      }));
      await assertProtectedResponse(response, 403);
    });
  }
});

test("Telegram account mutations require an exact application/json media type", async (t) => {
  for (const contentType of ["text/plain", "application/jsonp"]) {
    for (const [path, route] of routes) {
      await t.test(`${path} rejects ${contentType}`, async () => {
        const response = await route.POST(request(path, {
          headers: {
            "content-type": contentType,
            origin: "https://drops.example",
            "sec-fetch-site": "same-origin",
          },
        }));
        await assertProtectedResponse(response, 415);
      });
    }
  }
});

test("Telegram account mutations reject declared and streamed oversized bodies", async (t) => {
  const oversizedBody = JSON.stringify({
    secret: SECRET_MARKER,
    padding: "x".repeat(BODY_LIMIT_BYTES),
  });

  for (const [path, route] of routes) {
    await t.test(`${path} rejects an oversized Content-Length`, async () => {
      const response = await route.POST(request(path, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(BODY_LIMIT_BYTES + 1),
          origin: "https://drops.example",
          "sec-fetch-site": "same-origin",
        },
      }));
      await assertProtectedResponse(response, 413);
    });

    await t.test(`${path} bounds the raw body when Content-Length is absent`, async () => {
      const response = await route.POST(request(path, {
        body: oversizedBody,
        headers: {
          "content-type": "application/json; charset=utf-8",
          origin: "https://drops.example",
          "sec-fetch-site": "same-origin",
        },
      }));
      await assertProtectedResponse(response, 413);
    });
  }
});

test("Telegram account status preserves its valid same-origin JSON behavior", async () => {
  const [, statusRoute] = routes.find(([path]) => path === "status");
  const response = await statusRoute.POST(request("status", {
    body: "{}",
    headers: {
      "content-type": "application/json; charset=utf-8",
      origin: "https://drops.example",
      "sec-fetch-site": "same-origin",
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connected: false });
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
});
