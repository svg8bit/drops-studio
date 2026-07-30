import { z } from "zod";

import type { BenchmarkCaseV3, BrowserFlowSpec } from "./types.ts";

const idSchema = z.string().min(3).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const tagSchema = z.string().min(2).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const boundedStrings = (maximum: number) => z.array(z.string().min(2).max(240)).min(1).max(maximum);
const relativePathSchema = z.string().min(1).max(240).regex(/^\/(?!\/)(?:[^\0\\?#]*)$/);
const selectorSchema = z.string().min(1).max(300).refine((value) => !/[{};]/.test(value), "Selector must not contain executable CSS blocks.");

export const browserFlowStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), path: relativePathSchema }).strict(),
  z.object({ action: z.literal("click"), selector: selectorSchema }).strict(),
  z.object({ action: z.literal("fill"), selector: selectorSchema, value: z.string().max(500) }).strict(),
  z.object({
    action: z.literal("press"),
    selector: selectorSchema,
    key: z.enum(["Enter", "Escape", "Space", "ArrowDown", "ArrowUp"]),
  }).strict(),
  z.object({ action: z.literal("expect-visible"), selector: selectorSchema }).strict(),
  z.object({ action: z.literal("expect-text"), selector: selectorSchema, text: z.string().min(1).max(300) }).strict(),
  z.object({ action: z.literal("expect-url"), path: relativePathSchema }).strict(),
  z.object({ action: z.literal("expect-no-console-errors") }).strict(),
  z.object({ action: z.literal("expect-no-failed-requests") }).strict(),
  z.object({ action: z.literal("expect-no-horizontal-overflow") }).strict(),
  z.object({ action: z.literal("axe-scan") }).strict(),
]);

export const browserFlowSpecSchema = z.object({
  id: idSchema,
  version: z.literal("1.0.0"),
  startPath: relativePathSchema,
  steps: z.array(browserFlowStepSchema).min(2).max(32),
  timeoutMs: z.number().int().min(1_000).max(180_000),
}).strict();

export const benchmarkCaseV3Schema = z.object({
  id: idSchema,
  version: versionSchema,
  title: z.string().min(8).max(160),
  suite: z.enum([
    "new-product-generation",
    "existing-project-editing",
    "debugging-repair",
    "drops-integrations",
    "security-approval",
    "context-retrieval",
    "design-responsive",
    "multi-agent-orchestration",
  ]),
  intentKey: idSchema,
  prompt: z.string().min(40).max(2_000),
  fixtureProject: idSchema.optional(),
  requiredCapabilities: boundedStrings(24),
  expectedArtifacts: boundedStrings(24),
  deterministicChecks: z.array(idSchema).min(2).max(24),
  browserFlow: browserFlowSpecSchema.optional(),
  visualViewports: z.array(z.object({
    width: z.number().int().min(320).max(2_560),
    height: z.number().int().min(568).max(2_000),
  }).strict()).min(1).max(5).optional(),
  providerEvidenceRequirements: boundedStrings(16).optional(),
  forbiddenClaims: boundedStrings(16),
  hardBlockers: boundedStrings(16),
  seededFailures: z.array(idSchema).max(5).optional(),
  maxDurationMs: z.number().int().min(1_000).max(600_000).optional(),
  maxEstimatedCostUsd: z.number().min(0).max(20).optional(),
  tags: z.array(tagSchema).min(3).max(20),
  category: z.enum(["build", "edit", "repair", "retrieval", "security", "integration", "release"]),
  expectedRoute: z.enum(["planner", "coder", "quick-edit", "autofix"]),
  requiredContext: boundedStrings(32),
  seededFailure: z.enum([
    "none", "project-schema", "dependency", "typescript", "lint", "test", "build", "preview",
    "browser-runtime", "integration", "security", "permission", "provider", "timeout", "cancelled", "unknown",
  ]),
  requiresBrowser: z.boolean(),
  requiresApprovalBoundary: z.boolean(),
  deterministicBlocker: z.string().min(2).max(240).optional(),
}).strict().superRefine((value, context) => {
  const browserRequired = Boolean(value.browserFlow || value.visualViewports?.length);
  if (value.requiresBrowser !== browserRequired) {
    context.addIssue({ code: "custom", path: ["requiresBrowser"], message: "Browser requirement must match browser/visual evidence." });
  }
  if (value.deterministicBlocker && !value.hardBlockers.includes(value.deterministicBlocker)) {
    context.addIssue({ code: "custom", path: ["deterministicBlocker"], message: "Legacy blocker must be one of the declared hard blockers." });
  }
  if (value.suite === "design-responsive") {
    const viewports = value.visualViewports ?? [];
    for (const width of [1440, 1024, 390]) {
      if (!viewports.some((viewport) => viewport.width === width)) {
        context.addIssue({ code: "custom", path: ["visualViewports"], message: `Design case requires ${width}px evidence.` });
      }
    }
  }
  if (value.suite === "drops-integrations" && !value.providerEvidenceRequirements?.length) {
    context.addIssue({ code: "custom", path: ["providerEvidenceRequirements"], message: "Integration cases require provider evidence." });
  }
});

export function parseBenchmarkCaseV3(value: unknown): BenchmarkCaseV3 {
  return benchmarkCaseV3Schema.parse(value) as BenchmarkCaseV3;
}

export function parseBrowserFlowSpec(value: unknown): BrowserFlowSpec {
  return browserFlowSpecSchema.parse(value) as BrowserFlowSpec;
}
