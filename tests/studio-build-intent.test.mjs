import assert from "node:assert/strict";
import test from "node:test";

const {
  consumeStudioBuildIntent,
} = await import("../lib/studio-build-intent.ts");

test("consumes a new-project auto-build marker exactly once", () => {
  const replacements = [];
  const requestId = consumeStudioBuildIntent(
    {
      pathname: "/studio/project-1",
      search: "?panel=director&autobuild=1",
      hash: "#chat",
    },
    (url) => replacements.push(url),
    () => "request-1",
  );

  assert.equal(requestId, "request-1");
  assert.deepEqual(replacements, ["/studio/project-1?panel=director#chat"]);

  const reopened = consumeStudioBuildIntent(
    {
      pathname: "/studio/project-1",
      search: "?panel=director",
    },
    () => assert.fail("ordinary reopen must not mutate the URL"),
    () => assert.fail("ordinary reopen must not create a build request"),
  );
  assert.equal(reopened, null);
});

test("preserves an explicit idempotency request while removing build markers", () => {
  let replacement = "";
  const requestId = consumeStudioBuildIntent(
    {
      pathname: "/studio/project-2",
      search: "?autobuild=1&buildRequest=stable-request&panel=code",
    },
    (url) => {
      replacement = url;
    },
    () => assert.fail("explicit request id should be reused"),
  );

  assert.equal(requestId, "stable-request");
  assert.equal(replacement, "/studio/project-2?panel=code");
});
