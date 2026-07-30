import { createHash } from "node:crypto";

import {
  REQUIRED_DESIGN_VIEWPORTS,
  VISUAL_RUBRIC_DIMENSIONS,
  designCaptureSchema,
  visualJudgeSchema,
  type DesignCaptureEvidence,
  type VisualDeterministicCheck,
  type VisualJudgeAssessment,
  type VisualVerificationReport,
} from "./types.ts";

function hashEvidence(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function check(id: string, viewportId: VisualDeterministicCheck["viewportId"], passed: boolean, summary: string): VisualDeterministicCheck {
  return { id, viewportId, passed, blocking: true, summary };
}

function captureChecks(capture: DesignCaptureEvidence): VisualDeterministicCheck[] {
  return [
    check(`capture:${capture.viewportId}`, capture.viewportId, capture.captured && Boolean(capture.screenshotHash), "Required screenshot capture exists and is content-addressed."),
    check(`overflow:${capture.viewportId}`, capture.viewportId, capture.horizontalOverflowPx === 0, `Horizontal overflow is ${capture.horizontalOverflowPx}px.`),
    check(`content:${capture.viewportId}`, capture.viewportId, capture.missingContentCount === 0, `${capture.missingContentCount} required content regions are missing.`),
    check(`controls:${capture.viewportId}`, capture.viewportId, capture.inaccessibleControlCount === 0, `${capture.inaccessibleControlCount} controls are inaccessible.`),
    check(`a11y:${capture.viewportId}`, capture.viewportId, capture.seriousA11yViolations === 0 && capture.criticalA11yViolations === 0, `${capture.seriousA11yViolations} serious and ${capture.criticalA11yViolations} critical accessibility violations.`),
    check(`console:${capture.viewportId}`, capture.viewportId, capture.consoleErrors.length === 0 && capture.pageErrors.length === 0, `${capture.consoleErrors.length} console and ${capture.pageErrors.length} page errors.`),
    check(`primary-flow:${capture.viewportId}`, capture.viewportId, capture.primaryFlowPassed, "Primary interaction flow completed."),
  ];
}

function validateJudge(value: VisualJudgeAssessment | null | undefined): VisualJudgeAssessment | null {
  if (!value) return null;
  const judge = visualJudgeSchema.parse(value);
  for (const dimension of VISUAL_RUBRIC_DIMENSIONS) {
    if (judge.scores[dimension] === undefined) throw new Error(`Visual judge omitted ${dimension}.`);
  }
  return judge;
}

export function verifyVisualDesign(input: {
  captures: readonly DesignCaptureEvidence[];
  judge?: VisualJudgeAssessment | null;
}): VisualVerificationReport {
  const captures = input.captures.map((capture) => designCaptureSchema.parse(capture));
  if (new Set(captures.map((capture) => capture.viewportId)).size !== captures.length) {
    throw new Error("Visual evidence contains duplicate viewport captures.");
  }
  const byId = new Map(captures.map((capture) => [capture.viewportId, capture]));
  const checks: VisualDeterministicCheck[] = [];
  for (const viewport of REQUIRED_DESIGN_VIEWPORTS) {
    const capture = byId.get(viewport.id);
    if (!capture) {
      checks.push(check(`capture:${viewport.id}`, viewport.id, false, "Required viewport evidence is missing."));
      continue;
    }
    checks.push(check(`viewport:${viewport.id}`, viewport.id, capture.width === viewport.width && capture.height === viewport.height, `Captured ${capture.width}x${capture.height}; required ${viewport.width}x${viewport.height}.`));
    checks.push(...captureChecks(capture));
  }
  const blockers = checks.filter((entry) => !entry.passed).map((entry) => `${entry.id}: ${entry.summary}`);
  const judge = validateJudge(input.judge);
  const averageJudgeScore = judge
    ? Number((VISUAL_RUBRIC_DIMENSIONS.reduce((sum, dimension) => sum + judge.scores[dimension], 0) / VISUAL_RUBRIC_DIMENSIONS.length).toFixed(3))
    : null;
  const evidenceHash = hashEvidence({ captures, checks, judge });
  return {
    schemaVersion: 1,
    verdict: blockers.length ? "BLOCKED" : "PASS",
    readOnly: true,
    checks,
    blockers,
    judge,
    averageJudgeScore,
    requiredViewportIds: REQUIRED_DESIGN_VIEWPORTS.map((viewport) => viewport.id),
    evidenceHash,
  };
}
