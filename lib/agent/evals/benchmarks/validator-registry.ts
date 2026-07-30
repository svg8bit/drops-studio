import { assertProjectPayloadSafe } from "../../../artifact-security.ts";
import { normalizeProjectV2Path } from "../../../project-v2-path.ts";
import { validateProjectV2 } from "../../../project-v2-validator.ts";
import type {
  BenchmarkCaseV3,
  BenchmarkValidationContext,
  BenchmarkValidationResult,
} from "./types.ts";

export type BenchmarkValidator = (
  fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
) => Promise<BenchmarkValidationResult>;

function result(
  checkId: string,
  passed: boolean,
  evidenceIds: string[],
  detail?: string,
): BenchmarkValidationResult {
  return { checkId, passed, evidenceIds, ...(detail ? { detail } : {}), hardBlocker: !passed };
}

async function projectV2Validator(
  _fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
): Promise<BenchmarkValidationResult> {
  if (!context.project) return result("project-v2-valid", false, [], "Canonical Project V2 evidence is missing.");
  try {
    await validateProjectV2(context.project);
    return result("project-v2-valid", true, [`project:${context.project.id}:revision:${context.project.revision}`]);
  } catch (error) {
    return result("project-v2-valid", false, [], error instanceof Error ? error.message : "Project V2 validation failed.");
  }
}

async function artifactValidator(
  fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
): Promise<BenchmarkValidationResult> {
  const observed = new Set(context.observedArtifacts);
  const missing = fixture.expectedArtifacts.filter((artifact) => !observed.has(artifact));
  return result(
    "expected-artifacts",
    missing.length === 0,
    missing.length ? [] : fixture.expectedArtifacts.map((artifact) => `artifact:${artifact}`),
    missing.length ? `Missing artifacts: ${missing.join(", ")}.` : undefined,
  );
}

async function secretValidator(
  _fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
): Promise<BenchmarkValidationResult> {
  try {
    if (context.project) assertProjectPayloadSafe(context.project, "benchmark project");
    return result("secret-scan", true, ["security:artifact-secret-scan"]);
  } catch (error) {
    return result("secret-scan", false, [], error instanceof Error ? error.message : "Secret scan failed.");
  }
}

async function pathValidator(
  _fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
): Promise<BenchmarkValidationResult> {
  try {
    for (const path of Object.keys(context.project?.files ?? {})) normalizeProjectV2Path(path);
    return result("path-policy", true, ["security:project-path-policy"]);
  } catch (error) {
    return result("path-policy", false, [], error instanceof Error ? error.message : "Path validation failed.");
  }
}

function evidenceValidator(checkId: string): BenchmarkValidator {
  return async (_fixture, context) => {
    const evidence = context.evidence[checkId];
    if (!evidence) return result(checkId, false, [], `Required independent evidence ${checkId} is missing.`);
    return result(checkId, evidence.passed, [...evidence.evidenceIds], evidence.detail);
  };
}

const EVIDENCE_CHECK_IDS = [
  "typecheck",
  "lint",
  "tests",
  "production-build",
  "preview-ready",
  "browser-primary-flow",
  "no-console-errors",
  "no-network-errors",
  "no-horizontal-overflow",
  "axe-no-critical",
  "provider-evidence-truth",
  "setup-required-truth",
  "approval-boundary",
  "context-recall",
  "context-current-revision",
  "context-tenant-isolation",
  "role-route",
  "patch-scope",
  "atomic-merge",
  "dag-acyclic",
  "concurrency-limit",
  "checkpoint-hash",
  "trace-privacy",
  "design-viewports",
  "design-rubric",
  "verifier-authority",
  "sandbox-env-isolation",
  "output-bounds",
  "stream-complete",
  "dependency-policy",
  "provider-endpoint-documented",
  "webhook-signature",
  "webhook-replay-protection",
  "revision-conflict",
  "cancellation-propagated",
  "resume-canonical-revision",
] as const;

export const BENCHMARK_VALIDATORS: ReadonlyMap<string, BenchmarkValidator> = new Map([
  ["project-v2-valid", projectV2Validator],
  ["expected-artifacts", artifactValidator],
  ["secret-scan", secretValidator],
  ["path-policy", pathValidator],
  ...EVIDENCE_CHECK_IDS.map((checkId) => [checkId, evidenceValidator(checkId)] as const),
]);

export const BENCHMARK_VALIDATOR_IDS = new Set(BENCHMARK_VALIDATORS.keys());

export async function runBenchmarkValidators(
  fixture: BenchmarkCaseV3,
  context: BenchmarkValidationContext,
): Promise<BenchmarkValidationResult[]> {
  const results: BenchmarkValidationResult[] = [];
  for (const checkId of fixture.deterministicChecks) {
    const validator = BENCHMARK_VALIDATORS.get(checkId);
    if (!validator) throw new Error(`Benchmark check ${checkId} is not registered.`);
    results.push(await validator(fixture, context));
  }
  return results;
}
