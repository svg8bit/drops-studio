export type AutoFixFailureClass =
  | "missing-dependency"
  | "missing-import"
  | "type-error"
  | "route-reference"
  | "framework-boundary"
  | "browser-runtime"
  | "primary-interaction"
  | "integration-shape"
  | "visual-overflow"
  | "accessibility"
  | "credentials"
  | "authorization"
  | "security-policy"
  | "destructive-conflict";

export interface AutoFixEvidence {
  id: string;
  failureClass: AutoFixFailureClass;
  command: string;
  sanitizedLog: string;
  affectedPaths: string[];
}

export interface AutoFixRound {
  round: number;
  evidenceId: string;
  strategy: "deterministic" | "model";
  changed: boolean;
  checkPassed: boolean;
}

export interface AutoFixResult {
  status: "fixed" | "blocked" | "exhausted";
  rounds: AutoFixRound[];
  blocker: string | null;
}

const NON_REPAIRABLE = new Set<AutoFixFailureClass>([
  "credentials",
  "authorization",
  "security-policy",
  "destructive-conflict",
]);

export async function runAutoFixLoop(input: {
  initialEvidence: AutoFixEvidence;
  deterministicFix: (
    evidence: AutoFixEvidence,
  ) => Promise<{ changed: boolean }> | { changed: boolean };
  modelFix: (
    evidence: AutoFixEvidence,
    round: number,
  ) => Promise<{ changed: boolean }>;
  check: () => Promise<{ passed: boolean; evidence: AutoFixEvidence }>;
  maxModelRounds?: number;
}): Promise<AutoFixResult> {
  if (NON_REPAIRABLE.has(input.initialEvidence.failureClass)) {
    return {
      status: "blocked",
      rounds: [],
      blocker: `AutoFix cannot repair ${input.initialEvidence.failureClass}.`,
    };
  }
  const maxModelRounds = Math.min(3, Math.max(0, input.maxModelRounds ?? 3));
  const rounds: AutoFixRound[] = [];
  let evidence = input.initialEvidence;
  let lastUnchangedEvidence: string | null = null;

  const deterministic = await input.deterministicFix(evidence);
  if (deterministic.changed) {
    const checked = await input.check();
    rounds.push({
      round: 0,
      evidenceId: evidence.id,
      strategy: "deterministic",
      changed: true,
      checkPassed: checked.passed,
    });
    if (checked.passed) return { status: "fixed", rounds, blocker: null };
    evidence = checked.evidence;
  }

  for (let round = 1; round <= maxModelRounds; round += 1) {
    if (NON_REPAIRABLE.has(evidence.failureClass)) {
      return {
        status: "blocked",
        rounds,
        blocker: `AutoFix cannot repair ${evidence.failureClass}.`,
      };
    }
    if (lastUnchangedEvidence === evidence.id) {
      return {
        status: "blocked",
        rounds,
        blocker: "AutoFix stopped on unchanged failure evidence.",
      };
    }
    const repair = await input.modelFix(evidence, round);
    const checked = repair.changed
      ? await input.check()
      : { passed: false, evidence };
    rounds.push({
      round,
      evidenceId: evidence.id,
      strategy: "model",
      changed: repair.changed,
      checkPassed: checked.passed,
    });
    if (checked.passed) return { status: "fixed", rounds, blocker: null };
    lastUnchangedEvidence =
      !repair.changed || checked.evidence.id === evidence.id
        ? evidence.id
        : null;
    evidence = checked.evidence;
  }
  return {
    status: "exhausted",
    rounds,
    blocker: "AutoFix reached the three-round repair limit.",
  };
}
