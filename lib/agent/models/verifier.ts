import type { AgentModelRole } from "./types.ts";

export type VerifierVerdict =
  | "PASS"
  | "PASS_WITH_SETUP_REQUIRED"
  | "RETRYABLE_FAILURE"
  | "BLOCKED"
  | "UNSAFE";

export interface DeterministicGateEvidence {
  id: string;
  name:
    | "project-schema"
    | "typecheck"
    | "lint"
    | "tests"
    | "build"
    | "preview"
    | "browser"
    | "secret-scan"
    | "permissions";
  passed: boolean;
  required: boolean;
  summary: string;
}

export interface ImmutableVerificationEvidence {
  projectRevision: string;
  evidenceHash: string;
  gates: readonly DeterministicGateEvidence[];
  setupRequired: readonly string[];
  unresolvedWarnings: readonly string[];
}

export interface VerificationReport {
  verdict: VerifierVerdict;
  evidenceIds: string[];
  failedCriteria: string[];
  setupRequired: string[];
  retryTasks: Array<{
    ownerRole: AgentModelRole | "orchestrator";
    task: string;
    relevantPaths: string[];
  }>;
  userSummary: string;
  advisoryEscalation: {
    verdict: VerifierVerdict;
    rationale: string;
  } | null;
  verifierModel: string;
  verifierPromptVersion: string;
}

export const VERIFIER_ALLOWED_TOOLS = [
  "list_files",
  "read_file",
  "read_files",
  "search_files",
  "read_logs",
] as const;

const VERIFIER_MUTATION_TOOLS = new Set([
  "write_file",
  "apply_patch",
  "delete_file",
  "rename_file",
  "install_package",
  "run_command",
  "start_preview",
  "create_checkpoint",
  "restore_checkpoint",
  "request_connection",
  "publish_project",
]);

export function verifierMayUseTool(tool: string): boolean {
  return !VERIFIER_MUTATION_TOOLS.has(tool) &&
    (VERIFIER_ALLOWED_TOOLS as readonly string[]).includes(tool);
}

function deterministicVerdict(
  evidence: ImmutableVerificationEvidence,
): { verdict: VerifierVerdict; failed: DeterministicGateEvidence[] } {
  const alwaysRequired: DeterministicGateEvidence["name"][] = [
    "project-schema",
    "build",
    "preview",
    "browser",
    "secret-scan",
    "permissions",
  ];
  const present = new Map(evidence.gates.map((gate) => [gate.name, gate]));
  const missing = alwaysRequired
    .filter((name) => !present.has(name))
    .map((name) => ({
      id: `missing:${name}`,
      name,
      passed: false,
      required: true,
      summary: "required evidence is missing",
    })) satisfies DeterministicGateEvidence[];
  const failed = [
    ...evidence.gates.filter(
      (gate) => (gate.required || alwaysRequired.includes(gate.name)) && !gate.passed,
    ),
    ...missing,
  ];
  if (failed.some((gate) => gate.name === "secret-scan" || gate.name === "permissions")) {
    return { verdict: "UNSAFE", failed };
  }
  if (failed.length) return { verdict: "RETRYABLE_FAILURE", failed };
  if (evidence.setupRequired.length) {
    return { verdict: "PASS_WITH_SETUP_REQUIRED", failed: [] };
  }
  return { verdict: "PASS", failed: [] };
}

const VERDICT_SEVERITY: Record<VerifierVerdict, number> = {
  PASS: 0,
  PASS_WITH_SETUP_REQUIRED: 1,
  RETRYABLE_FAILURE: 2,
  BLOCKED: 3,
  UNSAFE: 4,
};

export function verifyReleaseEvidence(
  evidence: ImmutableVerificationEvidence,
  input: {
    verifierModel: string;
    verifierPromptVersion: string;
    advisoryVerdict?: VerifierVerdict;
    advisoryRationale?: string;
  },
): VerificationReport {
  const deterministic = deterministicVerdict(evidence);
  const advisory = input.advisoryVerdict;
  const advisoryRationale = input.advisoryRationale?.trim().slice(0, 800) ?? "";
  const advisoryEscalation =
    advisory &&
      advisoryRationale &&
      VERDICT_SEVERITY[advisory] > VERDICT_SEVERITY[deterministic.verdict]
      ? { verdict: advisory, rationale: advisoryRationale }
      : null;
  const verdict =
    advisoryEscalation
      ? advisoryEscalation.verdict
      : deterministic.verdict;
  return {
    verdict,
    evidenceIds: evidence.gates.map((gate) => gate.id),
    failedCriteria: deterministic.failed.map(
      (gate) => `${gate.name}: ${gate.summary}`,
    ),
    setupRequired: [...evidence.setupRequired],
    retryTasks: deterministic.failed.map((gate) => ({
      ownerRole: gate.name === "secret-scan" || gate.name === "permissions"
        ? "orchestrator"
        : "autofix",
      task: `Resolve failed ${gate.name} gate.`,
      relevantPaths: [],
    })),
    userSummary: advisoryEscalation
      ? `Independent verifier escalated the deterministic result: ${advisoryEscalation.rationale}`
      :
      verdict === "PASS"
        ? "All deterministic release and browser gates passed."
        : verdict === "PASS_WITH_SETUP_REQUIRED"
          ? "The verified product works with the listed setup requirements."
          : verdict === "UNSAFE"
            ? "Release is unsafe because a security gate failed."
            : "Release remains blocked by deterministic evidence.",
    advisoryEscalation,
    verifierModel: input.verifierModel,
    verifierPromptVersion: input.verifierPromptVersion,
  };
}
