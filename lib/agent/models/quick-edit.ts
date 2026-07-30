export interface PatchBundle {
  baseRevision: string;
  taskId: string;
  files: Array<{
    path: string;
    expectedHash: string | null;
    operation: "create" | "patch" | "delete" | "rename";
    patch?: string;
    content?: string;
    newPath?: string;
  }>;
  testsToRun: string[];
  summary: string[];
}

export interface QuickEditLimits {
  maxFiles: number;
  maxChangedLines: number;
  maxToolRounds: number;
  maxOutputTokens: number;
}

export const DEFAULT_QUICK_EDIT_LIMITS: QuickEditLimits = {
  maxFiles: 4,
  maxChangedLines: 160,
  maxToolRounds: 4,
  maxOutputTokens: 6_000,
};

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[^\\]+$/;

function changedLines(file: PatchBundle["files"][number]): number {
  if (file.content !== undefined) return file.content.split("\n").length;
  if (!file.patch) return 1;
  return file.patch
    .split("\n")
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"))
    .length;
}

export function evaluateQuickEditPatch(
  bundle: PatchBundle,
  input: {
    expectedRevision: string;
    allowedPaths: string[];
    introducesDependency?: boolean;
    focusedCheckFailures?: number;
    limits?: Partial<QuickEditLimits>;
  },
): { accepted: boolean; escalate: boolean; reasons: string[]; changedLines: number } {
  const limits = { ...DEFAULT_QUICK_EDIT_LIMITS, ...input.limits };
  const reasons: string[] = [];
  if (bundle.baseRevision !== input.expectedRevision) reasons.push("STALE_REVISION");
  if (bundle.files.length > limits.maxFiles) reasons.push("FILE_SCOPE_EXCEEDED");
  const totalChangedLines = bundle.files.reduce((total, file) => total + changedLines(file), 0);
  if (totalChangedLines > limits.maxChangedLines) reasons.push("LINE_SCOPE_EXCEEDED");
  if (input.introducesDependency) reasons.push("DEPENDENCY_CHANGE");
  if ((input.focusedCheckFailures ?? 0) >= 2) reasons.push("REPEATED_CHECK_FAILURE");
  const allowed = new Set(input.allowedPaths);
  for (const file of bundle.files) {
    if (!SAFE_PATH.test(file.path) || !allowed.has(file.path)) reasons.push("OUT_OF_SCOPE_PATH");
    if (file.newPath && (!SAFE_PATH.test(file.newPath) || !allowed.has(file.newPath))) {
      reasons.push("OUT_OF_SCOPE_PATH");
    }
  }
  const uniqueReasons = [...new Set(reasons)];
  return {
    accepted: uniqueReasons.length === 0,
    escalate: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    changedLines: totalChangedLines,
  };
}
