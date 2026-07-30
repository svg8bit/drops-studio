import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function exportedTelegramHandler(fetchImplementation) {
  const exporter = await readFile(
    new URL("../lib/project-export.ts", import.meta.url),
    "utf8",
  );
  const startMarker = "const telegramFunction = `";
  const endMarker = "\n`;\n\nconst publicDataFunction";
  const start = exporter.indexOf(startMarker);
  const end = exporter.indexOf(endMarker, start);
  assert.notEqual(start, -1, "Telegram function marker must exist");
  assert.notEqual(end, -1, "Telegram function closing marker must exist");

  const templateBody = exporter.slice(start + startMarker.length, end);
  assert.doesNotMatch(templateBody, /\$\{/);
  const generatedSource = Function(`return \`${templateBody}\`;`)();
  const executableSource = generatedSource.replace(
    "export default async function handler",
    "async function handler",
  );
  return Function(
    "fetch",
    "crypto",
    `${executableSource}\nreturn handler;`,
  )(fetchImplementation, globalThis.crypto);
}

function recorder() {
  const record = { status: null, body: null, headers: new Map() };
  const response = {
    setHeader(name, value) {
      record.headers.set(String(name).toLowerCase(), String(value));
      return response;
    },
    status(status) {
      record.status = status;
      return response;
    },
    json(body) {
      record.body = body;
      return response;
    },
    end() {
      return response;
    },
  };
  return { record, response };
}

function request() {
  return {
    method: "POST",
    headers: {
      host: "drops.example",
      origin: "https://drops.example",
      "sec-fetch-site": "same-origin",
      "x-drops-session": "11111111-1111-4111-8111-111111111111",
      "x-forwarded-proto": "https",
    },
    body: {
      token: `123456789:${"A".repeat(35)}`,
      channel: "@alpha_test",
      message: "Receipt boundary test",
      sendTest: true,
    },
  };
}

function telegramFetch(sendResult) {
  const providerResults = [
    { id: 42, username: "drops_test_bot" },
    { id: -1001234567890, title: "Alpha Test", username: "alpha_test" },
    { status: "administrator", can_post_messages: true },
    sendResult,
  ];
  let calls = 0;
  const fetchImplementation = async () => {
    const result = providerResults[calls];
    calls += 1;
    return Response.json({ ok: true, result });
  };
  return { fetchImplementation, calls: () => calls };
}

test("exported Telegram send fails closed without a positive integer message_id", async (t) => {
  for (const invalidReceipt of [
    {},
    { message_id: 0 },
    { message_id: -1 },
    { message_id: 1.5 },
    { message_id: "77" },
  ]) {
    await t.test(JSON.stringify(invalidReceipt), async () => {
      const provider = telegramFetch(invalidReceipt);
      const handler = await exportedTelegramHandler(provider.fetchImplementation);
      const { record, response } = recorder();

      await handler(request(), response);

      assert.equal(provider.calls(), 4);
      assert.equal(record.status, 422);
      assert.equal(record.body?.sent, undefined);
      assert.equal(record.body?.messageId, undefined);
      assert.equal(record.headers.get("cache-control"), "no-store");
    });
  }
});

test("exported Telegram send returns the verified positive messageId", async () => {
  const provider = telegramFetch({ message_id: 77 });
  const handler = await exportedTelegramHandler(provider.fetchImplementation);
  const { record, response } = recorder();

  await handler(request(), response);

  assert.equal(provider.calls(), 4);
  assert.equal(record.status, 200);
  assert.equal(record.body?.verified, true);
  assert.equal(record.body?.sent, true);
  assert.equal(record.body?.messageId, 77);
  assert.equal(record.headers.get("cache-control"), "no-store");
});
