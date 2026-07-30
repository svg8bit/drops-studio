import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  composeRuntimeSystemPrompt,
  extractRuntimeSystemPrompt,
  loadRuntimeSystemPrompt,
} = await import("../lib/agent/system/index.ts");
const { createAgentRuntimeVersions } = await import(
  "../lib/agent/system/versions.ts"
);

function model() {
  return {
    provider: "openai",
    model: "gpt-test",
    displayName: "GPT Test",
    authorized: true,
    source: "user-byok",
    supportsTools: true,
    supportsParallelTools: true,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsEmbeddings: false,
    maxContextTokens: 128_000,
    maxOutputTokens: 16_000,
    latencyClass: "balanced",
    qualityClass: "standard",
    cost: {
      inputPerMillion: 1,
      cachedInputPerMillion: 0.1,
      outputPerMillion: 4,
      currency: "USD",
    },
    allowedRoles: ["planner"],
    verifiedAt: "2026-07-30T12:00:00.000Z",
  };
}

test("canonical runtime loader extracts only the unique marked v2 core", async () => {
  const source = await readFile(
    new URL("../docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md", import.meta.url),
    "utf8",
  );
  const runtime = extractRuntimeSystemPrompt(source, "canonical.md");
  assert.equal(runtime.version, "2.0.0");
  assert.match(runtime.content, /^# Drops Studio Agent/);
  assert.doesNotMatch(runtime.content, /## Loader contract/);
  assert.match(runtime.contentHash, /^[a-f0-9]{64}$/);

  const loaded = await loadRuntimeSystemPrompt();
  assert.equal(loaded.contentHash, runtime.contentHash);
  assert.throws(
    () => extractRuntimeSystemPrompt("**Version:** 2.0.0\nno markers"),
    /exactly one marker pair/,
  );
});

test("runtime prompt composition is deterministic and pins every reproducibility version", async () => {
  const core = await loadRuntimeSystemPrompt();
  const versions = createAgentRuntimeVersions({
    projectRevision: "revision-42",
    selectedSkillVersions: [
      { id: "security-review", version: "3.0.0" },
      { id: "dropstab-intelligence", version: "2.1.0" },
    ],
  });
  const base = {
    core,
    role: "planner",
    model: model(),
    routingMode: "selected-only",
    approvalState: { deploy: false },
    task: {
      goal: "Plan whale intelligence",
      mode: "plan",
      explicitConstraints: ["No external mutation"],
      requestedIntegrations: ["dropstab"],
    },
    projectMemory: { revision: "revision-42", purpose: "whale intelligence" },
    selectedSkills: [
      { id: "security-review", version: "3.0.0", instructions: "Inspect evidence." },
      { id: "dropstab-intelligence", version: "2.1.0", instructions: "Use server adapter." },
    ],
    retrievedContext: [
      { id: "b", source: "project", version: "2", trust: "project", content: "B" },
      { id: "a", source: "dropstab", version: "1", trust: "trusted", content: "A" },
    ],
    runtimeEvidence: { preview: "unavailable" },
    integrationEvidence: { dropstab: "setup-required" },
    versions,
  };
  const first = composeRuntimeSystemPrompt(base);
  const second = composeRuntimeSystemPrompt({
    ...base,
    selectedSkills: [...base.selectedSkills].reverse(),
    retrievedContext: [...base.retrievedContext].reverse(),
  });
  assert.equal(first.promptHash, second.promptHash);
  assert.equal(first.moduleHash, second.moduleHash);
  assert.equal(first.versions.projectRevision, "revision-42");
  assert.equal(first.versions.routingPolicyVersion, "2.0.0");
  assert.equal(first.versions.contextCompilerVersion, "2.0.0");
  assert.equal(first.versions.modelRegistryVersion, "2.0.0");
  assert.equal(first.versions.rolePromptVersions.planner, "2.0.0");
  assert.deepEqual(
    first.versions.selectedSkillVersions.map((skill) => skill.id),
    ["dropstab-intelligence", "security-review"],
  );
  assert.equal(first.prompt.includes("providerKey"), false);
});

test("runtime composition rejects unauthorized model metadata", async () => {
  const core = await loadRuntimeSystemPrompt();
  assert.throws(
    () =>
      composeRuntimeSystemPrompt({
        core,
        role: "planner",
        model: { ...model(), authorized: false },
        routingMode: "selected-only",
        approvalState: {},
        task: {
          goal: "Plan",
          mode: "plan",
          explicitConstraints: [],
          requestedIntegrations: [],
        },
        projectMemory: {},
        selectedSkills: [],
        retrievedContext: [],
        runtimeEvidence: {},
        integrationEvidence: {},
        versions: createAgentRuntimeVersions({ projectRevision: "one" }),
      }),
    /unauthorized model/,
  );
});
