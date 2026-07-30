import { z } from "zod";

export const REQUIRED_DESIGN_VIEWPORTS = [
  { id: "desktop-1440", width: 1440, height: 900 },
  { id: "tablet-1024", width: 1024, height: 768 },
  { id: "mobile-390", width: 390, height: 844 },
] as const;

export const VISUAL_RUBRIC_DIMENSIONS = [
  "information-hierarchy",
  "typography-readability",
  "spacing-consistency",
  "component-coherence",
  "brand-adherence",
  "category-native-interaction",
  "responsive-composition",
  "accessibility",
  "interaction-clarity",
  "originality",
  "no-generic-ai-artifacts",
] as const;

export type VisualRubricDimension = (typeof VISUAL_RUBRIC_DIMENSIONS)[number];

export const designBriefSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  projectRevision: z.number().int().positive(),
  category: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  acceptedPlan: z.string().min(1).max(20_000),
  currentUiSummary: z.string().min(1).max(10_000),
  referenceIds: z.array(z.string().min(1).max(160)).max(24),
  assignedScopes: z.array(z.string().min(1).max(240)).min(1).max(32),
  unattended: z.boolean(),
  selectedDirectionId: z.string().min(1).max(120).optional(),
}).strict();

export type DesignBrief = z.infer<typeof designBriefSchema>;

export interface DesignDirection {
  id: string;
  label: string;
  thesis: string;
  hierarchy: string[];
  interactionModel: string;
  responsiveStrategy: string;
  brandExpression: string;
  categorySignals: string[];
  deterministicScore: number;
}

export interface DesignDirectionSelection {
  status: "selected" | "awaiting-user-selection";
  directions: DesignDirection[];
  selectedDirection: DesignDirection | null;
  selectionPolicy: "explicit-user" | "deterministic-eval" | "user-review";
  reason: string;
}

export const designFileChangeSchema = z.object({
  path: z.string().min(1).max(240),
  operation: z.enum(["write", "patch", "delete"]),
  summary: z.string().min(1).max(500),
}).strict();

export type DesignFileChange = z.infer<typeof designFileChangeSchema>;

export const designCaptureSchema = z.object({
  viewportId: z.enum(["desktop-1440", "tablet-1024", "mobile-390"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  captured: z.boolean(),
  screenshotHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  horizontalOverflowPx: z.number().nonnegative(),
  missingContentCount: z.number().int().nonnegative(),
  inaccessibleControlCount: z.number().int().nonnegative(),
  seriousA11yViolations: z.number().int().nonnegative(),
  criticalA11yViolations: z.number().int().nonnegative(),
  consoleErrors: z.array(z.string().max(500)).max(50),
  pageErrors: z.array(z.string().max(500)).max(50),
  primaryFlowPassed: z.boolean(),
  capturedAt: z.string().datetime(),
}).strict();

export type DesignCaptureEvidence = z.infer<typeof designCaptureSchema>;

export const visualJudgeSchema = z.object({
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(80),
  scores: z.record(z.enum(VISUAL_RUBRIC_DIMENSIONS), z.number().min(0).max(5)),
  summary: z.string().min(1).max(1_000),
}).strict();

export type VisualJudgeAssessment = z.infer<typeof visualJudgeSchema>;

export interface VisualDeterministicCheck {
  id: string;
  viewportId: DesignCaptureEvidence["viewportId"] | "all";
  passed: boolean;
  blocking: true;
  summary: string;
}

export interface VisualVerificationReport {
  schemaVersion: 1;
  verdict: "PASS" | "BLOCKED";
  readOnly: true;
  checks: VisualDeterministicCheck[];
  blockers: string[];
  judge: VisualJudgeAssessment | null;
  averageJudgeScore: number | null;
  requiredViewportIds: string[];
  evidenceHash: string;
}
