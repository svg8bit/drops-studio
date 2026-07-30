import { createHash } from "node:crypto";

import { findArtifactSecrets } from "../../artifact-security.ts";
import type { AgentRunTrace } from "./types.ts";

export const FAILURE_CLUSTERING_VERSION = "3.0.0";

export interface FailureClusteringFeature {
  traceId: string;
  tenantScopeHash: string;
  occurredAt: string;
  failureClasses: string[];
  sanitizedErrorText: string;
  stackSymbols: string[];
  affectedPathCategories: string[];
  roles: string[];
  models: string[];
  toolSequence: string[];
  contextMissTypes: string[];
  projectCategory: string;
  integrationCategories: string[];
  repairOutcome: "verified" | "failed" | "not-attempted";
  buildStage: string;
  deterministicFixerIds: string[];
  criticalSecurity: boolean;
}

export type FailureClusterAction =
  | "benchmark"
  | "deterministic-fixer"
  | "skill-update"
  | "context-source-update"
  | "router-experiment"
  | "prompt-experiment"
  | "provider-bug"
  | "product-ux";

export interface FailureCluster {
  clusterId: string;
  version: string;
  memberTraceIds: string[];
  size: number;
  dominantFailureClasses: string[];
  dominantRoles: string[];
  representativeEvidenceIds: string[];
  summary: string;
  suspectedRootCauses: string[];
  verifiedRepairCount: number;
  candidateActions: FailureClusterAction[];
  confidence: number;
  outlier: boolean;
}

export interface FailureClusteringReport {
  version: string;
  configHash: string;
  tenantScopeHash: string;
  inputTraceCount: number;
  clusters: FailureCluster[];
  quality: {
    clusterCount: number;
    outlierCount: number;
    outlierRatio: number;
    averageCohesion: number;
  };
}

export interface FailureClusteringConfig {
  minimumClusterSize: number;
  similarityThreshold: number;
}

const DEFAULT_CONFIG: FailureClusteringConfig = Object.freeze({
  minimumClusterSize: 2,
  similarityThreshold: 0.42,
});

const SAFE_ID = /^[a-z0-9][a-z0-9:._/-]{0,191}$/i;
const SAFE_HASH = /^[a-f0-9]{32,128}$/;
const SAFE_SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$.:/-]{0,159}$/;
const STOP_WORDS = new Set([
  "and", "the", "for", "from", "with", "that", "this", "was", "were",
  "error", "failed", "failure", "cannot", "could", "into", "when", "while",
]);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedUnique(values: readonly string[], label: string, max = 32): string[] {
  if (values.length > max) throw new Error(`${label} exceeds its bounded feature count.`);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .map((value) => {
      if (!SAFE_ID.test(value)) throw new Error(`${label} contains an unsafe feature.`);
      return value.slice(0, 192);
    })
    .sort();
}

function sanitizeFeature(input: FailureClusteringFeature): FailureClusteringFeature {
  if (!SAFE_ID.test(input.traceId)) throw new Error("Failure trace id is invalid.");
  if (!SAFE_HASH.test(input.tenantScopeHash)) throw new Error("Failure tenant scope is invalid.");
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error("Failure occurrence time is invalid.");
  if (input.sanitizedErrorText.length > 2_000) throw new Error("Sanitized error text exceeds its bound.");
  if (findArtifactSecrets(JSON.stringify(input), "failure clustering feature").length) {
    throw new Error("Failure clustering input contains credential-like material.");
  }
  const stackSymbols = [...new Set(input.stackSymbols.map((value) => value.trim()).filter(Boolean))];
  if (stackSymbols.length > 32 || stackSymbols.some((value) => !SAFE_SYMBOL.test(value))) {
    throw new Error("Failure stack symbols must be bounded identifiers without source bodies.");
  }
  return {
    ...structuredClone(input),
    failureClasses: boundedUnique(input.failureClasses, "Failure classes", 8),
    sanitizedErrorText: input.sanitizedErrorText.replace(/[\r\n\t]+/g, " ").trim(),
    stackSymbols: stackSymbols.sort(),
    affectedPathCategories: boundedUnique(input.affectedPathCategories, "Path categories", 16),
    roles: boundedUnique(input.roles, "Roles", 16),
    models: boundedUnique(input.models, "Models", 16),
    toolSequence: boundedUnique(input.toolSequence, "Tool sequence", 32),
    contextMissTypes: boundedUnique(input.contextMissTypes, "Context miss types", 16),
    projectCategory: boundedUnique([input.projectCategory], "Project category", 1)[0] ?? "unknown",
    integrationCategories: boundedUnique(input.integrationCategories, "Integration categories", 12),
    buildStage: boundedUnique([input.buildStage], "Build stage", 1)[0] ?? "unknown",
    deterministicFixerIds: boundedUnique(input.deterministicFixerIds, "Fixer ids", 16),
  };
}

function lexicalTokens(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9._/-]{2,}/g)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? [],
  )].sort();
}

function featureSet(feature: FailureClusteringFeature): Set<string> {
  const values = [
    ...feature.failureClasses.map((value) => `failure:${value}`),
    ...lexicalTokens(feature.sanitizedErrorText).map((value) => `error:${value}`),
    ...feature.stackSymbols.map((value) => `symbol:${value}`),
    ...feature.affectedPathCategories.map((value) => `path:${value}`),
    ...feature.roles.map((value) => `role:${value}`),
    ...feature.models.map((value) => `model:${value}`),
    ...feature.toolSequence.map((value) => `tool:${value}`),
    ...feature.contextMissTypes.map((value) => `context:${value}`),
    `project:${feature.projectCategory}`,
    ...feature.integrationCategories.map((value) => `integration:${value}`),
    `stage:${feature.buildStage}`,
    ...feature.deterministicFixerIds.map((value) => `fixer:${value}`),
  ];
  return new Set(values);
}

function cosineBinary(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return overlap / Math.sqrt(left.size * right.size);
}

function dominant(values: readonly string[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function cohesion(members: FailureClusteringFeature[]): number {
  if (members.length < 2) return members.length ? 1 : 0;
  let sum = 0;
  let pairs = 0;
  const sets = members.map(featureSet);
  for (let left = 0; left < sets.length; left += 1) {
    for (let right = left + 1; right < sets.length; right += 1) {
      sum += cosineBinary(sets[left], sets[right]);
      pairs += 1;
    }
  }
  return pairs ? sum / pairs : 0;
}

function actions(members: FailureClusteringFeature[], outlier: boolean): FailureClusterAction[] {
  if (outlier) return [];
  const values = new Set<FailureClusterAction>();
  const verified = members.filter((member) => member.repairOutcome === "verified").length;
  if (members.length >= 3 || members.some((member) => member.criticalSecurity)) values.add("benchmark");
  if (verified >= 5 && dominant(members.flatMap((member) => member.deterministicFixerIds), 1).length) {
    values.add("deterministic-fixer");
  }
  if (members.some((member) => member.contextMissTypes.length)) {
    values.add("context-source-update");
    values.add("skill-update");
  } else if (members.length >= 3) {
    values.add("prompt-experiment");
  }
  if (new Set(members.flatMap((member) => member.models)).size > 1 && members.length >= 4) {
    values.add("router-experiment");
  }
  if (members.some((member) => member.failureClasses.includes("provider"))) values.add("provider-bug");
  if (members.some((member) => ["browser", "responsive", "accessibility"].includes(member.buildStage))) {
    values.add("product-ux");
  }
  return [...values].sort();
}

function buildCluster(members: FailureClusteringFeature[], configHash: string, outlier = false): FailureCluster {
  const ids = members.map((member) => member.traceId).sort();
  const failureClasses = members.flatMap((member) => member.failureClasses);
  const roles = members.flatMap((member) => member.roles);
  const contextMisses = dominant(members.flatMap((member) => member.contextMissTypes));
  const fixers = dominant(members.flatMap((member) => member.deterministicFixerIds));
  const rootCauses = [
    ...contextMisses.map((value) => `context-miss:${value}`),
    ...fixers.map((value) => `repeated-fixer:${value}`),
    ...dominant(failureClasses).map((value) => `failure:${value}`),
  ].slice(0, 6);
  const confidence = outlier ? 0 : cohesion(members);
  return {
    clusterId: outlier
      ? `outliers-${hash(`${configHash}:${ids.join(",")}`).slice(0, 16)}`
      : `cluster-${hash(`${configHash}:${ids.join(",")}`).slice(0, 16)}`,
    version: FAILURE_CLUSTERING_VERSION,
    memberTraceIds: ids,
    size: ids.length,
    dominantFailureClasses: dominant(failureClasses),
    dominantRoles: dominant(roles),
    representativeEvidenceIds: ids.slice(0, 3),
    summary: outlier
      ? `${ids.length} low-support sanitized failure traces remain in the outlier bucket.`
      : `${ids.length} sanitized traces share ${dominant(failureClasses).join(", ") || "unknown"} failure evidence.`,
    suspectedRootCauses: rootCauses,
    verifiedRepairCount: members.filter((member) => member.repairOutcome === "verified").length,
    candidateActions: actions(members, outlier),
    confidence: Number(confidence.toFixed(4)),
    outlier,
  };
}

export function clusterFailureFeatures(
  input: readonly FailureClusteringFeature[],
  configuration: Partial<FailureClusteringConfig> = {},
): FailureClusteringReport {
  if (!input.length) throw new Error("Failure clustering requires at least one sanitized trace.");
  if (input.length > 10_000) throw new Error("Failure clustering input exceeds its run limit.");
  const config = { ...DEFAULT_CONFIG, ...configuration };
  if (!Number.isSafeInteger(config.minimumClusterSize) || config.minimumClusterSize < 2 || config.minimumClusterSize > 100) {
    throw new Error("Failure clustering minimum size is invalid.");
  }
  if (!Number.isFinite(config.similarityThreshold) || config.similarityThreshold <= 0 || config.similarityThreshold > 1) {
    throw new Error("Failure clustering similarity threshold is invalid.");
  }
  const features = input.map(sanitizeFeature).sort((left, right) => left.traceId.localeCompare(right.traceId));
  if (new Set(features.map((feature) => feature.traceId)).size !== features.length) {
    throw new Error("Failure clustering trace ids must be unique.");
  }
  const tenants = new Set(features.map((feature) => feature.tenantScopeHash));
  if (tenants.size !== 1) throw new Error("Failure clustering cannot mix tenant scopes.");
  const configHash = hash(JSON.stringify(config));
  const groups: FailureClusteringFeature[][] = [];
  for (const feature of features) {
    const current = featureSet(feature);
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < groups.length; index += 1) {
      const score = Math.max(...groups[index].map((member) => cosineBinary(current, featureSet(member))));
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestScore >= config.similarityThreshold) groups[bestIndex].push(feature);
    else groups.push([feature]);
  }
  const supported = groups.filter((group) => group.length >= config.minimumClusterSize);
  const outliers = groups.filter((group) => group.length < config.minimumClusterSize).flat();
  const clusters = supported.map((group) => buildCluster(group, configHash));
  if (outliers.length) clusters.push(buildCluster(outliers, configHash, true));
  clusters.sort((left, right) => Number(left.outlier) - Number(right.outlier) || right.size - left.size || left.clusterId.localeCompare(right.clusterId));
  const nonOutliers = clusters.filter((cluster) => !cluster.outlier);
  return {
    version: FAILURE_CLUSTERING_VERSION,
    configHash,
    tenantScopeHash: features[0].tenantScopeHash,
    inputTraceCount: features.length,
    clusters,
    quality: {
      clusterCount: nonOutliers.length,
      outlierCount: outliers.length,
      outlierRatio: Number((outliers.length / features.length).toFixed(4)),
      averageCohesion: Number((nonOutliers.reduce((sum, cluster) => sum + cluster.confidence, 0) / Math.max(1, nonOutliers.length)).toFixed(4)),
    },
  };
}

function pathCategory(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = normalized.split("/")[0] || "root";
  const extension = normalized.includes(".") ? normalized.split(".").at(-1) : "none";
  return `${root}-${extension}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 80);
}

export function traceToFailureFeature(trace: AgentRunTrace): FailureClusteringFeature {
  const errorText = trace.findings.map((finding) => finding.title).join("; ").slice(0, 2_000);
  return sanitizeFeature({
    traceId: trace.traceId,
    tenantScopeHash: trace.actorHash,
    occurredAt: trace.finishedAt,
    failureClasses: trace.failureClass === "none" ? ["none"] : [trace.failureClass],
    sanitizedErrorText: errorText,
    stackSymbols: [],
    affectedPathCategories: [
      ...trace.findings.flatMap((finding) => finding.relevantPaths),
      ...trace.repairs.flatMap((repair) => repair.changedFiles),
    ].map(pathCategory),
    roles: [
      ...trace.routes.map((route) => route.role),
      ...trace.roleRuns.map((run) => run.role),
    ],
    models: trace.routes.map((route) => `${route.provider}/${route.model}`),
    toolSequence: trace.roleRuns.map((run) => run.role),
    contextMissTypes: trace.contextPackages.flatMap((context) => context.omittedReasons),
    projectCategory: trace.configurationId,
    integrationCategories: trace.findings
      .map((finding) => finding.category)
      .filter((value) => /dropstab|dropsbot|telegram|integration/i.test(value)),
    repairOutcome: trace.repairs.some((repair) => repair.result === "passed")
      ? "verified"
      : trace.repairs.length
        ? "failed"
        : "not-attempted",
    buildStage: trace.checks.find((check) => check.status === "failed")?.name ?? "complete",
    deterministicFixerIds: trace.repairs
      .filter((repair) => repair.strategy === "deterministic")
      .map((repair) => `repair-${repair.failureClass}`),
    criticalSecurity: trace.status === "unsafe" || trace.findings.some((finding) => finding.severity === "critical"),
  });
}

export function clusterAgentRunTraces(
  traces: readonly AgentRunTrace[],
  configuration?: Partial<FailureClusteringConfig>,
): FailureClusteringReport {
  return clusterFailureFeatures(traces.map(traceToFailureFeature), configuration);
}
