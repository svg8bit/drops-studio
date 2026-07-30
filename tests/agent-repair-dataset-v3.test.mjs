import assert from "node:assert/strict";
import test from "node:test";

const {
  REPAIR_DATASET_V3_VERSION,
  SYNTHETIC_REPAIR_DATASET_V3,
  serializeRepairDatasetV3Jsonl,
  validateRepairDatasetV3,
} = await import("../lib/agent/repairs/index.ts");

test("v3 repair corpus contains 36 accepted synthetic traces across 12 non-trivial classes", () => {
  assert.equal(SYNTHETIC_REPAIR_DATASET_V3.length, 36);
  const classes = new Map();
  for (const entry of SYNTHETIC_REPAIR_DATASET_V3) {
    classes.set(entry.failureClass, (classes.get(entry.failureClass) ?? 0) + 1);
  }
  assert.equal(classes.size, 12);
  assert.ok([...classes.values()].every((count) => count >= 3));
  const result = validateRepairDatasetV3(SYNTHETIC_REPAIR_DATASET_V3);
  assert.equal(result.accepted.length, 36);
  assert.deepEqual(result.rejected, []);
  assert.ok(result.accepted.every((entry) => entry.datasetVersion === REPAIR_DATASET_V3_VERSION));
});

test("JSONL export is deterministic, machine-readable and privacy-safe", () => {
  const first = serializeRepairDatasetV3Jsonl();
  const second = serializeRepairDatasetV3Jsonl();
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
  const records = first.trim().split("\n").map(JSON.parse);
  assert.equal(records.length, SYNTHETIC_REPAIR_DATASET_V3.length);
  assert.ok(records.every((entry) => entry.schemaVersion === 3));
  assert.doesNotMatch(first, /(?:github_pat_|ghp_|sk-proj-|BEGIN PRIVATE KEY|Bearer\s+[A-Za-z0-9]{20})/);
});

test("every accepted trace proves reproduction, bounded patch, focused removal and secret scan", () => {
  for (const entry of validateRepairDatasetV3(SYNTHETIC_REPAIR_DATASET_V3).accepted) {
    assert.equal(entry.verifiedPatch.writes.length, 1);
    assert.ok(entry.checksPassed.some((check) => check.startsWith("fixture-reproduced:")));
    assert.ok(entry.checksPassed.some((check) => check.startsWith("patch-applied:")));
    assert.ok(entry.checksPassed.some((check) => check.startsWith("focused-failure-removed:")));
    assert.ok(entry.checksPassed.some((check) => check.startsWith("secret-scan:")));
    const write = entry.verifiedPatch.writes[0];
    assert.ok(entry.fixture.files[write.path].includes(entry.fixture.failureMarker));
    assert.equal(write.content.includes(entry.fixture.failureMarker), false);
    assert.match(write.expectedHash, /^[a-f0-9]{64}$/);
    assert.match(entry.afterHashes[write.path], /^[a-f0-9]{64}$/);
  }
});

test("build and browser applicability is explicit without fabricated evidence", () => {
  for (const entry of SYNTHETIC_REPAIR_DATASET_V3) {
    assert.equal(entry.build.required, false);
    assert.equal(entry.build.evidenceIds.length, 0);
    assert.match(entry.build.notApplicableReason, /no installable application manifest/i);
    assert.equal(entry.browser.required, false);
    assert.equal(entry.browser.evidenceIds.length, 0);
    assert.equal(entry.browserEvidenceIds.length, 0);
    assert.match(entry.browser.notApplicableReason, /no runnable preview or browser flow/i);
  }
});

test("provenance, licensing and honest review state are mandatory and preserved", () => {
  for (const entry of SYNTHETIC_REPAIR_DATASET_V3) {
    assert.equal(entry.source, "synthetic");
    assert.equal(entry.license, "CC0-1.0");
    assert.equal(entry.reviewed, false, "automated fixture verification must not claim human review");
    assert.ok(entry.contextProvenanceIds.every((id) => id.startsWith("synthetic:")));
  }
  const missingLicense = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[0]);
  delete missingLicense.license;
  const result = validateRepairDatasetV3([missingLicense]);
  assert.deepEqual(result.accepted, []);
  assert.ok(result.rejected[0].reasons.includes("license-or-consent"));
});

test("required build or browser evidence cannot be asserted without real evidence IDs", () => {
  const build = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[0]);
  build.id = `${build.id}-bad-build`;
  build.build = { required: true, evidenceIds: [] };
  const browser = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[1]);
  browser.id = `${browser.id}-bad-browser`;
  browser.browser = { required: true, evidenceIds: [] };
  const result = validateRepairDatasetV3([build, browser]);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.find((entry) => entry.id === build.id).reasons.includes("build-applicability"));
  assert.ok(result.rejected.find((entry) => entry.id === browser.id).reasons.includes("browser-applicability"));
});

test("secret material, stale hashes, failed focused checks and duplicate repairs are rejected", () => {
  const secret = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[0]);
  secret.id = `${secret.id}-secret`;
  secret.sanitizedFailure = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

  const stale = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[1]);
  stale.id = `${stale.id}-stale`;
  stale.verifiedPatch.writes[0].expectedHash = "0".repeat(64);

  const failed = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[2]);
  failed.id = `${failed.id}-failed`;
  failed.verifiedPatch.writes[0].content += failed.fixture.failureMarker;

  const duplicate = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[3]);
  const result = validateRepairDatasetV3([secret, stale, failed, duplicate, structuredClone(duplicate)]);
  assert.equal(result.accepted.length, 1);
  assert.ok(result.rejected.find((entry) => entry.id === secret.id).reasons.includes("secret"));
  assert.ok(result.rejected.find((entry) => entry.id === stale.id).reasons.includes("before-hash"));
  assert.ok(result.rejected.find((entry) => entry.id === failed.id).reasons.includes("failure-marker"));
  assert.ok(result.rejected.some((entry) => entry.reasons.includes("duplicate-id")));
  assert.ok(result.rejected.some((entry) => entry.reasons.includes("duplicate-repair")));
});

test("user opt-in provenance requires explicit consent instead of a synthetic license", () => {
  const opted = structuredClone(SYNTHETIC_REPAIR_DATASET_V3[0]);
  opted.id = `${opted.id}-opted`;
  opted.source = "user-opt-in";
  delete opted.license;
  const missing = validateRepairDatasetV3([opted]);
  assert.equal(missing.accepted.length, 0);
  assert.ok(missing.rejected[0].reasons.includes("license-or-consent"));
  opted.consentId = "consent-fixture-1";
  const accepted = validateRepairDatasetV3([opted]);
  assert.equal(accepted.accepted.length, 1);
});
