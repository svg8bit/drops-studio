import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const {
  FileLeaseRegistry,
  PatchValidationError,
  mergePatchBundlesAtomically,
  validatePatchBundle,
} = await import("../lib/agent/orchestrator/index.ts");

function spec() {
  return createProjectSpec({
    presetId: "alpha-channel",
    values: {},
    prompt: "Build an alpha channel",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

async function project() {
  return materializeProjectV2Template({ id: "patch-fixture", spec: spec(), now: "2026-07-30T10:00:00.000Z" });
}

function task(current, taskId = "frontend", overrides = {}) {
  return {
    taskId,
    runId: "patch-run",
    role: "frontend",
    title: "Patch task",
    objective: "Propose a bounded patch",
    dependencies: [],
    priority: 10,
    baseRevision: current.revision,
    baseContentHash: current.contentHash,
    readScopes: ["components/**"],
    writeScopes: ["components/**"],
    protectedScopes: ["package.json"],
    integrationScopes: [],
    contextQueryIds: [],
    selectedSkills: [],
    modelRouteId: "route:frontend",
    executionMode: "patch-only",
    acceptanceChecks: ["typecheck"],
    expectedArtifacts: [],
    risk: "low",
    estimatedCostUsd: 0,
    limits: { maxModelCalls: 1, maxToolCalls: 8, timeoutMs: 5_000, maxChangedFiles: 4, maxChangedLines: 500 },
    status: "queued",
    ...overrides,
  };
}

function bundle(current, assigned, path = "components/AgentPatch.tsx", overrides = {}) {
  return {
    taskId: assigned.taskId,
    role: assigned.role,
    baseRevision: current.revision,
    baseContentHash: current.contentHash,
    expectedFileHashes: { [path]: current.files[path]?.hash ?? null },
    operations: [{ type: "write", path, content: "export const AgentPatch = () => <p>Safe</p>;\n", provenance: "ai" }],
    dependencyChanges: [],
    testsToRun: ["typecheck"],
    summary: "Safe patch",
    unresolvedAssumptions: [],
    contextProvenanceIds: [],
    ...overrides,
  };
}

function lease(assigned) {
  const registry = new FileLeaseRegistry();
  const value = registry.reserve(assigned);
  assert.ok(value);
  return value;
}

test("rejects stale revision and stale file hash with an explicit rerun outcome", async () => {
  const current = await project();
  const assigned = task(current);
  assert.throws(
    () => validatePatchBundle({ bundle: bundle(current, assigned, undefined, { baseRevision: current.revision + 1 }), task: assigned, project: current, lease: lease(assigned) }),
    (error) => error instanceof PatchValidationError && error.code === "stale-base" && error.rerunRequired,
  );
  const staleHash = bundle(current, assigned);
  staleHash.expectedFileHashes["components/AgentPatch.tsx"] = "f".repeat(64);
  assert.throws(
    () => validatePatchBundle({ bundle: staleHash, task: assigned, project: current, lease: lease(assigned) }),
    (error) => error instanceof PatchValidationError && error.code === "stale-hash" && error.rerunRequired,
  );
});

test("rejects paths outside a lease and protected paths", async () => {
  const current = await project();
  const assigned = task(current);
  assert.throws(
    () => validatePatchBundle({ bundle: bundle(current, assigned, "lib/escape.ts"), task: assigned, project: current, lease: lease(assigned) }),
    (error) => error instanceof PatchValidationError && error.code === "outside-lease",
  );
  const protectedTask = task(current, "protected", { protectedScopes: ["components/Protected.tsx"] });
  assert.throws(
    () => validatePatchBundle({ bundle: bundle(current, protectedTask, "components/Protected.tsx"), task: protectedTask, project: current, lease: lease(protectedTask) }),
    (error) => error instanceof PatchValidationError && error.code === "protected-path",
  );
});

test("rejects secret-bearing source and unsafe dependency changes before merge", async () => {
  const current = await project();
  const assigned = task(current);
  const secret = bundle(current, assigned);
  secret.operations[0].content = 'export const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";';
  assert.throws(
    () => validatePatchBundle({ bundle: secret, task: assigned, project: current, lease: lease(assigned) }),
    (error) => error instanceof PatchValidationError && error.code === "secret-detected",
  );
  const dependency = bundle(current, assigned, "components/AgentPatch.tsx", {
    expectedFileHashes: {
      "components/AgentPatch.tsx": null,
      "package.json": current.files["package.json"].hash,
    },
    dependencyChanges: [{ name: "unsafe-package", version: "latest", dev: false, action: "add" }],
  });
  assert.throws(
    () => validatePatchBundle({ bundle: dependency, task: assigned, project: current, lease: lease(assigned) }),
    (error) => error instanceof PatchValidationError && error.code === "dependency-policy",
  );
});

test("atomic merge rolls back every operation when a later operation fails", async () => {
  const current = await project();
  const before = structuredClone(current);
  const frontend = task(current, "a-frontend");
  const backend = task(current, "z-backend", { role: "backend", writeScopes: ["lib/**"], readScopes: ["lib/**"] });
  const invalidDelete = bundle(current, backend, "lib/missing.ts", {
    role: "backend",
    expectedFileHashes: { "lib/missing.ts": null },
    operations: [{ type: "delete", path: "lib/missing.ts" }],
  });
  await assert.rejects(
    () => mergePatchBundlesAtomically({
      project: current,
      proposals: [
        { task: frontend, lease: lease(frontend), bundle: bundle(current, frontend) },
        { task: backend, lease: lease(backend), bundle: invalidDelete },
      ],
    }),
    /not part of this project/i,
  );
  assert.deepEqual(current, before);
});

test("conflicting bundles are rejected with rerun-required and canonical state unchanged", async () => {
  const current = await project();
  const first = task(current, "first");
  const second = task(current, "second");
  const future = new Date(Date.now() + 60_000).toISOString();
  const result = await mergePatchBundlesAtomically({
    project: current,
    proposals: [
      { task: first, lease: { leaseId: "one", taskId: "first", baseRevision: current.revision, patterns: ["components/**"], expiresAt: future }, bundle: bundle(current, first) },
      { task: second, lease: { leaseId: "two", taskId: "second", baseRevision: current.revision, patterns: ["components/**"], expiresAt: future }, bundle: bundle(current, second) },
    ],
  });
  assert.equal(result.status, "rerun-required");
  assert.equal(result.code, "bundle-conflict");
  assert.equal(result.project.contentHash, current.contentHash);
});

test("typed exact-semver dependency changes update package.json and manifest deterministically", async () => {
  const current = await project();
  const assigned = task(current);
  const proposal = bundle(current, assigned, "components/WithDependency.tsx", {
    expectedFileHashes: {
      "components/WithDependency.tsx": null,
      "package.json": current.files["package.json"].hash,
    },
    dependencyChanges: [{ name: "nanoid", version: "5.1.5", dev: false, action: "add" }],
  });
  const result = await mergePatchBundlesAtomically({
    project: current,
    proposals: [{ task: assigned, lease: lease(assigned), bundle: proposal }],
    now: () => new Date("2026-07-30T10:01:00.000Z"),
  });
  assert.equal(result.status, "merged");
  assert.equal(result.project.manifest.dependencies.nanoid, "5.1.5");
  assert.equal(JSON.parse(result.project.files["package.json"].content).dependencies.nanoid, "5.1.5");
});
