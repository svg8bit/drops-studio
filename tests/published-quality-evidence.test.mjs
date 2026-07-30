import assert from "node:assert/strict";
import test from "node:test";

import { acceptPublishedQuality } from "../lib/published-quality-evidence.ts";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const valid = {
  score: 96,
  readyToPublish: true,
  launchStatus: "web-ready",
  deliveryMode: "web-native",
  externalSetupRequired: false,
  checkedAt: "2026-07-30T12:00:00.000Z",
  checks: [
    {
      id: "runtime",
      label: "Runnable standalone output",
      passed: true,
      detail: "Static server inspection passed",
      weight: 3,
      critical: true,
    },
  ],
  criticalFailures: [],
  runtimeSmoke: {
    mode: "server-inspection",
    dataProvider: "unverified",
    executed: false,
    runtime: true,
    interactions: true,
    dropstab: true,
    dropsbot: true,
    actions: true,
    errors: [],
    checkedAt: "2026-07-30T12:00:00.000Z",
  },
};

test("accepts the publish API's server inspection for the matching product contract", () => {
  assert.equal(acceptPublishedQuality(valid, "crypto-game", NOW), valid);
});

test("rejects iframe quality, a mismatched preset contract, and failed inspection", () => {
  assert.equal(
    acceptPublishedQuality({
      ...valid,
      runtimeSmoke: { ...valid.runtimeSmoke, mode: "browser", executed: true },
    }, "crypto-game", NOW),
    null,
  );
  assert.equal(
    acceptPublishedQuality(valid, "morning-alpha", NOW),
    null,
    "a web-native quality report cannot be applied to a connection-required preset",
  );
  assert.equal(
    acceptPublishedQuality({
      ...valid,
      readyToPublish: false,
      criticalFailures: ["runtime"],
    }, "crypto-game", NOW),
    null,
  );
  assert.equal(
    acceptPublishedQuality({
      ...valid,
      checks: [{ ...valid.checks[0], passed: false }],
      criticalFailures: [],
    }, "crypto-game", NOW),
    null,
    "a hidden failed critical check cannot be accepted",
  );
});

test("rejects stale or future-dated publish evidence", () => {
  const evidenceAt = (checkedAt) => ({
    ...valid,
    checkedAt,
    runtimeSmoke: { ...valid.runtimeSmoke, checkedAt },
  });

  assert.equal(
    acceptPublishedQuality(
      evidenceAt("2026-07-30T11:54:59.999Z"),
      "crypto-game",
      NOW,
    ),
    null,
  );
  assert.equal(
    acceptPublishedQuality(
      evidenceAt("2026-07-30T12:00:30.001Z"),
      "crypto-game",
      NOW,
    ),
    null,
  );
  assert.equal(
    acceptPublishedQuality(
      {
        ...valid,
        runtimeSmoke: {
          ...valid.runtimeSmoke,
          checkedAt: "2026-07-30T11:54:59.999Z",
        },
      },
      "crypto-game",
      NOW,
    ),
    null,
    "the nested server inspection must be fresh independently",
  );
});
