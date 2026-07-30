import assert from "node:assert/strict";
import test from "node:test";

import { addProjectArtifactCspMeta } from "../lib/artifact-csp.ts";

test("artifact CSP insertion honors quoted greater-than characters in opening tags", () => {
  const withHead = addProjectArtifactCspMeta(
    '<!doctype html><html data-root="keep>root"><head data-head="keep>head"><title>Safe</title></head><body></body></html>',
  );
  assert.match(
    withHead,
    /<head data-head="keep>head"><meta http-equiv="Content-Security-Policy"/,
  );
  assert.equal(withHead.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);

  const withoutHead = addProjectArtifactCspMeta(
    '<!doctype html><html data-root="keep>root"><body>Safe</body></html>',
  );
  assert.match(
    withoutHead,
    /<html data-root="keep>root"><head><meta http-equiv="Content-Security-Policy"/,
  );
  assert.equal(withoutHead.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
});
