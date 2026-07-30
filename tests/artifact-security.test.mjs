import assert from "node:assert/strict";
import test from "node:test";
import { strToU8 } from "fflate";

import {
  ArtifactSecretError,
  assertArtifactFilesSafe,
  assertProjectPayloadSafe,
  assertPublishedArtifactSafe,
  findArtifactSecrets,
} from "../lib/artifact-security.ts";

const secretFixtures = [
  ["telegram", "123456789:AAE9Qqkx4JmU3Rr6Tt8Vv0Xx2Zz4Bb6Cc8"],
  ["jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImFkbWluIn0.sQ8OD8r2hVdRa6QbRzF0c3kF0d1p8G9mN4xE7qJ5vT0"],
  ["github", "github_pat_11AA0BBBB0cccccDDDDD0_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
  ["aws", "AKIAIOSFODNN7EXAMPLE"],
  ["ai", "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"],
  ["generic", "api_key=private_live_key_0123456789abcdef"],
];

test("recognises the release-blocking secret families", () => {
  for (const [label, secret] of secretFixtures) {
    const findings = findArtifactSecrets(secret, `fixture/${label}.txt`);
    assert.ok(findings.length > 0, `${label} fixture must be detected`);
    assert.equal(findings[0].location, `fixture/${label}.txt`);
    assert.doesNotMatch(findings[0].preview, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("scans every archive entry, including an entry with a binary extension", () => {
  for (const [label, secret] of secretFixtures) {
    const location = `assets/${label}.bin`;
    const files = {
      "index.html": strToU8("<h1>safe</h1>"),
      [location]: strToU8(`prefix ${secret} suffix`),
    };
    assert.throws(
      () => assertArtifactFilesSafe(files),
      (error) => error instanceof ArtifactSecretError && error.locations.includes(location),
      `${label} must be blocked even when hidden in a binary-named ZIP entry`,
    );
  }
});

test("blocks every secret fixture from the complete published spec and HTML artifact", () => {
  for (const [label, secret] of secretFixtures) {
    assert.throws(
      () => assertPublishedArtifactSafe({ prompt: "safe", values: { nested: secret } }, "<html>safe</html>"),
      ArtifactSecretError,
      `${label} must be rejected from a published spec`,
    );
    assert.throws(
      () => assertPublishedArtifactSafe({ prompt: "safe" }, `<html data-fixture="${secret}">safe</html>`),
      ArtifactSecretError,
      `${label} must be rejected from published HTML`,
    );
  }
});

test("rejects secrets anywhere in the full prompt/spec values before publish", () => {
  assert.throws(
    () => assertProjectPayloadSafe({ prompt: "build", values: { nested: { token: secretFixtures[2][1] } } }),
    ArtifactSecretError,
  );
  assert.doesNotThrow(() => assertProjectPayloadSafe({ prompt: "Connect my own API key in the session-only vault", values: { source: "DropsTab" } }));
});
