import assert from "node:assert/strict";
import test from "node:test";

const {
  clearStudioBuildIntent,
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
  assert.deepEqual(replacements, [
    "/studio/project-1?panel=director&autobuild=1&buildRequest=request-1#chat",
  ]);

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

test("preserves an explicit idempotency request until a terminal receipt", () => {
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
  assert.equal(replacement, "");
});

test("clears only the matching terminal build request", () => {
  let replacement = "";
  const cleared = clearStudioBuildIntent(
    {
      pathname: "/studio/project-2",
      search: "?autobuild=1&buildRequest=stable-request&panel=code",
      hash: "#files",
    },
    "stable-request",
    (url) => {
      replacement = url;
    },
  );
  assert.equal(cleared, true);
  assert.equal(replacement, "/studio/project-2?panel=code#files");

  assert.equal(
    clearStudioBuildIntent(
      {
        pathname: "/studio/project-2",
        search: "?autobuild=1&buildRequest=newer-request",
      },
      "stable-request",
      () => assert.fail("a stale completion must not clear a newer request"),
    ),
    false,
  );
});
