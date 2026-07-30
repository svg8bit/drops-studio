import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

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

const { createProjectSpec } = await import("../lib/project-factory.ts");
const { materializeProjectV2Template } = await import("../lib/project-template-materializer.ts");
const {
  BuilderAgentSession,
  materializedProjectDeterministicFallback,
  runBuilderAgent,
} = await import("../lib/builder-agent/index.ts");
const { VercelAgentBrowserChecker } = await import("../lib/vercel-agent-browser-checker.ts");
const { VercelSandboxRuntimeAdapter } = await import("../lib/vercel-sandbox-runtime-adapter.ts");

const permissions = new Set([
  "files:read",
  "files:write",
  "runtime:execute",
  "runtime:network",
  "preview:start",
  "browser:check",
  "checkpoint:write",
  "checkpoint:restore",
  "connection:request",
  "project:publish",
]);

test("live Project V2 flow installs, checks, builds, previews, browser-tests and checkpoints", {
  skip: process.env.DROPS_STUDIO_LIVE_BUILDER !== "1",
  timeout: 12 * 60_000,
}, async () => {
  const actorId = `live-builder-${Date.now().toString(36)}`;
  const requestId = `live-request-${Date.now().toString(36)}`;
  const spec = createProjectSpec({
    presetId: "smart-money-copy",
    values: {},
    prompt: "Build a whale intelligence dashboard with wallet enrichment and approved Telegram alerts.",
    tools: ["DropsTab API", "Drops Bot", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  let stored = await materializeProjectV2Template({
    id: `live-whale-${Date.now().toString(36)}`,
    spec,
  });
  const repository = {
    async loadAuthorized(candidateActor, projectId) {
      return candidateActor === actorId && projectId === stored.id
        ? structuredClone(stored)
        : null;
    },
    async saveAuthorized(candidateActor, project, expectedRevision) {
      assert.equal(candidateActor, actorId);
      assert.equal(project.id, stored.id);
      assert.equal(expectedRevision, stored.revision);
      stored = structuredClone(project);
      return structuredClone(stored);
    },
  };
  const audit = { async record() {} };
  const runtime = new VercelSandboxRuntimeAdapter({ audit });
  let finalProject = stored;
  try {
    const session = new BuilderAgentSession({
      actorId,
      requestId,
      project: stored,
      repository,
      runtime,
      permissions,
      audit,
      browser: new VercelAgentBrowserChecker(),
    });
    const result = await runBuilderAgent({
      projectId: stored.id,
      prompt: spec.prompt,
      mode: "build",
      provider: { provider: "free" },
      approvedTools: [],
    }, {
      services: session,
      audit,
      deterministicFallback: materializedProjectDeterministicFallback,
    });
    finalProject = result.project;
    const releaseEvidence = JSON.stringify({
      summary: result.summary,
      status: result.status,
      checks: result.releaseGate.checks.map((check) => ({
        name: check.name,
        status: check.status,
        summary: check.summary,
        ...(check.browser
          ? {
              pageErrors: check.browser.pageErrors,
              consoleErrors: check.browser.consoleErrors,
              networkErrors: check.browser.networkErrors,
            }
          : {}),
      })),
      blockingErrors: result.releaseGate.blockingErrors,
    });
    assert.equal(result.status, "fallback", releaseEvidence);
    assert.equal(result.providerMode, "deterministic-fallback");
    assert.equal(result.releaseGate.ok, true);
    assert.match(result.releaseGate.previewUrl ?? "", /^https:\/\/[a-z0-9.-]+\.vercel\.run\/?$/i);
    assert.deepEqual(
      result.releaseGate.checks.map((check) => [check.name, check.status]),
      [
        ["install", "passed"],
        ["typecheck", "passed"],
        ["lint", "passed"],
        ["tests", "passed"],
        ["build", "passed"],
        ["preview", "passed"],
        ["browser", "passed"],
      ],
    );
    assert.equal(result.project.checkpoints.length, 1);
    assert.ok(result.project.runs.length >= 6);
    assert.ok(result.project.logs.some((entry) => entry.stream === "browser"));
  } finally {
    const handle = await runtime.ensure({ actorId, requestId, project: finalProject });
    await runtime.destroy(handle);
  }
});
