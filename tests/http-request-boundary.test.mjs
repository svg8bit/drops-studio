import assert from "node:assert/strict";
import test from "node:test";

const boundary = await import("../lib/http-request-boundary.ts");

test("accepts only the application/json media-type essence", () => {
  const request = (contentType) => new Request("https://drops.example/api", {
    headers: { "content-type": contentType },
  });

  assert.equal(boundary.hasJsonMediaType(request("application/json")), true);
  assert.equal(
    boundary.hasJsonMediaType(request("Application/JSON; charset=utf-8")),
    true,
  );
  assert.equal(boundary.hasJsonMediaType(request("application/jsonp")), false);
  assert.equal(boundary.hasJsonMediaType(request("application/json-patch+json")), false);
  assert.equal(boundary.hasJsonMediaType(new Request("https://drops.example/api")), false);
});

test("cancels a chunked request stream as soon as the byte cap is crossed", async () => {
  let index = 0;
  let cancelled = false;
  const chunks = [
    new TextEncoder().encode("1234"),
    new TextEncoder().encode("5678"),
    new TextEncoder().encode("never-read"),
  ];
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(chunks[index]);
      index += 1;
      if (index === chunks.length) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://drops.example/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });

  await assert.rejects(
    () => boundary.readBoundedRequestBody(request, 6),
    (error) => {
      assert.equal(error.name, "RequestBodyBoundaryError");
      assert.equal(error.reason, "too-large");
      return true;
    },
  );
  assert.equal(cancelled, true);
  assert.equal(index, 2);
});

test("rejects invalid or oversized Content-Length before consuming a body", async () => {
  for (const [contentLength, reason] of [
    ["not-a-number", "invalid-length"],
    ["9007199254740992", "too-large"],
    ["9", "too-large"],
  ]) {
    const request = new Request("https://drops.example/api", {
      method: "POST",
      headers: { "content-length": contentLength },
      body: "{}",
    });
    await assert.rejects(
      () => boundary.readBoundedRequestBody(request, 8),
      (error) => error.reason === reason,
    );
  }
});
