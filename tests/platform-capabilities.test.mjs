import assert from "node:assert/strict";
import test from "node:test";

import { platformCapabilitySnapshot } from "../lib/platform-capabilities.ts";

test("capability snapshot never upgrades reference adapters to production", () => {
  const snapshot = platformCapabilitySnapshot({ VERCEL_ENV: "production" }, new Date("2026-07-30T12:00:00.000Z"));
  assert.equal(snapshot.environment, "production");
  assert.equal(snapshot.capabilities.find((item) => item.id === "managed-backend")?.state, "working-local-test");
  assert.equal(snapshot.capabilities.find((item) => item.id === "collaboration")?.state, "working-local-test");
  assert.equal(snapshot.capabilities.find((item) => item.id === "enterprise-identity")?.state, "working-local-test");
  assert.equal(snapshot.capabilities.find((item) => item.id === "sandbox")?.state, "setup-required");
});

test("server configuration markers never become working without provider health evidence", () => {
  const secret = "this-value-must-never-be-returned";
  const snapshot = platformCapabilitySnapshot({
    VERCEL_ENV: "preview",
    VERCEL_OIDC_TOKEN: secret,
    BLOB_STORE_ID: "store-id",
    PROJECT_DATA_CAPABILITY_SECRET: secret,
    DROPS_TEAM_INVITE_SECRET: secret,
    VERCEL_DEPLOY_TOKEN: secret,
    VERCEL_GENERATED_PROJECT_ID: "project-id",
  }, new Date("2026-07-30T12:00:00.000Z"));
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.capabilities.find((item) => item.id === "sandbox")?.state, "unavailable");
  assert.equal(snapshot.capabilities.find((item) => item.id === "project-data")?.state, "unavailable");
  assert.equal(snapshot.capabilities.find((item) => item.id === "organizations")?.state, "unavailable");
  assert.equal(snapshot.capabilities.find((item) => item.id === "deployment")?.state, "unavailable");
  assert.doesNotMatch(serialized, new RegExp(secret));
});

test("explicit non-production project-data proof mode remains local-test only", () => {
  const snapshot = platformCapabilitySnapshot({
    VERCEL_ENV: "development",
    DROPS_STUDIO_LOCAL_PROJECT_DATA: "1",
  }, new Date("2026-07-30T12:00:00.000Z"), {
    schemaVersion: 1,
    environment: "development",
    checkedAt: "2026-07-30T11:59:00.000Z",
    expiresAt: "2026-07-31T11:59:00.000Z",
    checks: {
      "project-data": {
        status: "working",
        mode: "transactional-neon-postgres",
        detail: "A durable provider receipt must not relabel explicit local proof mode.",
        evidence: ["durable-provider-receipt"],
      },
    },
  });
  const projectData = snapshot.capabilities.find((item) => item.id === "project-data");
  assert.equal(projectData?.state, "working-local-test");
  assert.equal(projectData?.mode, "process-memory-local-test");
  assert.deepEqual(projectData?.evidence, ["explicit-local-test-flag"]);
});

test("fresh production provider receipts upgrade only the matching capabilities", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const snapshot = platformCapabilitySnapshot({
    VERCEL_ENV: "production",
    DROPS_MANAGED_DATA_PROVIDER: "postgres",
    DROPS_MANAGED_DATABASE_URL: "postgresql://configured-without-being-returned",
    PROJECT_DATA_CAPABILITY_SECRET: "configured-without-being-returned",
  }, now, {
    schemaVersion: 1,
    environment: "production",
    checkedAt: "2026-07-31T11:59:00.000Z",
    expiresAt: "2026-08-01T23:59:00.000Z",
    checks: {
      "project-data": {
        status: "working",
        mode: "transactional-neon-postgres",
        detail: "Live create, update, read and cleanup passed.",
        evidence: ["project-data-cas-live"],
      },
    },
  });

  assert.equal(
    snapshot.capabilities.find((item) => item.id === "project-data")?.state,
    "working",
  );
  assert.equal(
    snapshot.capabilities.find((item) => item.id === "sandbox")?.state,
    "setup-required",
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /postgresql:\/\//);
});

test("expired or cross-environment health receipts never activate production", () => {
  const environment = {
    VERCEL_ENV: "production",
    VERCEL_OIDC_TOKEN: "configured-without-being-returned",
  };
  const check = {
    status: "working",
    mode: "vercel-sandbox-node24-live",
    detail: "Live Sandbox check passed.",
    evidence: ["sandbox-create-live"],
  };
  const expired = platformCapabilitySnapshot(environment, new Date("2026-07-31T12:00:00.000Z"), {
    schemaVersion: 1,
    environment: "production",
    checkedAt: "2026-07-30T10:00:00.000Z",
    expiresAt: "2026-07-31T10:00:00.000Z",
    checks: { sandbox: check },
  });
  const preview = platformCapabilitySnapshot(environment, new Date("2026-07-31T12:00:00.000Z"), {
    schemaVersion: 1,
    environment: "preview",
    checkedAt: "2026-07-31T10:00:00.000Z",
    expiresAt: "2026-08-01T10:00:00.000Z",
    checks: { sandbox: check },
  });

  assert.equal(expired.capabilities.find((item) => item.id === "sandbox")?.state, "unavailable");
  assert.equal(preview.capabilities.find((item) => item.id === "sandbox")?.state, "unavailable");
});
