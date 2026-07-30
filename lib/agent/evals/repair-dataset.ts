import { assertPrivacySafeTrace, privacySafeText, traceFingerprint } from "./privacy.ts";
import type { AgentFailureClass, AgentRunTrace } from "./types.ts";

export interface VerifiedRepairExample {
  exampleId: string;
  failureClass: AgentFailureClass;
  diagnosticSummary: string;
  strategy: "deterministic" | "model";
  changedPathKinds: string[];
  checkEvidenceIds: string[];
  verifiedAt: string;
  traceId: string;
}

export function repairExamplesFromTrace(trace: AgentRunTrace): VerifiedRepairExample[] {
  if (!trace.verification.deterministicGatePassed || !["PASS", "PASS_WITH_SETUP_REQUIRED"].includes(trace.verification.verdict)) return [];
  const evidenceIds = trace.checks.filter((check) => check.status === "passed").map((check) => check.evidenceId);
  const examples = trace.repairs.filter((repair) => repair.result === "passed").map((repair) => ({
    exampleId: traceFingerprint(`${trace.traceId}:${repair.attempt}:${repair.failureClass}`),
    failureClass: repair.failureClass,
    diagnosticSummary: privacySafeText(`Verified ${repair.failureClass} repair`, 120),
    strategy: repair.strategy,
    changedPathKinds: [...new Set(repair.changedFiles.map((path) => path.split("/")[0] || "root"))].sort(),
    checkEvidenceIds: [...evidenceIds].sort(),
    verifiedAt: trace.finishedAt,
    traceId: trace.traceId,
  }));
  assertPrivacySafeTrace(examples);
  return examples;
}
