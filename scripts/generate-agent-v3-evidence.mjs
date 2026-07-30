import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIRECTORY = resolve(ROOT, "outputs/agent-evals/v3");
const CHECK_MODE = process.argv.includes("--check");
const ALLOWED_ARGUMENTS = new Set(["--check"]);
const unknownArguments = process.argv.slice(2).filter((argument) => !ALLOWED_ARGUMENTS.has(argument));

if (unknownArguments.length) {
  throw new Error(`Unknown evidence generator arguments: ${unknownArguments.join(", ")}.`);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href,
    };
  },
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function countBy(values, key) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const entry = key(value);
      counts.set(entry, (counts.get(entry) ?? 0) + 1);
      return counts;
    }, new Map())]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function pathCategory(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = normalized.split("/")[0] || "root";
  const extension = normalized.includes(".") ? normalized.split(".").at(-1) : "none";
  return `${root}-${extension}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 80);
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, path);
}

async function assertCurrent(path, expected) {
  let actual;
  try {
    actual = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${path} is missing; run the evidence generator without --check.`);
    throw error;
  }
  if (actual !== expected) {
    throw new Error(`${path} is stale; run the evidence generator without --check.`);
  }
}

const [prompts, skills, benchmarks, repairs, clustering] = await Promise.all([
  import("../lib/agent/prompts/index.ts"),
  import("../lib/agent/skills/index.ts"),
  import("../lib/agent/evals/benchmark-registry.ts"),
  import("../lib/agent/repairs/index.ts"),
  import("../lib/agent/evals/failure-clustering.ts"),
]);

const core = await prompts.loadCompactCorePrompt();
const roleDocuments = await Promise.all(
  prompts.AGENT_PROMPT_ROLES.map((role) => prompts.loadRolePrompt(role)),
);
const runtimeSkills = skills.runtimeSkillRegistry();
const compactCoreArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-compact-core-metrics",
  evidenceScope: "repository-source-metrics",
  core: {
    mode: core.mode,
    version: core.version,
    sourcePath: core.sourcePath,
    contentHash: core.contentHash,
    byteCount: Buffer.byteLength(core.content, "utf8"),
    lineCount: core.lineCount,
    estimatedTokens: core.estimatedTokens,
  },
  roles: {
    count: roleDocuments.length,
    aggregateHash: sha256(stableJson(roleDocuments.map((role) => ({
      id: role.role,
      version: role.version,
      sourcePath: role.sourcePath,
      contentHash: role.contentHash,
      lineCount: role.lineCount,
      estimatedTokens: role.estimatedTokens,
    })))),
    items: roleDocuments.map((role) => ({
      id: role.role,
      version: role.version,
      sourcePath: role.sourcePath,
      contentHash: role.contentHash,
      lineCount: role.lineCount,
      estimatedTokens: role.estimatedTokens,
    })),
  },
  runtimeSkills: {
    count: runtimeSkills.length,
    aggregateHash: sha256(stableJson(runtimeSkills.map((skill) => ({
      id: skill.id,
      version: skill.version,
      contentHash: skill.contentHash,
      estimatedTokens: skill.estimatedTokens,
    })))),
  },
  activation: {
    productionDefaultChanged: false,
    compactCoreFlag: "DROPS_AGENT_COMPACT_CORE_ENABLED",
    legacyFallbackFlag: "DROPS_AGENT_LEGACY_CORE_FALLBACK",
  },
};

const benchmarkCatalog = benchmarks.AGENT_BENCHMARK_CASES.map((entry, ordinal) => ({
  ordinal,
  ...structuredClone(entry),
  definitionHash: sha256(stableJson(entry)),
}));
const benchmarkDistribution = countBy(benchmarkCatalog, (entry) => entry.suite);
const expectedDistribution = Object.fromEntries(
  Object.entries(benchmarks.BENCHMARK_DISTRIBUTION_V3).sort(([left], [right]) => left.localeCompare(right)),
);
if (stableJson(benchmarkDistribution) !== stableJson(expectedDistribution)) {
  throw new Error("Canonical benchmark distribution does not match the V3 contract.");
}
const benchmarkCatalogArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-benchmark-catalog",
  benchmarkVersion: benchmarks.AGENT_BENCHMARK_VERSION,
  evidenceScope: "validated-repository-owned-case-definitions",
  cases: benchmarkCatalog,
};
const benchmarkManifestArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-benchmark-manifest",
  benchmarkVersion: benchmarks.AGENT_BENCHMARK_VERSION,
  caseCount: benchmarkCatalog.length,
  catalogHash: sha256(stableJson(benchmarkCatalogArtifact)),
  distribution: benchmarkDistribution,
  suiteCount: Object.keys(benchmarkDistribution).length,
  uniqueCaseIdCount: new Set(benchmarkCatalog.map((entry) => entry.id)).size,
  uniqueIntentCount: new Set(benchmarkCatalog.map((entry) => entry.intentKey)).size,
  browserFlowSpecCount: benchmarkCatalog.filter((entry) => entry.browserFlow).length,
  approvalBoundaryCaseCount: benchmarkCatalog.filter((entry) => entry.requiresApprovalBoundary).length,
  executionEvidence: {
    modelRunsCollected: false,
    sandboxRunsCollected: false,
    browserFlowsExecuted: false,
    providerEvidenceCollected: false,
    reason: "This artifact validates repository-owned benchmark definitions only; it does not execute models, Sandbox commands, or browser flows.",
  },
};

const repairValidation = repairs.validateRepairDatasetV3(repairs.SYNTHETIC_REPAIR_DATASET_V3);
if (repairValidation.accepted.length !== 36) {
  throw new Error(`Expected 36 accepted V3 repair records; received ${repairValidation.accepted.length}.`);
}
const repairJsonl = repairs.serializeRepairDatasetV3Jsonl(repairValidation.accepted);
const repairClassCounts = countBy(repairValidation.accepted, (entry) => entry.failureClass);
const repairSourceCounts = countBy(repairValidation.accepted, (entry) => entry.source);
const repairManifestArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-repair-manifest",
  datasetVersion: repairs.REPAIR_DATASET_V3_VERSION,
  evidenceScope: "synthetic-source-level-fixture-validation",
  acceptedCount: repairValidation.accepted.length,
  rejectedCount: repairValidation.rejected.length,
  rejected: repairValidation.rejected,
  recordHash: sha256(repairJsonl),
  failureClassCount: Object.keys(repairClassCounts).length,
  failureClassDistribution: repairClassCounts,
  provenance: {
    sourceDistribution: repairSourceCounts,
    licenseDistribution: countBy(repairValidation.accepted, (entry) => entry.license ?? "none"),
    reviewedCount: repairValidation.accepted.filter((entry) => entry.reviewed).length,
    automatedFixtureValidationCount: repairValidation.accepted.filter((entry) => !entry.reviewed).length,
  },
  applicability: {
    buildRequiredCount: repairValidation.accepted.filter((entry) => entry.build.required).length,
    buildNotApplicableCount: repairValidation.accepted.filter((entry) => !entry.build.required && entry.build.notApplicableReason).length,
    browserRequiredCount: repairValidation.accepted.filter((entry) => entry.browser.required).length,
    browserNotApplicableCount: repairValidation.accepted.filter((entry) => !entry.browser.required && entry.browser.notApplicableReason).length,
    buildEvidenceIds: repairValidation.accepted.flatMap((entry) => entry.build.evidenceIds).length,
    browserEvidenceIds: repairValidation.accepted.flatMap((entry) => entry.browser.evidenceIds).length,
  },
  providerEvidence: {
    collected: false,
    reason: "The synthetic repair corpus contains no model or provider execution and therefore records no provider evidence.",
  },
};

const tenantScopeHash = sha256("drops-studio:repository-owned:synthetic-repair-v3");
const failureFeatures = repairValidation.accepted.map((entry) => {
  const changedPaths = entry.verifiedPatch.writes.map((write) => write.path);
  return {
    traceId: entry.id,
    tenantScopeHash,
    occurredAt: entry.verifiedAt,
    failureClasses: [entry.failureClass],
    sanitizedErrorText: entry.sanitizedFailure,
    stackSymbols: [],
    affectedPathCategories: changedPaths.map(pathCategory),
    roles: ["synthetic-fixture-validator"],
    models: [],
    toolSequence: ["fixture-reproduce", "bounded-write", "focused-source-check", "secret-scan"],
    contextMissTypes: [],
    projectCategory: "synthetic-source-fixture",
    integrationCategories: [],
    repairOutcome: "verified",
    buildStage: "source-validation",
    deterministicFixerIds: [],
    criticalSecurity: false,
  };
});
const failureFeatureJsonl = failureFeatures.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const clusterConfiguration = { minimumClusterSize: 3, similarityThreshold: 0.5 };
const clusterReport = clustering.clusterFailureFeatures(failureFeatures, clusterConfiguration);
const candidateThresholds = {
  minimumClusterSize: 3,
  minimumCohesion: 0.75,
  minimumSourceValidatedRepairs: 3,
};
const regressionBenchmarkCandidates = clusterReport.clusters
  .filter((cluster) =>
    !cluster.outlier
    && cluster.size >= candidateThresholds.minimumClusterSize
    && cluster.confidence >= candidateThresholds.minimumCohesion
    && cluster.verifiedRepairCount >= candidateThresholds.minimumSourceValidatedRepairs
    && cluster.candidateActions.includes("benchmark"),
  )
  .map((cluster) => ({
    id: `candidate-${cluster.clusterId}`,
    sourceClusterId: cluster.clusterId,
    failureClasses: cluster.dominantFailureClasses,
    sourceRecordIds: cluster.memberTraceIds,
    evidenceScope: "synthetic-source-level-fixture-validation",
    status: "candidate-only",
    registryMutationApplied: false,
    requiredNextEvidence: [
      "promote into an isolated benchmark fixture",
      "execute deterministic checks against an installable Project V2 app",
      "collect Sandbox build evidence when applicable",
      "collect browser evidence when applicable",
    ],
  }));
const clusteringArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-failure-clustering-report",
  clusteringVersion: clustering.FAILURE_CLUSTERING_VERSION,
  derivedFrom: {
    repairDatasetVersion: repairs.REPAIR_DATASET_V3_VERSION,
    repairRecordHash: repairManifestArtifact.recordHash,
    acceptedSourceRecordCount: repairValidation.accepted.length,
    rejectedSourceRecordCount: repairValidation.rejected.length,
    failureFeatureHash: sha256(failureFeatureJsonl),
  },
  evidenceScope: "synthetic-source-level-fixture-validation",
  limitations: [
    "No model or provider was invoked.",
    "No dependency installation, production build, Sandbox preview, or browser flow was executed.",
    "Verified means the bounded synthetic patch passed source-level fixture checks, hash checks, and secret scanning only.",
    "Regression candidates are not active benchmark cases and do not change Router, AutoFix, prompts, or production defaults.",
  ],
  configuration: clusterConfiguration,
  candidateThresholds,
  report: clusterReport,
  regressionBenchmarkCandidates,
};

const readme = `# Drops Agent V3 evidence artifacts

These artifacts are generated from repository-owned code and fixtures. Do not edit them by hand.

Generate:

\`\`\`bash
node scripts/generate-agent-v3-evidence.mjs
\`\`\`

Verify that committed artifacts are current:

\`\`\`bash
node scripts/generate-agent-v3-evidence.mjs --check
\`\`\`

Evidence boundaries:

- \`compact-core-metrics.json\` measures the V3 prompt sources and hashes their content.
- \`benchmark-catalog.json\` and \`benchmark-manifest.json\` validate 120 case definitions. They are not model, Sandbox, or browser run results.
- \`repairs.jsonl\` contains 36 validated synthetic source-level fixtures across 12 failure classes. It contains no build or browser evidence.
- \`failure-features.jsonl\` and \`failure-clustering-report.json\` are deterministically derived from those repair records.
- Candidate regression benchmarks are emitted only when cluster thresholds pass. They remain candidates and do not mutate the canonical registry.
- No provider credentials or provider execution evidence are consumed or claimed by this generator.
`;

const artifacts = new Map([
  ["compact-core-metrics.json", stableJson(compactCoreArtifact)],
  ["benchmark-catalog.json", stableJson(benchmarkCatalogArtifact)],
  ["benchmark-manifest.json", stableJson(benchmarkManifestArtifact)],
  ["repairs.jsonl", repairJsonl],
  ["repair-manifest.json", stableJson(repairManifestArtifact)],
  ["failure-features.jsonl", failureFeatureJsonl],
  ["failure-clustering-report.json", stableJson(clusteringArtifact)],
  ["README.md", readme],
]);

const sourceSnapshotAt = repairValidation.accepted
  .map((entry) => entry.verifiedAt)
  .sort()
  .at(-1);
const manifestArtifact = {
  schemaVersion: 1,
  artifact: "drops-agent-v3-evidence-manifest",
  evidenceVersion: "3.0.0",
  sourceSnapshotAt,
  reproducibility: {
    writeCommand: "node scripts/generate-agent-v3-evidence.mjs",
    checkCommand: "node scripts/generate-agent-v3-evidence.mjs --check",
    deterministic: true,
    dynamicProviderCalls: false,
  },
  productionImpact: {
    routerChanged: false,
    autoFixChanged: false,
    promptDefaultsChanged: false,
    productionDefaultsChanged: false,
  },
  artifacts: [...artifacts].map(([name, content]) => ({
    name,
    byteCount: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  })),
  evidenceScopes: {
    compactCore: compactCoreArtifact.evidenceScope,
    benchmarks: benchmarkManifestArtifact.executionEvidence,
    repairs: repairManifestArtifact.evidenceScope,
    clustering: clusteringArtifact.evidenceScope,
  },
};
artifacts.set("manifest.json", stableJson(manifestArtifact));

for (const [name, content] of artifacts) {
  const path = resolve(OUTPUT_DIRECTORY, name);
  if (basename(path) !== name || dirname(path) !== OUTPUT_DIRECTORY) {
    throw new Error(`Unsafe evidence artifact path: ${name}.`);
  }
  if (CHECK_MODE) await assertCurrent(path, content);
  else await atomicWrite(path, content);
}

process.stdout.write(
  CHECK_MODE
    ? `Verified ${artifacts.size} current Drops Agent V3 evidence artifacts.\n`
    : `Generated ${artifacts.size} Drops Agent V3 evidence artifacts in ${OUTPUT_DIRECTORY}.\n`,
);
