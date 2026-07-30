import { compileProject } from "./project-compiler.ts";
import { evaluateServerReleaseQuality } from "./server-release-quality.ts";
import type {
  GeneratedProjectSpec,
  ProjectProvider,
  ProjectQualityReport,
} from "./project-types.ts";
import { applyEnhancement, validateProjectSpec } from "./project-validator.ts";

export const FREE_COMPILER_MODEL = "Free compiler";
export const BUILD_RUN_MAX_MODEL_CALLS = 2;
export const BUILD_RUN_TIME_BUDGET_MS = 45_000;

const MODEL_CALL_TIMEOUT_MS = 22_000;

export type BuildRunStatus =
  | "compiled"
  | "enhanced"
  | "repaired"
  | "fallback"
  | "incomplete";
export type BuildRunTraceStatus = "succeeded" | "failed" | "skipped";
export type BuildRunTraceAction =
  | "validate-input"
  | "model-enhance"
  | "validate-enhancement"
  | "compile"
  | "inspect"
  | "model-repair"
  | "validate-repair"
  | "finalize";

export interface BuildRunTraceEntry {
  action: BuildRunTraceAction;
  status: BuildRunTraceStatus;
  attempt: 0 | 1 | 2;
  durationMs: number;
  detail: string;
  modelCall?: 1 | 2;
  criticalFailures?: string[];
}

export interface BuildRunModelCall {
  mode: "enhance" | "repair";
  spec: GeneratedProjectSpec;
  prompt: string;
  provider: ProjectProvider;
  model: string;
  criticalFailures: string[];
  signal: AbortSignal;
}

export interface BuildRunSummary {
  id: string;
  status: BuildRunStatus;
  provider: ProjectProvider;
  model: string;
  enhanced: boolean;
  modelCalls: number;
  maxModelCalls: typeof BUILD_RUN_MAX_MODEL_CALLS;
  timeBudgetMs: number;
  elapsedMs: number;
  trace: BuildRunTraceEntry[];
  fallbackReason?: string;
}

export interface BuildRunResult {
  spec: GeneratedProjectSpec;
  html: string;
  quality: ProjectQualityReport;
  run: BuildRunSummary;
  warning?: string;
}

export class BuildRunFallbackError extends Error {
  readonly trace: BuildRunTraceEntry[];

  constructor(failure: unknown, trace: BuildRunTraceEntry[]) {
    super(`Free compiler artifact could not be produced (${safeError(failure)}).`);
    this.name = "BuildRunFallbackError";
    this.trace = trace.map((entry) => ({
      ...entry,
      ...(entry.criticalFailures ? { criticalFailures: [...entry.criticalFailures] } : {}),
    }));
  }
}

export interface RunBuildRunOptions {
  spec: GeneratedProjectSpec;
  prompt: string;
  provider: ProjectProvider;
  model: string;
  callModel: (input: BuildRunModelCall) => Promise<unknown>;
  timeBudgetMs?: number;
}

export interface RunValidatedBuildOptions {
  spec: GeneratedProjectSpec;
  timeBudgetMs?: number;
}

const allowedNestedFields = {
  theme: new Set(["accent", "surface", "mode", "style"]),
  design: new Set(["kit", "density", "motion", "radius", "font"]),
  experience: new Set(["layout", "dataView", "engagement", "audience", "primaryLoop", "modules"]),
  gameDirection: new Set(["genre", "artStyle", "world", "mascot", "gameLoop", "difficulty", "roundSeconds", "sound"]),
} as const;

function durationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown model response error";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 180) || "Unknown model response error";
}

function freeCompilerSpec(value: unknown): GeneratedProjectSpec {
  const spec = validateProjectSpec(value);
  return validateProjectSpec({
    ...spec,
    brain: {
      provider: "free",
      model: FREE_COMPILER_MODEL,
      enhanced: false,
    },
  });
}

function boundedObject(value: unknown, allowedFields: ReadonlySet<string>): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const entries = Object.entries(input).filter(([key]) => allowedFields.has(key));
  return entries.length ? Object.fromEntries(entries) : null;
}

function boundedEnhancement(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The model did not return a project design object.");
  }
  const input = value as Record<string, unknown>;
  const enhancement: Record<string, unknown> = {};
  for (const key of ["name", "tagline", "description"] as const) {
    if (typeof input[key] === "string" && input[key].trim()) enhancement[key] = input[key];
  }
  for (const key of ["theme", "design", "experience", "gameDirection"] as const) {
    const nested = boundedObject(input[key], allowedNestedFields[key]);
    if (nested) enhancement[key] = nested;
  }
  if (!Object.keys(enhancement).length) {
    throw new Error("The model response did not contain supported project fields.");
  }
  return enhancement;
}

function specContent(spec: GeneratedProjectSpec): string {
  return JSON.stringify({
    ...spec,
    brain: { provider: "free", model: "", enhanced: false },
  });
}

function applyValidModelResponse(
  spec: GeneratedProjectSpec,
  response: unknown,
  provider: ProjectProvider,
  model: string,
): GeneratedProjectSpec {
  const enhanced = applyEnhancement(spec, boundedEnhancement(response));
  if (specContent(enhanced) === specContent(spec)) {
    throw new Error("The model response did not produce a supported project change.");
  }
  return validateProjectSpec({
    ...enhanced,
    brain: { provider, model, enhanced: true },
  });
}

function boundedBudget(value: number | undefined): number {
  if (!Number.isFinite(value)) return BUILD_RUN_TIME_BUDGET_MS;
  return Math.min(BUILD_RUN_TIME_BUDGET_MS, Math.max(1, Math.floor(value as number)));
}

function budgetSignal(startedAt: number, timeBudgetMs: number): AbortSignal {
  const remaining = timeBudgetMs - durationMs(startedAt);
  if (remaining <= 0) throw new Error("BuildRun time budget was exhausted.");
  return AbortSignal.timeout(Math.max(1, Math.min(MODEL_CALL_TIMEOUT_MS, remaining)));
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Model call timed out."));
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function artifact(
  spec: GeneratedProjectSpec,
  attempt: 1 | 2,
  trace: BuildRunTraceEntry[],
): { html: string; quality: ProjectQualityReport } {
  const compileStarted = Date.now();
  let html: string;
  try {
    html = compileProject(spec);
    trace.push({
      action: "compile",
      status: "succeeded",
      attempt,
      durationMs: durationMs(compileStarted),
      detail: `Compiled ${html.length} bytes of standalone HTML.`,
    });
  } catch (error) {
    trace.push({
      action: "compile",
      status: "failed",
      attempt,
      durationMs: durationMs(compileStarted),
      detail: safeError(error),
      criticalFailures: ["compile"],
    });
    throw error;
  }

  const inspectStarted = Date.now();
  try {
    const quality = evaluateServerReleaseQuality(spec, html, "unverified");
    trace.push({
      action: "inspect",
      status: "succeeded",
      attempt,
      durationMs: durationMs(inspectStarted),
      detail: `Release inspection scored ${quality.score}/100.`,
      criticalFailures: quality.criticalFailures,
    });
    return { html, quality };
  } catch (error) {
    trace.push({
      action: "inspect",
      status: "failed",
      attempt,
      durationMs: durationMs(inspectStarted),
      detail: safeError(error),
      criticalFailures: ["inspect"],
    });
    throw error;
  }
}

function releaseFailures(quality: ProjectQualityReport): string[] {
  if (quality.criticalFailures.length) return quality.criticalFailures;
  return quality.checks.filter((check) => !check.passed).map((check) => check.id);
}

function summary(
  status: BuildRunStatus,
  spec: GeneratedProjectSpec,
  startedAt: number,
  timeBudgetMs: number,
  modelCalls: number,
  trace: BuildRunTraceEntry[],
  fallbackReason?: string,
): BuildRunSummary {
  return {
    id: crypto.randomUUID(),
    status,
    provider: spec.brain.provider,
    model: spec.brain.model,
    enhanced: spec.brain.enhanced,
    modelCalls,
    maxModelCalls: BUILD_RUN_MAX_MODEL_CALLS,
    timeBudgetMs,
    elapsedMs: durationMs(startedAt),
    trace,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export async function runBuildRun(options: RunBuildRunOptions): Promise<BuildRunResult> {
  const startedAt = Date.now();
  const timeBudgetMs = boundedBudget(options.timeBudgetMs);
  const trace: BuildRunTraceEntry[] = [];
  let modelCalls = 0;

  const validationStarted = Date.now();
  const fallbackSpec = freeCompilerSpec(options.spec);
  trace.push({
    action: "validate-input",
    status: "succeeded",
    attempt: 0,
    durationMs: durationMs(validationStarted),
    detail: "Validated the input and reset attribution to the deterministic Free compiler.",
  });

  const fallback = (reason: unknown): BuildRunResult => {
    const detail = safeError(reason);
    let built: { html: string; quality: ProjectQualityReport };
    try {
      built = artifact(fallbackSpec, 1, trace);
    } catch (error) {
      const artifactFailures = trace.at(-1)?.criticalFailures ?? ["compile"];
      trace.push({
        action: "finalize",
        status: "failed",
        attempt: 1,
        durationMs: 0,
        detail: "The deterministic Free compiler artifact could not be produced.",
        criticalFailures: artifactFailures,
      });
      throw new BuildRunFallbackError(error, trace);
    }
    trace.push({
      action: "finalize",
      status: "succeeded",
      attempt: 1,
      durationMs: 0,
      detail: "Finalized a validated Free compiler artifact.",
    });
    return {
      spec: fallbackSpec,
      ...built,
      run: summary("fallback", fallbackSpec, startedAt, timeBudgetMs, modelCalls, trace, detail),
      warning: `AI enhancement was not applied (${detail}). Free compiler produced the validated build.`,
    };
  };

  let enhancedSpec: GeneratedProjectSpec;
  const enhanceStarted = Date.now();
  try {
    const signal = budgetSignal(startedAt, timeBudgetMs);
    modelCalls += 1;
    const response = await abortable(options.callModel({
      mode: "enhance",
      spec: fallbackSpec,
      prompt: options.prompt,
      provider: options.provider,
      model: options.model,
      criticalFailures: [],
      signal,
    }), signal);
    enhancedSpec = applyValidModelResponse(fallbackSpec, response, options.provider, options.model);
    trace.push({
      action: "model-enhance",
      status: "succeeded",
      attempt: 1,
      modelCall: 1,
      durationMs: durationMs(enhanceStarted),
      detail: "Accepted one bounded provider response.",
    });
  } catch (error) {
    trace.push({
      action: "model-enhance",
      status: "failed",
      attempt: 1,
      modelCall: modelCalls ? 1 : undefined,
      durationMs: durationMs(enhanceStarted),
      detail: safeError(error),
    });
    return fallback(error);
  }

  trace.push({
    action: "validate-enhancement",
    status: "succeeded",
    attempt: 1,
    durationMs: 0,
    detail: "Validated supported fields before assigning provider attribution.",
  });

  let firstArtifact: { html: string; quality: ProjectQualityReport };
  try {
    firstArtifact = artifact(enhancedSpec, 1, trace);
  } catch (error) {
    return fallback(error);
  }

  if (firstArtifact.quality.readyToPublish) {
    trace.push({
      action: "finalize",
      status: "succeeded",
      attempt: 1,
      durationMs: 0,
      detail: "Finalized the first validated enhancement.",
    });
    return {
      spec: enhancedSpec,
      ...firstArtifact,
      run: summary("enhanced", enhancedSpec, startedAt, timeBudgetMs, modelCalls, trace),
    };
  }

  const failures = releaseFailures(firstArtifact.quality);
  let repairedSpec: GeneratedProjectSpec;
  const repairStarted = Date.now();
  try {
    if (modelCalls >= BUILD_RUN_MAX_MODEL_CALLS) throw new Error("BuildRun model-call budget was exhausted.");
    const signal = budgetSignal(startedAt, timeBudgetMs);
    modelCalls += 1;
    const response = await abortable(options.callModel({
      mode: "repair",
      spec: enhancedSpec,
      prompt: options.prompt,
      provider: options.provider,
      model: options.model,
      criticalFailures: failures,
      signal,
    }), signal);
    repairedSpec = applyValidModelResponse(enhancedSpec, response, options.provider, options.model);
    trace.push({
      action: "model-repair",
      status: "succeeded",
      attempt: 2,
      modelCall: 2,
      durationMs: durationMs(repairStarted),
      detail: "Accepted the single bounded repair response.",
      criticalFailures: failures,
    });
    trace.push({
      action: "validate-repair",
      status: "succeeded",
      attempt: 2,
      durationMs: 0,
      detail: "Validated the repair while preserving the successful provider attribution.",
    });
  } catch (error) {
    trace.push({
      action: "model-repair",
      status: modelCalls >= BUILD_RUN_MAX_MODEL_CALLS ? "failed" : "skipped",
      attempt: 2,
      modelCall: modelCalls >= BUILD_RUN_MAX_MODEL_CALLS ? 2 : undefined,
      durationMs: durationMs(repairStarted),
      detail: safeError(error),
      criticalFailures: failures,
    });
    trace.push({
      action: "finalize",
      status: "succeeded",
      attempt: 1,
      durationMs: 0,
      detail: "Retained the last validated enhancement after repair did not complete.",
      criticalFailures: failures,
    });
    return {
      spec: enhancedSpec,
      ...firstArtifact,
      run: summary("incomplete", enhancedSpec, startedAt, timeBudgetMs, modelCalls, trace),
      warning: `Release inspection still needs attention (${failures.join(", ")}).`,
    };
  }

  let repairedArtifact: { html: string; quality: ProjectQualityReport };
  try {
    repairedArtifact = artifact(repairedSpec, 2, trace);
  } catch (error) {
    trace.push({
      action: "finalize",
      status: "succeeded",
      attempt: 1,
      durationMs: 0,
      detail: "Retained the first validated artifact after repair compilation failed.",
      criticalFailures: ["compile"],
    });
    return {
      spec: enhancedSpec,
      ...firstArtifact,
      run: summary("incomplete", enhancedSpec, startedAt, timeBudgetMs, modelCalls, trace),
      warning: `The single repair did not compile (${safeError(error)}).`,
    };
  }

  const status: BuildRunStatus = repairedArtifact.quality.readyToPublish ? "repaired" : "incomplete";
  const finalFailures = releaseFailures(repairedArtifact.quality);
  trace.push({
    action: "finalize",
    status: "succeeded",
    attempt: 2,
    durationMs: 0,
    detail: status === "repaired"
      ? "Finalized the validated repaired artifact."
      : "Stopped after the single bounded repair.",
    ...(status === "incomplete" ? { criticalFailures: finalFailures } : {}),
  });
  return {
    spec: repairedSpec,
    ...repairedArtifact,
    run: summary(status, repairedSpec, startedAt, timeBudgetMs, modelCalls, trace),
    ...(status === "incomplete" ? { warning: `Release inspection still needs attention (${finalFailures.join(", ")}).` } : {}),
  };
}

/**
 * Runs the same server-side validation, compilation and release inspection for
 * a plan that was already produced by the platform planner. This keeps every
 * Build action on the authoritative BuildRun path without spending a second
 * model call merely to rewrite an already validated plan.
 */
export async function runValidatedBuild(
  options: RunValidatedBuildOptions,
): Promise<BuildRunResult> {
  const startedAt = Date.now();
  const timeBudgetMs = boundedBudget(options.timeBudgetMs);
  const trace: BuildRunTraceEntry[] = [];
  const validationStarted = Date.now();
  const spec = validateProjectSpec(options.spec);
  trace.push({
    action: "validate-input",
    status: "succeeded",
    attempt: 0,
    durationMs: durationMs(validationStarted),
    detail: "Validated the planned product specification before compilation.",
  });

  let built: { html: string; quality: ProjectQualityReport };
  try {
    built = artifact(spec, 1, trace);
  } catch (error) {
    trace.push({
      action: "finalize",
      status: "failed",
      attempt: 1,
      durationMs: 0,
      detail: safeError(error),
      criticalFailures: trace.at(-1)?.criticalFailures ?? ["compile"],
    });
    throw new BuildRunFallbackError(error, trace);
  }

  const failures = releaseFailures(built.quality);
  const ready = built.quality.readyToPublish;
  trace.push({
    action: "finalize",
    status: ready ? "succeeded" : "failed",
    attempt: 1,
    durationMs: 0,
    detail: ready
      ? "Finalized the planned product after authoritative release inspection."
      : "The planned product still has release-inspection failures.",
    ...(ready ? {} : { criticalFailures: failures }),
  });
  return {
    spec,
    ...built,
    run: summary(
      ready ? "compiled" : "incomplete",
      spec,
      startedAt,
      timeBudgetMs,
      0,
      trace,
    ),
    ...(ready
      ? {}
      : {
          warning: `Release inspection still needs attention (${failures.join(", ")}).`,
        }),
  };
}
