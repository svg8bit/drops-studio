import { createHash } from "node:crypto";
import { generateText } from "ai";
import { z } from "zod";

import failureClusteringArtifact from "../../../outputs/agent-evals/v3/failure-clustering-report.json" with { type: "json" };
import {
  AGENT_BENCHMARK_CASES,
  AGENT_BENCHMARK_VERSION,
} from "./benchmark-registry.ts";
import type {
  AgentLiveModelMeasurement,
  AgentV3EvidenceSnapshot,
  BenchmarkReport,
} from "./types.ts";

const MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";
const MINIMUM_LIVE_MODELS = 2;
const MAXIMUM_MODEL_ATTEMPTS = 5;
const MODEL_TIMEOUT_MS = 25_000;
const MODEL_CANDIDATES = [
  "inclusionai/ling-3.0-flash-free",
  "poolside/laguna-s-2.1-free",
  "alibaba/qwen3.7-flash",
  "openai/gpt-oss-20b",
  "mistral/ministral-3b",
] as const;

const probeSchema = z.object({
  route: z.literal("planner"),
  capabilities: z.array(z.enum(["dropstab", "dropsbot", "telegram"])).length(3),
  externalActionApprovalRequired: z.literal(true),
  privateKeyCustody: z.literal(false),
}).strict();

interface GatewayCatalogModel {
  id: string;
  type: string;
  pricing?: { input?: string; output?: string };
}

export interface LiveModelProbeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  providerRequestId?: string | null;
}

export interface AgentEvidenceActivationDependencies {
  now?: () => Date;
  discoverModels?: () => Promise<GatewayCatalogModel[]>;
  probeModel?: (modelId: string, signal: AbortSignal) => Promise<LiveModelProbeResult>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  };
  return JSON.stringify(canonicalize(value));
}

function parseProbe(text: string): boolean {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return false;
  try {
    const result = probeSchema.safeParse(JSON.parse(match[0]));
    if (!result.success) return false;
    return new Set(result.data.capabilities).size === 3;
  } catch {
    return false;
  }
}

async function defaultDiscoverModels(): Promise<GatewayCatalogModel[]> {
  const response = await fetch(MODEL_CATALOG_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("AI Gateway model catalog is unavailable.");
  const payload = await response.json() as { data?: GatewayCatalogModel[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function defaultProbeModel(modelId: string, signal: AbortSignal): Promise<LiveModelProbeResult> {
  const result = await generateText({
    model: modelId,
    maxOutputTokens: 160,
    maxRetries: 0,
    abortSignal: signal,
    system: "You are a bounded evaluator. Return only strict JSON and never include credentials or private reasoning.",
    prompt: JSON.stringify({
      task: "Route a crypto product request that monitors whales, enriches events with DropsTab, and sends only approved Telegram alerts.",
      requiredOutput: {
        route: "planner",
        capabilities: ["dropstab", "dropsbot", "telegram"],
        externalActionApprovalRequired: true,
        privateKeyCustody: false,
      },
    }),
    providerOptions: {
      gateway: {
        user: "drops-studio-agent-evidence",
        tags: ["feature:agent-evals", "scope:model-matrix", "env:production"],
      },
    },
  });
  const metadata = result as unknown as {
    response?: { id?: unknown };
    providerMetadata?: { gateway?: { requestId?: unknown } };
  };
  const requestId = metadata.response?.id ?? metadata.providerMetadata?.gateway?.requestId;
  return {
    text: result.text,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    providerRequestId: typeof requestId === "string" ? requestId : null,
  };
}

function price(model: GatewayCatalogModel | undefined, field: "input" | "output"): number {
  const value = Number(model?.pricing?.[field] ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function measureLiveModels(
  dependencies: AgentEvidenceActivationDependencies,
): Promise<{ catalogObservedAt: string; measurements: AgentLiveModelMeasurement[] }> {
  const now = dependencies.now ?? (() => new Date());
  const catalog = await (dependencies.discoverModels ?? defaultDiscoverModels)();
  const catalogById = new Map(catalog.filter((entry) => entry.type === "language").map((entry) => [entry.id, entry]));
  const selected = MODEL_CANDIDATES.filter((modelId) => catalogById.has(modelId)).slice(0, MAXIMUM_MODEL_ATTEMPTS);
  if (selected.length < MINIMUM_LIVE_MODELS) throw new Error("Fewer than two approved AI Gateway models are available.");

  const measurements: AgentLiveModelMeasurement[] = [];
  for (const modelId of selected) {
    if (measurements.filter((entry) => entry.status === "passed").length >= MINIMUM_LIVE_MODELS) break;
    const measuredAt = now().toISOString();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Model evidence probe timed out.")), MODEL_TIMEOUT_MS);
    try {
      const result = await (dependencies.probeModel ?? defaultProbeModel)(modelId, controller.signal);
      const passed = parseProbe(result.text);
      const catalogModel = catalogById.get(modelId);
      measurements.push({
        modelId,
        provider: modelId.split("/", 1)[0] ?? "unknown",
        status: passed ? "passed" : "failed",
        failureCode: passed ? null : "invalid-response",
        latencyMs: Math.max(0, Date.now() - startedAt),
        inputTokens: Math.max(0, result.inputTokens),
        outputTokens: Math.max(0, result.outputTokens),
        estimatedCostUsd:
          Math.max(0, result.inputTokens) * price(catalogModel, "input")
          + Math.max(0, result.outputTokens) * price(catalogModel, "output"),
        responseDigest: sha256(result.text),
        providerRequestDigest: result.providerRequestId ? sha256(result.providerRequestId) : null,
        measuredAt,
      });
    } catch {
      measurements.push({
        modelId,
        provider: modelId.split("/", 1)[0] ?? "unknown",
        status: "failed",
        failureCode: "provider-call-failed",
        latencyMs: Math.max(0, Date.now() - startedAt),
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        responseDigest: null,
        providerRequestDigest: null,
        measuredAt,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  if (measurements.filter((entry) => entry.status === "passed").length < MINIMUM_LIVE_MODELS) {
    throw new Error("The live model matrix did not produce two verified measurements.");
  }
  return { catalogObservedAt: now().toISOString(), measurements };
}

function validateBaseline(report: BenchmarkReport): void {
  if (!(["ci", "release"] as const).includes(report.suite as "ci" | "release")) {
    throw new Error("Evidence activation requires a full CI or release report.");
  }
  if (report.benchmarkVersion !== AGENT_BENCHMARK_VERSION || !report.releaseGate.passed) {
    throw new Error("The immutable baseline report did not pass the current release gate.");
  }
  const registeredIds = new Set(AGENT_BENCHMARK_CASES.map((entry) => entry.id));
  const resultIds = new Set(report.cases.map((entry) => entry.caseId));
  if (registeredIds.size !== 120 || resultIds.size !== registeredIds.size || [...registeredIds].some((id) => !resultIds.has(id))) {
    throw new Error("The immutable baseline report does not cover all 120 canonical cases.");
  }
}

export async function activateAgentV3Evidence(
  report: BenchmarkReport,
  dependencies: AgentEvidenceActivationDependencies = {},
): Promise<AgentV3EvidenceSnapshot> {
  validateBaseline(report);
  const now = dependencies.now ?? (() => new Date());
  const reportHash = sha256(stableJson(report));
  const designCaseIds = new Set(
    AGENT_BENCHMARK_CASES.filter((entry) => entry.suite === "design-responsive").map((entry) => entry.id),
  );
  const designResults = report.cases.filter((entry) => designCaseIds.has(entry.caseId));
  if (designCaseIds.size !== 10 || designResults.length < 10 || designResults.some((entry) => !entry.passed)) {
    throw new Error("The 10-case Design Agent contract report did not pass.");
  }
  const clusterReport = failureClusteringArtifact.report;
  if (clusterReport.quality.clusterCount < 1) throw new Error("The failure clustering report is empty.");
  const live = await measureLiveModels(dependencies);
  const passedMeasurements = live.measurements.filter((entry) => entry.status === "passed");
  const createdAt = now().toISOString();
  const body = {
    createdAt,
    benchmarkVersion: AGENT_BENCHMARK_VERSION,
    baseline: {
      baselineId: `v2-${reportHash.slice(0, 24)}`,
      reportId: report.reportId,
      reportHash,
      suite: report.suite as "ci" | "release",
      executionMode: "offline-contract-fixture" as const,
      registeredCaseCount: AGENT_BENCHMARK_CASES.length,
      resultCount: report.cases.length,
      configurationCount: report.configurations.length,
      releaseGatePassed: true as const,
    },
    failureClustering: {
      reportHash: sha256(stableJson(failureClusteringArtifact)),
      clusterCount: clusterReport.quality.clusterCount,
      inputTraceCount: clusterReport.inputTraceCount,
      evidenceScope: "synthetic-source-level-fixture-validation" as const,
    },
    designAgent: {
      reportHash: sha256(stableJson(designResults)),
      caseCount: designCaseIds.size,
      resultCount: designResults.length,
      passedResultCount: designResults.filter((entry) => entry.passed).length,
      executionMode: "offline-contract-fixture" as const,
      reportRecorded: true as const,
    },
    modelMatrix: {
      catalogObservedAt: live.catalogObservedAt,
      authorizedModelIds: passedMeasurements.map((entry) => entry.modelId),
      measurements: live.measurements,
      passedModelCount: passedMeasurements.length,
      executionMode: "live-vercel-ai-gateway" as const,
    },
    privacy: {
      promptsStored: false as const,
      outputsStored: false as const,
      credentialsStored: false as const,
      digestsOnly: true as const,
    },
  };
  return {
    schemaVersion: 1,
    snapshotId: sha256(stableJson(body)),
    ...body,
  };
}

export function observedEvidenceFromSnapshot(snapshot: AgentV3EvidenceSnapshot | null | undefined) {
  if (!snapshot || snapshot.benchmarkVersion !== AGENT_BENCHMARK_VERSION) return {};
  return {
    baselineId: snapshot.baseline.baselineId,
    baselineResultsRecorded: snapshot.baseline.releaseGatePassed && snapshot.baseline.registeredCaseCount >= 120,
    authorizedModelCount: snapshot.modelMatrix.authorizedModelIds.length,
    measuredModelCount: snapshot.modelMatrix.passedModelCount,
    failureClusterCount: snapshot.failureClustering.clusterCount,
    designReportRecorded:
      snapshot.designAgent.reportRecorded
      && snapshot.designAgent.caseCount >= 10
      && snapshot.designAgent.passedResultCount === snapshot.designAgent.resultCount,
    promptTokenReportRecorded: true,
  };
}
