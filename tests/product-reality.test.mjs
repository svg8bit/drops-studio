import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { POST as verifyTelegram } from "../app/api/telegram/verify/route.ts";
import { PRODUCT_REALITY, truthfulnessViolations } from "../lib/product-reality.ts";

const presetIds = [
  "action-engine",
  "alpha-channel",
  "morning-alpha",
  "prediction-impact",
  "smart-money-copy",
  "crypto-aggregator",
  "crypto-game",
  "personal-companion",
  "portfolio-tamagotchi",
  "crypto-product-hunt",
  "crypto-radio",
  "crypto-siri",
];

test("every preset declares an honest delivery contract", () => {
  for (const id of presetIds) {
    const contract = PRODUCT_REALITY[id];
    assert.ok(contract, id);
    assert.ok(contract.deliverable.length > 20, id);
    assert.ok(contract.worksNow.length > 0, id);
    assert.ok(contract.requires.length > 0, id);
    assert.ok(contract.forbiddenClaims.length > 0, id);
  }
  assert.deepEqual(new Set(Object.values(PRODUCT_REALITY).map((item) => item.deliveryMode)), new Set(["web-native", "connection-required", "research-only"]));
});

test("every contract-defined forbidden claim is rejected at runtime", () => {
  for (const id of presetIds) {
    assert.deepEqual(truthfulnessViolations(id, "<main>Honest product state</main>"), [], `${id} clean state`);
    for (const claim of PRODUCT_REALITY[id].forbiddenClaims) {
      assert.ok(truthfulnessViolations(id, `<main>${claim}</main>`).length > 0, `${id}: ${claim}`);
    }
  }
  assert.ok(truthfulnessViolations("smart-money-copy", "<p>Position opened</p>").length > 0);
});

test("generated products do not claim outcomes they cannot verify", async () => {
  const [compiler, blueprint, presets, publicData, validator, builder] = await Promise.all([
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-blueprint.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/presets.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-validator.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/drops-studio.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [compiler, blueprint, presets]) {
    assert.doesNotMatch(source, /already on air/i);
    assert.doesNotMatch(source, /10,842 subscribers/i);
  }
  assert.doesNotMatch(compiler, /\$32\.4M|\$18\.7M/);
  assert.doesNotMatch(compiler, /🔥 128|NOVA.{0,80}12,840|Signal Garden|Wallet Lens|Token Kitchen/s);
  assert.doesNotMatch(publicData, /marketCap: "\$2\.35T"|marketCap: "\$463B"|marketCap: "\$91\.7B"/);
  assert.match(compiler, /PREVIEW · NOT PUBLISHED/);
  assert.match(compiler, /LOCAL SCORE/);
  assert.match(compiler, /LOCAL DRAFT/);
  assert.match(compiler, /Research mode/);
  assert.match(presets, /verify delivery to an existing channel/i);
  assert.match(presets, /private launch research board/i);
  assert.match(presets, /paper scenario/i);
  assert.match(compiler, /function available\(value\)/);
  assert.match(validator, /change: null/);
  assert.match(builder, /probability: null/);
  assert.doesNotMatch(builder, /probability: 0/);
});

test("Telegram delivery verifies permissions, sends, and rejects a non-admin", async (context) => {
  const [compiler, route] = await Promise.all([
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/verify/route.ts", import.meta.url), "utf8"),
  ]);
  const originalFetch = globalThis.fetch;
  const calls = [];
  let membership = { status: "administrator", can_post_messages: true };
  globalThis.fetch = async (input, init = {}) => {
    const method = new URL(String(input)).pathname.split("/").pop();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, body });
    const result = method === "getMe"
      ? { id: 42, username: "drops_studio_test_bot" }
      : method === "getChat"
        ? { id: -1001234567890, title: "Alpha Test", username: "alpha_test" }
        : method === "getChatMember"
          ? membership
          : method === "sendMessage"
            ? { message_id: 77 }
            : null;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const token = `123456789:${"A".repeat(35)}`;
  const success = await verifyTelegram(new NextRequest("http://localhost/api/telegram/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-drops-session": "11111111-1111-4111-8111-111111111111" },
    body: JSON.stringify({ token, channel: "@alpha_test", message: "Verified test", sendTest: true }),
  }));
  assert.equal(success.status, 200);
  assert.deepEqual(calls.slice(0, 4).map((item) => item.method), ["getMe", "getChat", "getChatMember", "sendMessage"]);
  assert.deepEqual(calls[3].body, { chat_id: -1001234567890, text: "Verified test", disable_web_page_preview: false });
  assert.deepEqual(await success.json(), {
    verified: true,
    sent: true,
    bot: { username: "drops_studio_test_bot" },
    channel: { id: "-1001234567890", title: "Alpha Test", username: "@alpha_test" },
    messageId: 77,
    storage: "session-only",
  });

  membership = { status: "member", can_post_messages: false };
  const denied = await verifyTelegram(new NextRequest("http://localhost/api/telegram/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-drops-session": "22222222-2222-4222-8222-222222222222" },
    body: JSON.stringify({ token, channel: "@alpha_test", message: "Do not send", sendTest: true }),
  }));
  assert.equal(denied.status, 409);
  assert.match((await denied.json()).error, /not a channel administrator/i);
  assert.equal(calls.filter((item) => item.method === "sendMessage").length, 1);

  assert.match(compiler, /telegram\/verify/);
  assert.match(compiler, /new URL\("\/api\/telegram\/verify",location\.origin\)/);
  assert.doesNotMatch(compiler, /platform\.pathname="\/api\/telegram\/verify"/);
  assert.match(compiler, /BotFather token/);
  assert.match(compiler, /Send verified test post/);
  assert.match(compiler, /session-only/i);
  assert.match(compiler, /telegramPending/);
  assert.match(route, /rightmostTrustedAddress/);
  assert.match(route, /ifMatch: current\.blob\.etag/);
  assert.match(route, /const signal = AbortSignal\.timeout\(8_000\)/);
});

test("release UI distinguishes a published web app from a connected external outcome", async () => {
  const [types, quality, studio] = await Promise.all([
    readFile(new URL("../lib/project-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-quality.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/project-studio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(types, /ProjectLaunchStatus/);
  assert.match(types, /deliveryMode/);
  assert.match(quality, /truthfulness/);
  assert.match(quality, /launchStatusFor/);
  assert.match(studio, /External setup required/);
  assert.match(studio, /Setup app published/);
  assert.doesNotMatch(studio, /> Product running</);
});
