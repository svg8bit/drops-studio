import { createHash } from "node:crypto";

import { findArtifactSecrets } from "../../artifact-security.ts";
import {
  resolveBuilderModel,
  runBuilderAgent,
  type BuilderAgentRequest,
  type BuilderAgentResult,
  type BuilderModelEvidence,
  type BuilderModelResolution,
  type BuilderPermission,
  type BuilderReleaseCheck,
  type BuilderReleaseGateResult,
} from "../../builder-agent/index.ts";
import { validateProjectV2 } from "../../project-v2-validator.ts";
import type { ProjectV2 } from "../../project-v2-types.ts";
import {
  ContextCompiler,
  ContextIngestor,
  InProcessHybridIndexBackend,
  contextSha256,
  redactContextContent,
  stableContextJson,
  type CompiledContextPackage,
  type ContextIndexBackend,
  type ContextItem,
} from "../context/index.ts";
import {
  createAgentRunTrace,
  finalizeAgentRunTrace,
} from "../evals/trace.ts";
import { privacySafeText } from "../evals/privacy.ts";
import type {
  AgentFailureClass,
  AgentRunTrace,
  AgentTraceCheck,
  AgentTraceRoute,
} from "../evals/types.ts";
import {
  DEFAULT_AGENT_INTELLIGENCE_FLAGS,
  type AgentIntelligenceFlags,
} from "../flags.ts";
import { AuthorizedModelRegistry } from "../models/capability-registry.ts";
import { routeModel } from "../models/router.ts";
import type {
  AgentModelRole,
  ModelCapabilityProfile,
  ModelRouteDecision,
  ModelRoutingMode,
} from "../models/types.ts";
import {
  verifyReleaseEvidence,
  type DeterministicGateEvidence,
  type ImmutableVerificationEvidence,
  type VerificationReport,
} from "../models/verifier.ts";
import {
  composeRuntimeSystemPrompt,
  loadRuntimeSystemPrompt,
  stableSerialize,
} from "../system/runtime-prompt.ts";
import { createAgentRuntimeVersions } from "../system/versions.ts";
import type { ComposedRuntimePrompt } from "../system/types.ts";
import {
  officialDropsContextSources,
  projectContextSources,
} from "./knowledge.ts";
import type {
  DeterministicFallbackRoute,
  IntelligentBuilderAgentOutput,
  IntelligentBuilderRoute,
  IntelligentBuilderTracePersistence,
  ResolvedIntelligentModel,
  RunIntelligentBuilderAgentInput,
} from "./types.ts";

const RUNTIME_INTEGRATION_VERSION = "2.0.0";
const ROUTING_POLICY_VERSION = "2.0.0";
const MAX_BUILDER_PROMPT_CHARACTERS = 19_500;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 8_000;
const DEFAULT_CONTEXT_OUTPUT_HEADROOM = 1_500;

const ALL_EXECUTION_ROLES: AgentModelRole[] = [
  "router",
  "planner",
  "coder",
  "quick-edit",
  "autofix",
  "verifier",
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function safeProjectRevision(project: ProjectV2): string {
  return `${project.revision}:${project.contentHash}`;
}

function capabilityProfile(
  resolution: BuilderModelResolution,
  input: RunIntelligentBuilderAgentInput,
  now: () => Date,
): ModelCapabilityProfile {
  const evidence = resolution.evidence;
  const override = input.modelCapabilityOverride;
  if (
    (override?.provider && override.provider !== evidence.provider) ||
    (override?.model && override.model !== evidence.model)
  ) {
    throw new Error("Model capability evidence does not match the resolved model.");
  }
  const source = evidence.credentialOwner === "platform"
    ? "platform"
    : evidence.provider === "custom"
      ? "custom"
      : "user-byok";
  return {
    provider: evidence.provider,
    model: evidence.model,
    displayName: override?.displayName?.slice(0, 120) || evidence.model,
    authorized: true,
    source,
    // A successful BuilderModelResolver resolution authorizes the strict AI SDK
    // tool transport used by runBuilderAgent. Capabilities not exercised by this
    // adapter remain false/unknown unless trusted live evidence supplies them.
    supportsTools: override?.supportsTools ?? true,
    supportsParallelTools: override?.supportsParallelTools ?? false,
    supportsStructuredOutput: override?.supportsStructuredOutput ?? true,
    supportsVision: override?.supportsVision ?? false,
    supportsEmbeddings: override?.supportsEmbeddings ?? false,
    maxContextTokens: override?.maxContextTokens ?? 32_000,
    maxOutputTokens: override?.maxOutputTokens ?? 12_000,
    latencyClass: override?.latencyClass ?? "unknown",
    qualityClass: override?.qualityClass ?? "unknown",
    cost: {
      inputPerMillion: override?.cost?.inputPerMillion ?? null,
      cachedInputPerMillion: override?.cost?.cachedInputPerMillion ?? null,
      outputPerMillion: override?.cost?.outputPerMillion ?? null,
      currency: "USD",
    },
    allowedRoles: [...new Set(override?.allowedRoles ?? ALL_EXECUTION_ROLES)],
    verifiedAt: override?.verifiedAt ?? nowIso(now),
  };
}

function authorizedRoutingMode(
  evidence: BuilderModelEvidence,
  requested: ModelRoutingMode | undefined,
): ModelRoutingMode {
  if (evidence.provider !== "gateway" || evidence.credentialOwner !== "platform") {
    return "selected-only";
  }
  return requested === "selected-only" ? "selected-only" : "auto-balanced";
}

function requestedIntegrations(prompt: string): string[] {
  const values: string[] = [];
  if (/dropstab|market cap|fdv|token unlock|funding round/i.test(prompt)) {
    values.push("dropstab");
  }
  if (/drops\s*bot|wallet monitor|tracked wallet|wallet event|webhook/i.test(prompt)) {
    values.push("drops-bot");
  }
  if (/telegram|channel delivery|send alert/i.test(prompt)) values.push("telegram");
  return values;
}

function routeTask(request: BuilderAgentRequest, project: ProjectV2) {
  const integrations = requestedIntegrations(request.prompt);
  if (request.mode === "repair") {
    return {
      goal: request.prompt,
      mutation: true,
      expectedFiles: Math.min(Object.keys(project.files).length, 12),
      expectedChangedLines: 160,
      requestedIntegrations: integrations,
      failureClass: "type-error" as const,
      riskClass: "medium" as const,
      requiredContextTokens: 8_000,
    };
  }
  const quickEdit = request.mode === "edit" &&
    request.prompt.length <= 1_200 &&
    integrations.length === 0 &&
    !/dependency|package|route|schema|database|architecture|refactor/i.test(request.prompt);
  return {
    goal: request.prompt,
    mutation: true,
    newProduct: false,
    architectureChange: false,
    expectedFiles: quickEdit ? 2 : Math.max(5, Math.min(Object.keys(project.files).length, 24)),
    expectedChangedLines: quickEdit ? 100 : 400,
    requestedIntegrations: integrations,
    riskClass: /deploy|publish|wallet|telegram|webhook|authentication|authorization/i.test(request.prompt)
      ? "high" as const
      : "medium" as const,
    requiredContextTokens: 8_000,
  };
}

async function resolveIntelligentModel(
  input: RunIntelligentBuilderAgentInput,
  now: () => Date,
): Promise<ResolvedIntelligentModel> {
  const resolver = input.dependencies.modelResolver ?? resolveBuilderModel;
  const resolution = await resolver(
    input.request.provider,
    input.dependencies.credentials ?? {},
  );
  if (
    resolution.evidence.provider !== input.request.provider.provider ||
    resolution.evidence.keyPersisted !== false
  ) {
    throw new Error("Resolved model evidence does not match the request-only provider contract.");
  }
  const profile = capabilityProfile(resolution, input, now);
  return {
    resolution,
    selection: input.request.provider,
    profile,
    routingMode: authorizedRoutingMode(
      resolution.evidence,
      input.requestedRoutingMode,
    ),
  };
}

function routeResolvedModel(
  input: RunIntelligentBuilderAgentInput,
  resolved: ResolvedIntelligentModel,
): ModelRouteDecision {
  const registry = new AuthorizedModelRegistry(
    `runtime:${RUNTIME_INTEGRATION_VERSION}`,
    [resolved.profile],
  );
  const route = routeModel(registry, {
    task: routeTask(input.request, input.project),
    mode: resolved.routingMode,
    ...(resolved.routingMode === "selected-only"
      ? {
          selected: {
            provider: resolved.profile.provider,
            model: resolved.profile.model,
          },
        }
      : {}),
    policyVersion: ROUTING_POLICY_VERSION,
  });
  if (
    route.provider !== resolved.resolution.evidence.provider ||
    route.model !== resolved.resolution.evidence.model
  ) {
    throw new Error("Composite routing attempted an unauthorized model switch.");
  }
  return route;
}

function explicitProjectChunkIds(
  prompt: string,
  project: ProjectV2,
  ingestion: Array<{ sourceUri: string; chunkIds: string[] }>,
): string[] {
  const selected: string[] = [];
  for (const file of Object.values(project.files)) {
    if (file.bytes > 3_500 || !prompt.includes(file.path)) continue;
    const sourceUri = `project://${project.id}/${file.path}`;
    selected.push(
      ...(ingestion.find((entry) => entry.sourceUri === sourceUri)?.chunkIds ?? []).slice(0, 3),
    );
  }
  return [...new Set(selected)].slice(0, 8);
}

async function pinnedOfficialChunkIds(input: {
  prompt: string;
  actor: RunIntelligentBuilderAgentInput["actor"];
  backend: ContextIndexBackend;
  ingestion: Array<{ sourceUri: string; chunkIds: string[] }>;
}): Promise<string[]> {
  const officialIds = input.ingestion
    .filter((entry) => entry.sourceUri.startsWith("platform://drops/"))
    .flatMap((entry) => entry.chunkIds);
  const chunks = await input.backend.getChunks(officialIds, {
    tenantId: input.actor.tenantId,
    workspaceId: input.actor.workspaceId,
    includeWorkspaceSources: true,
  });
  const prompt = input.prompt.toLowerCase();
  return chunks.filter((chunk) => {
    if (chunk.endpoint) {
      const path = chunk.endpoint.path.toLowerCase();
      if (prompt.includes(path)) return true;
      if (path === "/coins" && /coin|market cap|fdv|price/i.test(prompt)) return true;
      if (path === "/tokenunlocks" && /unlock/i.test(prompt)) return true;
      if (path === "/fundingrounds" && /funding|investor/i.test(prompt)) return true;
      if (path === "/cryptoactivities" && /activit/i.test(prompt)) return true;
    }
    return chunk.sourceUri.includes("drops-bot") && /drops\s*bot|wallet|webhook|telegram/i.test(prompt);
  }).map((chunk) => chunk.chunkId).slice(0, 6);
}

async function rebucketPinnedOfficialContext(input: {
  context: CompiledContextPackage;
  approvalState: string;
  indexVersion: number;
}): Promise<CompiledContextPackage> {
  const official = input.context.exactProjectFiles.filter(
    (item) => item.trust === "official" || item.trust === "system",
  );
  if (!official.length) return input.context;
  const exactProjectFiles = input.context.exactProjectFiles.filter(
    (item) => item.trust !== "official" && item.trust !== "system",
  );
  const integrationEvidence = [
    ...input.context.integrationEvidence,
    ...official.filter((item) => Boolean(item.endpoint)),
  ].sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  const officialReferences = [
    ...input.context.officialReferences,
    ...official.filter((item) => !item.endpoint),
  ].sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  const { packageId: _priorPackageId, ...prior } = input.context;
  void _priorPackageId;
  const base = { ...prior, exactProjectFiles, integrationEvidence, officialReferences };
  const packageId = await contextSha256(stableContextJson({
    ...base,
    approvalState: input.approvalState,
    indexVersion: input.indexVersion,
  }));
  return { packageId, ...base };
}

async function compileContext(
  input: RunIntelligentBuilderAgentInput,
  route: ModelRouteDecision,
  profile: ModelCapabilityProfile,
  safePrompt: string,
): Promise<CompiledContextPackage> {
  const backend = input.context?.backend ?? new InProcessHybridIndexBackend();
  const ingestor = new ContextIngestor(backend);
  const sources = [
    ...projectContextSources({ project: input.project, actor: input.actor }),
    ...officialDropsContextSources(input.actor),
  ];
  const ingestion = await ingestor.ingestMany(sources);
  const approvalState = (input.request.approvedTools ?? []).slice().sort().join(",") || "none";
  const exactChunkIds = [
    ...explicitProjectChunkIds(safePrompt, input.project, ingestion),
    ...await pinnedOfficialChunkIds({
      prompt: safePrompt,
      actor: input.actor,
      backend,
      ingestion,
    }),
  ];
  const tokenBudget = input.context?.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const outputHeadroomTokens = input.context?.outputHeadroomTokens ??
    DEFAULT_CONTEXT_OUTPUT_HEADROOM;
  const compiler = new ContextCompiler({
    backend,
    retrievalPolicy: {
      lexicalCandidates: 40,
      // The retrieval contract validates both candidate bounds. With no
      // embedding provider, vector search is not invoked despite this cap.
      vectorCandidates: 40,
      fusedCandidates: 30,
      rerankCandidates: 20,
      finalChunks: 14,
      neighborRadius: 1,
      rrfK: 60,
      mmrLambda: 0.72,
      policyVersion: "runtime-lexical-v2",
    },
  });
  const compiled = await compiler.compile({
    tenantId: input.actor.tenantId,
    workspaceId: input.actor.workspaceId,
    projectId: input.project.id,
    branch: input.actor.branch,
    revision: String(input.project.revision),
    task: safePrompt,
    role: route.primaryRole,
    projectRevision: safeProjectRevision(input.project),
    modelProfileHash: sha256(stableSerialize(profile)),
    promptVersion: RUNTIME_INTEGRATION_VERSION,
    tokenBudget,
    outputHeadroomTokens,
    permission: {
      allowedTrust: [
        "system",
        "official",
        "project-authoritative",
        "runtime-evidence",
      ],
      allowWorkspacePrivate: true,
      allowProjectPrivate: true,
      includeRuntimeEvidence: true,
    },
    exactChunkIds: [...new Set(exactChunkIds)],
    approvalState,
  });
  return rebucketPinnedOfficialContext({
    context: compiled,
    approvalState,
    indexVersion: backend.getIndexVersion(),
  });
}

function allContextItems(contextPackage: CompiledContextPackage): ContextItem[] {
  return [
    ...contextPackage.mandatoryPolicies,
    ...contextPackage.exactProjectFiles,
    // Integration and official evidence is placed before broad project recall
    // when composing the bounded model prompt. The full package retains its
    // typed sections and deterministic provenance.
    ...contextPackage.integrationEvidence,
    ...contextPackage.officialReferences,
    ...contextPackage.projectMemory,
    ...contextPackage.retrievedProjectContext,
    ...contextPackage.runtimeEvidence,
  ];
}

function runtimeTrust(item: ContextItem): "trusted" | "project" | "untrusted" {
  if (item.trust === "system" || item.trust === "official") return "trusted";
  if (item.trust === "project-authoritative") return "project";
  return "untrusted";
}

function boundedRuntimeContext(
  contextPackage: CompiledContextPackage,
  maxCharacters: number,
) {
  let remaining = maxCharacters;
  const values = [] as Array<{
    id: string;
    source: string;
    version: string;
    trust: "trusted" | "project" | "untrusted";
    content: string;
  }>;
  for (const item of allContextItems(contextPackage)) {
    if (remaining <= 0 || values.length >= 8) break;
    const content = item.content.slice(0, Math.min(1_100, remaining));
    if (!content) continue;
    values.push({
      id: item.chunkId,
      source: item.sourceUri,
      version: item.sourceVersion,
      trust: runtimeTrust(item),
      content,
    });
    remaining -= content.length;
  }
  return values;
}

function runtimeMode(request: BuilderAgentRequest): "build" | "edit" | "debug" {
  return request.mode === "repair" ? "debug" : request.mode;
}

function composeBuilderPrompt(input: {
  source: RunIntelligentBuilderAgentInput;
  route: ModelRouteDecision;
  profile: ModelCapabilityProfile;
  contextPackage: CompiledContextPackage;
  safePrompt: string;
  core: Awaited<ReturnType<typeof loadRuntimeSystemPrompt>>;
}): ComposedRuntimePrompt {
  const versions = createAgentRuntimeVersions({
    projectRevision: safeProjectRevision(input.source.project),
  });
  for (const contextLimit of [5_500, 3_000, 1_500, 0]) {
    const composed = composeRuntimeSystemPrompt({
      core: input.core,
      role: input.route.primaryRole,
      model: input.profile,
      routingMode: input.route.policyVersion === ROUTING_POLICY_VERSION
        ? (input.route.reasonCodes.includes("SELECTED_MODEL_ONLY")
            ? "selected-only"
            : "auto-balanced")
        : "selected-only",
      approvalState: Object.fromEntries(
        (input.source.request.approvedTools ?? []).map((tool) => [tool, true]),
      ),
      task: {
        goal: input.safePrompt,
        mode: runtimeMode(input.source.request),
        explicitConstraints: [
          "Use only the current Project V2 and registered tools.",
          "Never expose credentials or claim unverified provider state.",
        ],
        requestedIntegrations: requestedIntegrations(input.safePrompt),
      },
      projectMemory: {
        projectId: input.source.project.id,
        revision: input.source.project.revision,
        framework: input.source.project.manifest.framework.name,
        presetId: input.source.project.productSpec.presetId,
      },
      selectedSkills: [],
      retrievedContext: boundedRuntimeContext(
        input.contextPackage,
        contextLimit,
      ),
      runtimeEvidence: {
        previewStatus: input.source.project.preview?.status ?? "idle",
        priorRuns: input.source.project.runs.length,
      },
      integrationEvidence: Object.fromEntries(
        input.source.project.integrations.map((integration) => [
          integration.id,
          {
            kind: integration.kind,
            status: integration.status,
            providerEvidenceRequired: integration.providerEvidenceRequired,
          },
        ]),
      ),
      versions,
    });
    if (composed.prompt.length <= MAX_BUILDER_PROMPT_CHARACTERS) return composed;
  }
  throw new Error("Composed runtime prompt exceeds the bounded builder request size.");
}

function gateByName(
  release: BuilderReleaseGateResult,
  name: BuilderReleaseCheck["name"],
): BuilderReleaseCheck | undefined {
  return release.checks.find((check) => check.name === name);
}

function evidenceId(name: string, passed: boolean, summary: string): string {
  return sha256(stableSerialize({ name, passed, summary })).slice(0, 24);
}

function gateEvidence(
  name: DeterministicGateEvidence["name"],
  passed: boolean,
  required: boolean,
  summary: string,
): DeterministicGateEvidence {
  return Object.freeze({
    id: evidenceId(name, passed, summary),
    name,
    passed,
    required,
    summary: privacySafeText(summary, 320),
  });
}

async function schemaEvidence(project: ProjectV2): Promise<DeterministicGateEvidence> {
  try {
    await validateProjectV2(project);
    return gateEvidence("project-schema", true, true, "Project V2 schema and canonical hashes passed.");
  } catch (error) {
    return gateEvidence(
      "project-schema",
      false,
      true,
      privacySafeText(error instanceof Error ? error.message : "Project V2 validation failed."),
    );
  }
}

function requiredPermissions(): readonly BuilderPermission[] {
  return [
    "files:read",
    "files:write",
    "runtime:execute",
    "runtime:network",
    "preview:start",
    "browser:check",
    "checkpoint:write",
  ];
}

async function immutableVerificationEvidence(
  result: BuilderAgentResult,
  permissions: ReadonlySet<BuilderPermission>,
): Promise<ImmutableVerificationEvidence> {
  const build = gateByName(result.releaseGate, "build");
  const preview = gateByName(result.releaseGate, "preview");
  const browser = gateByName(result.releaseGate, "browser");
  const secretFindings = findArtifactSecrets(
    JSON.stringify(result.project),
    "verified Project V2",
  );
  const missingPermissions = requiredPermissions().filter(
    (permission) => !permissions.has(permission),
  );
  const gates: DeterministicGateEvidence[] = [
    await schemaEvidence(result.project),
    gateEvidence(
      "build",
      build?.status === "passed",
      true,
      build?.summary ?? "Production build evidence is missing.",
    ),
    gateEvidence(
      "preview",
      preview?.status === "passed" && Boolean(result.releaseGate.previewUrl),
      true,
      preview?.summary ?? "Live preview evidence is missing.",
    ),
    gateEvidence(
      "browser",
      browser?.status === "passed" &&
        browser.browser?.rendered === true &&
        browser.browser.primaryInteractionChecked === true &&
        browser.browser.pageErrors.length === 0 &&
        browser.browser.consoleErrors.length === 0 &&
        browser.browser.networkErrors.length === 0,
      true,
      browser?.summary ?? "Browser render and interaction evidence is missing.",
    ),
    gateEvidence(
      "secret-scan",
      secretFindings.length === 0,
      true,
      secretFindings.length
        ? "Credential-like material was detected in the final project."
        : "Final project secret scan passed.",
    ),
    gateEvidence(
      "permissions",
      missingPermissions.length === 0,
      true,
      missingPermissions.length
        ? `Missing required execution permissions: ${missingPermissions.join(", ")}.`
        : "Required builder execution permissions were present.",
    ),
  ];
  for (const name of ["typecheck", "lint", "tests"] as const) {
    const check = gateByName(result.releaseGate, name);
    gates.push(gateEvidence(
      name,
      check?.status === "passed",
      true,
      check?.summary ?? `${name} evidence is missing.`,
    ));
  }
  const setupRequired = result.project.integrations
    .filter(
      (integration) => integration.providerEvidenceRequired &&
        integration.status !== "available",
    )
    .map((integration) => `${integration.kind}:${integration.status}`)
    .sort();
  const unresolvedWarnings = result.releaseGate.checks
    .filter((check) => check.status === "skipped")
    .map((check) => `${check.name}: ${privacySafeText(check.summary, 160)}`);
  const frozenGates = Object.freeze(gates.slice());
  const evidenceHash = sha256(stableSerialize({
    projectRevision: result.project.revision,
    gates: frozenGates,
    setupRequired,
    unresolvedWarnings,
  }));
  return Object.freeze({
    projectRevision: safeProjectRevision(result.project),
    evidenceHash,
    gates: frozenGates,
    setupRequired: Object.freeze(setupRequired),
    unresolvedWarnings: Object.freeze(unresolvedWarnings),
  });
}

function releaseFailureClass(result: BuilderAgentResult, verification: VerificationReport): AgentFailureClass {
  if (verification.verdict === "UNSAFE") return "security";
  const names = result.releaseGate.checks
    .filter((check) => check.status === "failed")
    .map((check) => check.name);
  if (names.includes("typecheck")) return "typescript";
  if (names.includes("lint")) return "lint";
  if (names.includes("tests")) return "test";
  if (names.includes("build")) return "build";
  if (names.includes("preview")) return "preview";
  if (names.includes("browser")) return "browser-runtime";
  return verification.verdict === "PASS" || verification.verdict === "PASS_WITH_SETUP_REQUIRED"
    ? "none"
    : "unknown";
}

function traceCheckName(
  gate: DeterministicGateEvidence,
): AgentTraceCheck["name"] {
  if (gate.name === "project-schema") return "schema";
  if (gate.name === "secret-scan" || gate.name === "permissions") return "security";
  return gate.name;
}

function routeTrace(
  route: ModelRouteDecision,
  routingMode: ModelRoutingMode,
  startedAt: string,
  finishedAt: string,
): AgentTraceRoute {
  const role = route.primaryRole === "retrieval-reranker"
    ? "reranker"
    : route.primaryRole;
  return {
    routeId: route.routeId,
    role,
    provider: route.provider,
    model: route.model,
    policy: routingMode,
    reasonCodes: [...route.reasonCodes],
    fallback: false,
    startedAt,
    finishedAt,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

function finalizeTrace(input: {
  base: AgentRunTrace;
  result: BuilderAgentResult;
  verification: VerificationReport;
  evidence: ImmutableVerificationEvidence;
  route: IntelligentBuilderRoute;
  routingMode?: ModelRoutingMode;
  contextPackage: CompiledContextPackage | null;
  routeStartedAt: string;
  finishedAt: string;
}): AgentRunTrace {
  const browser = gateByName(input.result.releaseGate, "browser")?.browser;
  const buildPassed = gateByName(input.result.releaseGate, "build")?.status === "passed";
  const previewPassed = gateByName(input.result.releaseGate, "preview")?.status === "passed" &&
    Boolean(input.result.releaseGate.previewUrl);
  const browserPassed = gateByName(input.result.releaseGate, "browser")?.status === "passed" &&
    browser?.rendered === true;
  const deterministicGatePassed = input.verification.verdict === "PASS" ||
    input.verification.verdict === "PASS_WITH_SETUP_REQUIRED";
  const status = input.verification.verdict === "UNSAFE"
    ? "unsafe" as const
    : deterministicGatePassed && ["completed", "fallback"].includes(input.result.status)
      ? "completed" as const
      : "blocked" as const;
  const checks: AgentTraceCheck[] = input.evidence.gates.map((gate) => ({
    checkId: gate.id,
    name: traceCheckName(gate),
    status: gate.passed ? "passed" : "failed",
    evidenceId: gate.id,
    durationMs: 0,
    firstPass: input.result.attempts <= 1,
  }));
  return finalizeAgentRunTrace(input.base, {
    projectRevisionFinal: input.result.project.revision,
    status,
    failureClass: releaseFailureClass(input.result, input.verification),
    routes: input.route.primaryRole === "deterministic-fallback"
      ? []
      : [routeTrace(
          input.route,
          input.routingMode ?? "selected-only",
          input.routeStartedAt,
          input.finishedAt,
        )],
    contextPackages: input.contextPackage
      ? [{
          packageId: input.contextPackage.packageId,
          queryId: input.contextPackage.taskHash,
          retrievalMode: input.contextPackage.retrievalMode === "hybrid"
            ? "hybrid"
            : "lexical-only",
          sourceIds: [...new Set(allContextItems(input.contextPackage).map((item) => item.sourceUri))].sort(),
          chunkIds: allContextItems(input.contextPackage).map((item) => item.chunkId).sort(),
          omittedReasons: [...new Set(input.contextPackage.omitted.map((item) => item.reason))].sort(),
          estimatedTokens: input.contextPackage.estimatedTokens,
          compiledAt: input.routeStartedAt,
        }]
      : [],
    checks,
    repairs: Array.from({ length: input.result.repairs }, (_, index) => ({
      attempt: index + 1,
      failureClass: "unknown" as const,
      strategy: input.result.providerMode === "ai-agent" ? "model" as const : "deterministic" as const,
      changedFiles: [],
      result: index + 1 === input.result.repairs && deterministicGatePassed
        ? "passed" as const
        : "failed" as const,
    })),
    verification: {
      verdict: input.verification.verdict,
      deterministicGatePassed,
      setupRequired: [...input.verification.setupRequired],
      evidenceIds: [...input.verification.evidenceIds],
    },
    firstPass: {
      build: input.result.attempts <= 1 && buildPassed,
      preview: input.result.attempts <= 1 && previewPassed,
      browser: input.result.attempts <= 1 && browserPassed,
    },
    final: {
      build: buildPassed,
      preview: previewPassed,
      browser: browserPassed,
      primaryInteraction: browser?.primaryInteractionChecked === true,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedModelCostUsd: 0,
      sandboxDurationMs: 0,
      totalLatencyMs: Math.max(
        0,
        Date.parse(input.finishedAt) - Date.parse(input.base.startedAt),
      ),
    },
    finishedAt: input.finishedAt,
  });
}

async function persistTrace(
  input: RunIntelligentBuilderAgentInput,
  flags: AgentIntelligenceFlags,
  trace: AgentRunTrace,
): Promise<IntelligentBuilderTracePersistence> {
  if (!flags.privacySafeTraces) {
    return { status: "disabled", reason: "Privacy-safe trace storage is disabled by configuration." };
  }
  if (!input.evalStore) {
    return { status: "disabled", reason: "No evaluation trace store is configured." };
  }
  try {
    await input.evalStore.writeTrace(trace);
    return { status: "persisted" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: privacySafeText(
        error instanceof Error ? error.message : "Evaluation trace storage is unavailable.",
        180,
      ) || "Evaluation trace storage is unavailable.",
    };
  }
}

function deterministicRoute(request: BuilderAgentRequest): DeterministicFallbackRoute {
  return {
    routeId: sha256(stableSerialize({
      projectId: request.projectId,
      mode: request.mode,
      provider: "free",
      policyVersion: ROUTING_POLICY_VERSION,
    })).slice(0, 24),
    primaryRole: "deterministic-fallback",
    provider: "free",
    model: "deterministic-project-v2",
    routingMode: "selected-only",
    reasonCodes: ["FREE_DETERMINISTIC_FALLBACK"],
    policyVersion: ROUTING_POLICY_VERSION,
  };
}

export async function runIntelligentBuilderAgent(
  input: RunIntelligentBuilderAgentInput,
): Promise<IntelligentBuilderAgentOutput> {
  const now = input.now ?? (() => new Date());
  const flags = input.flags ?? { ...DEFAULT_AGENT_INTELLIGENCE_FLAGS };
  if (
    input.actor.actorId !== input.dependencies.services.actorId ||
    input.project.id !== input.request.projectId ||
    input.dependencies.services.project.id !== input.project.id ||
    input.project.revision !== input.dependencies.services.project.revision
  ) {
    throw new Error("Intelligent builder actor/project scope does not match the authorized session.");
  }
  await validateProjectV2(input.project);
  const safePromptResult = redactContextContent(input.request.prompt);
  const safePrompt = safePromptResult.content.trim();
  if (!safePrompt) throw new Error("Builder request is empty after privacy redaction.");
  const routeStartedAt = nowIso(now);
  const baseTrace = createAgentRunTrace({
    runId: input.dependencies.services.requestId,
    actorId: input.actor.actorId,
    projectId: input.project.id,
    projectRevision: input.project.revision,
    prompt: input.request.prompt,
    configurationId: input.request.provider.provider === "free"
      ? "deterministic-fallback-v2"
      : "composite-runtime-v2",
    versions: {
      runtimeContract: RUNTIME_INTEGRATION_VERSION,
      routing: ROUTING_POLICY_VERSION,
      projectSchema: 2,
    },
    startedAt: routeStartedAt,
  });
  const executeBuilder = input.builderExecutor ?? runBuilderAgent;

  let route: IntelligentBuilderRoute;
  let contextPackage: CompiledContextPackage | null = null;
  let routingMode: ModelRoutingMode | undefined;
  let request = { ...input.request, prompt: safePrompt };
  let dependencies = input.dependencies;

  if (input.request.provider.provider === "free") {
    route = deterministicRoute(input.request);
  } else {
    const resolved = await resolveIntelligentModel(input, now);
    route = routeResolvedModel(input, resolved);
    routingMode = resolved.routingMode;
    contextPackage = await compileContext(input, route, resolved.profile, safePrompt);
    const core = input.runtimePrompt ?? await loadRuntimeSystemPrompt();
    const composed = composeBuilderPrompt({
      source: input,
      route,
      profile: resolved.profile,
      contextPackage,
      safePrompt,
      core,
    });
    if (findArtifactSecrets(composed.prompt, "composed builder prompt").length) {
      throw new Error("Composed builder prompt contains credential-like material.");
    }
    request = { ...input.request, prompt: composed.prompt };
    const cachedResolution = resolved.resolution;
    dependencies = {
      ...input.dependencies,
      modelResolver: async (selection) => {
        if (
          selection.provider !== resolved.selection.provider ||
          (selection.model && selection.model !== cachedResolution.evidence.model)
        ) {
          throw new Error("Builder attempted to resolve a model outside the authorized route.");
        }
        return cachedResolution;
      },
    };
  }

  const result = await executeBuilder(request, dependencies);
  const evidence = await immutableVerificationEvidence(
    result,
    input.dependencies.services.permissions,
  );
  const verification = verifyReleaseEvidence(evidence, {
    verifierModel: "deterministic-read-only-verifier",
    verifierPromptVersion: RUNTIME_INTEGRATION_VERSION,
  });
  const resultAfterVerification: BuilderAgentResult =
    verification.verdict === "PASS" ||
    verification.verdict === "PASS_WITH_SETUP_REQUIRED"
      ? result
      : {
          ...result,
          status: "blocked",
          summary: privacySafeText(
            `Independent Verifier blocked release (${verification.verdict}). ${verification.userSummary}`,
            4_000,
          ),
          releaseGate: {
            ...result.releaseGate,
            ok: false,
            blockingErrors: [
              ...new Set([
                ...result.releaseGate.blockingErrors,
                `Independent Verifier verdict: ${verification.verdict}.`,
                ...verification.failedCriteria,
              ]),
            ],
          },
        };
  const finishedAt = nowIso(now);
  const trace = finalizeTrace({
    base: baseTrace,
    result: resultAfterVerification,
    verification,
    evidence,
    route,
    routingMode,
    contextPackage,
    routeStartedAt,
    finishedAt,
  });
  const tracePersistence = await persistTrace(input, flags, trace);
  return {
    result: resultAfterVerification,
    trace,
    verification,
    contextPackage,
    route,
    tracePersistence,
  };
}
