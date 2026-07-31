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
  }, new Date("2026-07-30T12:00:00.000Z"));
  const projectData = snapshot.capabilities.find((item) => item.id === "project-data");
  assert.equal(projectData?.state, "working-local-test");
  assert.equal(projectData?.mode, "process-memory-local-test");
});
