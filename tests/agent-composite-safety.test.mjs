import assert from "node:assert/strict";
import test from "node:test";

const {
  evaluateQuickEditPatch,
  runAutoFixLoop,
  verifierMayUseTool,
  verifyReleaseEvidence,
} = await import("../lib/agent/models/index.ts");

test("Quick Edit accepts a bounded patch and escalates scope expansion", () => {
  const base = {
    baseRevision: "revision-1",
    taskId: "quick-1",
    files: [{
      path: "app/page.tsx",
      expectedHash: "a".repeat(64),
      operation: "patch",
      patch: "-old\n+new",
    }],
    testsToRun: ["typecheck"],
    summary: ["Update title"],
  };
  assert.deepEqual(
    evaluateQuickEditPatch(base, {
      expectedRevision: "revision-1",
      allowedPaths: ["app/page.tsx"],
    }),
    { accepted: true, escalate: false, reasons: [], changedLines: 2 },
  );
  const expanded = evaluateQuickEditPatch(
    {
      ...base,
      files: Array.from({ length: 5 }, (_, index) => ({
        ...base.files[0],
        path: `components/${index}.tsx`,
      })),
    },
    {
      expectedRevision: "revision-1",
      allowedPaths: ["app/page.tsx"],
      introducesDependency: true,
    },
  );
  assert.equal(expanded.accepted, false);
  assert.equal(expanded.escalate, true);
  assert.ok(expanded.reasons.includes("FILE_SCOPE_EXCEEDED"));
  assert.ok(expanded.reasons.includes("DEPENDENCY_CHANGE"));
  assert.ok(expanded.reasons.includes("OUT_OF_SCOPE_PATH"));
});

test("AutoFix refuses policy failures and never exceeds three model repair rounds", async () => {
  const blocked = await runAutoFixLoop({
    initialEvidence: {
      id: "security-1",
      failureClass: "security-policy",
      command: "secret-scan",
      sanitizedLog: "blocked",
      affectedPaths: [],
    },
    deterministicFix: () => ({ changed: false }),
    modelFix: async () => ({ changed: true }),
    check: async () => { throw new Error("must not run"); },
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.rounds.length, 0);

  let checks = 0;
  const exhausted = await runAutoFixLoop({
    initialEvidence: {
      id: "type-0",
      failureClass: "type-error",
      command: "npm run typecheck",
      sanitizedLog: "Type mismatch",
      affectedPaths: ["app/page.tsx"],
    },
    deterministicFix: () => ({ changed: false }),
    modelFix: async () => ({ changed: true }),
    check: async () => ({
      passed: false,
      evidence: {
        id: `type-${++checks}`,
        failureClass: "type-error",
        command: "npm run typecheck",
        sanitizedLog: "Still mismatched",
        affectedPaths: ["app/page.tsx"],
      },
    }),
    maxModelRounds: 99,
  });
  assert.equal(exhausted.status, "exhausted");
  assert.equal(exhausted.rounds.length, 3);
  assert.deepEqual(exhausted.rounds.map((round) => round.round), [1, 2, 3]);
});

function evidence(gates) {
  return {
    projectRevision: "revision-2",
    evidenceHash: "b".repeat(64),
    gates,
    setupRequired: [],
    unresolvedWarnings: [],
  };
}

const passingGates = [
  "project-schema",
  "typecheck",
  "lint",
  "tests",
  "build",
  "preview",
  "browser",
  "secret-scan",
  "permissions",
].map((name, index) => ({
  id: `evidence-${index}`,
  name,
  passed: true,
  required: true,
  summary: "passed",
}));

test("Verifier has no mutation tools and cannot upgrade a deterministic failure", () => {
  assert.equal(verifierMayUseTool("read_file"), true);
  assert.equal(verifierMayUseTool("read_logs"), true);
  for (const tool of [
    "write_file",
    "apply_patch",
    "delete_file",
    "run_command",
    "publish_project",
  ]) {
    assert.equal(verifierMayUseTool(tool), false, tool);
  }
  const failedBuild = passingGates.map((gate) =>
    gate.name === "build" ? { ...gate, passed: false, summary: "exit 1" } : gate,
  );
  const report = verifyReleaseEvidence(evidence(failedBuild), {
    verifierModel: "openai/verifier",
    verifierPromptVersion: "2.0.0",
    advisoryVerdict: "PASS",
  });
  assert.equal(report.verdict, "RETRYABLE_FAILURE");
  assert.match(report.failedCriteria[0], /build: exit 1/);
});

test("Verifier may downgrade deterministic success and security evidence is authoritative", () => {
  const downgrade = verifyReleaseEvidence(evidence(passingGates), {
    verifierModel: "anthropic/verifier",
    verifierPromptVersion: "2.0.0",
    advisoryVerdict: "BLOCKED",
    advisoryRationale: "The independent reviewer found an unresolved primary-flow blocker.",
  });
  assert.equal(downgrade.verdict, "BLOCKED");

  const secretFailure = passingGates.map((gate) =>
    gate.name === "secret-scan"
      ? { ...gate, passed: false, summary: "credential-like artifact" }
      : gate,
  );
  const unsafe = verifyReleaseEvidence(evidence(secretFailure), {
    verifierModel: "openai/verifier",
    verifierPromptVersion: "2.0.0",
    advisoryVerdict: "PASS",
  });
  assert.equal(unsafe.verdict, "UNSAFE");
});

test("Verifier cannot pass when live browser evidence is absent", () => {
  const report = verifyReleaseEvidence(
    evidence(passingGates.filter((gate) => gate.name !== "browser")),
    {
      verifierModel: "openai/verifier",
      verifierPromptVersion: "2.0.0",
      advisoryVerdict: "PASS",
    },
  );
  assert.equal(report.verdict, "RETRYABLE_FAILURE");
  assert.ok(report.failedCriteria.some((criterion) => /browser/.test(criterion)));
});
