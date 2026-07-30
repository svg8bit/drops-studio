import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const design = await import("../lib/agent/design/index.ts");

function brief(overrides = {}) {
  return {
    projectId: "whale-design-v3",
    projectRevision: 3,
    category: "whale intelligence",
    prompt: "Create a premium category-native whale intelligence interface in Drops Studio branding.",
    acceptedPlan: "Monitor wallet events, enrich with sourced DropsTab context, review before Telegram delivery.",
    currentUiSummary: "A working Project V2 page with event inbox and detail state.",
    referenceIds: ["DESIGN.md", "drops-studio-reference-v1"],
    assignedScopes: ["app/**", "components/**", "styles/**"],
    unattended: false,
    ...overrides,
  };
}

function screenshotHash(id) {
  return createHash("sha256").update(id).digest("hex");
}

function captures() {
  return design.REQUIRED_DESIGN_VIEWPORTS.map((viewport) => ({
    viewportId: viewport.id,
    width: viewport.width,
    height: viewport.height,
    captured: true,
    screenshotHash: screenshotHash(viewport.id),
    horizontalOverflowPx: 0,
    missingContentCount: 0,
    inaccessibleControlCount: 0,
    seriousA11yViolations: 0,
    criticalA11yViolations: 0,
    consoleErrors: [],
    pageErrors: [],
    primaryFlowPassed: true,
    capturedAt: "2026-07-30T18:30:00.000Z",
  }));
}

function judge(score = 4.5) {
  return {
    model: "authorized-visual-judge",
    promptVersion: "3.0.0",
    scores: Object.fromEntries(design.VISUAL_RUBRIC_DIMENSIONS.map((dimension) => [dimension, score])),
    summary: "The category-native hierarchy is coherent across the supplied evidence.",
  };
}

test("Design Agent proposes three category-native directions before mutation", () => {
  const directions = design.proposeDesignDirections(brief());
  assert.equal(directions.length, 3);
  assert.equal(new Set(directions.map((entry) => entry.id)).size, 3);
  assert.ok(directions.every((entry) => entry.hierarchy.length >= 4 && /whale intelligence/i.test(entry.thesis)));

  const live = design.selectDesignDirection(brief());
  assert.equal(live.status, "awaiting-user-selection");
  assert.equal(live.selectedDirection, null);

  const unattended = design.selectDesignDirection(brief({ unattended: true }));
  assert.equal(unattended.status, "selected");
  assert.equal(unattended.selectionPolicy, "deterministic-eval");
  assert.equal(unattended.selectedDirection.id, "alert-operations");

  const explicit = design.selectDesignDirection(brief({ selectedDirectionId: "research-narrative" }));
  assert.equal(explicit.selectionPolicy, "explicit-user");
  assert.equal(explicit.selectedDirection.id, "research-narrative");
});

test("Design Agent enforces frontend-only assigned scopes", () => {
  assert.deepEqual(
    design.assertDesignAgentScope([
      { path: "components/whale/EventInbox.tsx", operation: "patch", summary: "Clarify signal hierarchy." },
      { path: "app/page.tsx", operation: "patch", summary: "Compose the selected frontend direction." },
      { path: "styles/whale.css", operation: "write", summary: "Add responsive project-token styles." },
    ], ["components/**", "app/**", "styles/**"]),
    ["components/whale/EventInbox.tsx", "app/page.tsx", "styles/whale.css"],
  );
  for (const path of [
    "app/api/wallets/route.ts",
    "lib/drops-platform/dropstab.ts",
    "src/app/actions.ts",
    "components/../../.env",
    "package.json",
  ]) {
    assert.throws(
      () => design.assertDesignAgentScope([{ path, operation: "patch", summary: "Unsafe scope expansion." }], ["**"]),
      /cannot mutate|invalid|outside|unsafe|malformed/i,
      path,
    );
  }
});

test("Visual Verifier passes only complete exact three-viewport evidence", () => {
  const report = design.verifyVisualDesign({ captures: captures(), judge: judge() });
  assert.equal(report.verdict, "PASS");
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.requiredViewportIds, ["desktop-1440", "tablet-1024", "mobile-390"]);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.averageJudgeScore, 4.5);
  assert.equal(report.evidenceHash.length, 64);
});

test("overflow and accessibility blockers cannot be overridden by a perfect visual judge", () => {
  const evidence = captures();
  evidence[2].horizontalOverflowPx = 18;
  evidence[2].seriousA11yViolations = 1;
  const report = design.verifyVisualDesign({ captures: evidence, judge: judge(5) });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.averageJudgeScore, 5);
  assert.ok(report.blockers.some((entry) => entry.startsWith("overflow:mobile-390")));
  assert.ok(report.blockers.some((entry) => entry.startsWith("a11y:mobile-390")));
});

test("missing capture, console error, and failed primary flow remain deterministic blockers", () => {
  const evidence = captures().slice(0, 2);
  evidence[0].consoleErrors.push("Hydration failed");
  evidence[1].primaryFlowPassed = false;
  const report = design.verifyVisualDesign({ captures: evidence, judge: judge(5) });
  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.blockers.some((entry) => entry.startsWith("capture:mobile-390")));
  assert.ok(report.blockers.some((entry) => entry.startsWith("console:desktop-1440")));
  assert.ok(report.blockers.some((entry) => entry.startsWith("primary-flow:tablet-1024")));
});

test("Visual Verifier is read-only and snapshot updates are rejected", () => {
  for (const forbidden of ["write_file", "apply_patch", "delete_file", "rename_file", "run_command", "publish_project"]) {
    assert.equal(design.VISUAL_VERIFIER_ALLOWED_TOOLS.includes(forbidden), false);
  }
  assert.throws(() => design.assertNoVisualSnapshotUpdate(["playwright", "test", "--update-snapshots"]), /cannot update/i);
  assert.throws(() => design.assertNoVisualSnapshotUpdate("UPDATE_SNAPSHOTS=1 npm test"), /cannot update/i);
  assert.doesNotThrow(() => design.assertNoVisualSnapshotUpdate(["playwright", "test", "e2e/visual"]));
});
