import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import test from "node:test";

import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const { createProjectSpec } = await import("../lib/project-factory.ts");
const buildRunModule = await import("../lib/build-run.ts").catch(() => null);
const { POST: generateProject } = await import("../app/api/generate/route.ts");

function createBaseSpec(provider = "free") {
  return createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a focused market research explorer",
    tools: ["DropsTab market data", "Drops Bot action handoff"],
    provider,
    model: provider === "free" ? "Free Auto" : "gpt-5.2",
    market: [],
    prediction: {
      title: "No prediction selected",
      probability: null,
      change: null,
    },
    origin: "http://localhost",
  });
}

function requestBody(spec, overrides = {}) {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      key: "test-key",
      model: "gpt-5.2",
      prompt: "Polish the market explorer",
      spec,
      ...overrides,
    }),
  });
}

async function withFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a selected BYOK provider is not attributed before a valid provider response", () => {
  const spec = createBaseSpec("openai");

  assert.deepEqual(spec.brain, {
    provider: "free",
    model: "Free compiler",
    enhanced: false,
  });
});

test("BuildRun enhances, validates, compiles and inspects within one model call", async () => {
  assert.ok(buildRunModule, "BuildRun orchestration module must exist");
  const signals = [];
  const result = await buildRunModule.runBuildRun({
    spec: createBaseSpec(),
    provider: "openai",
    model: "gpt-5.2",
    prompt: "Polish the market explorer",
    callModel: async ({ mode, signal }) => {
      signals.push(signal);
      assert.equal(mode, "enhance");
      return { tagline: "Research crypto markets with a sharper daily workflow" };
    },
  });

  assert.equal(result.spec.brain.provider, "openai");
  assert.equal(result.spec.brain.model, "gpt-5.2");
  assert.equal(result.spec.brain.enhanced, true);
  assert.equal(result.run.status, "enhanced");
  assert.equal(result.run.modelCalls, 1);
  assert.equal(result.run.maxModelCalls, 2);
  assert.ok(result.run.timeBudgetMs > 0);
  assert.ok(result.html.includes("data-project-kind=\"crypto-aggregator\""));
  assert.ok(result.quality.readyToPublish);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.ok(result.run.trace.some((entry) => entry.action === "model-enhance" && entry.status === "succeeded"));
  assert.ok(result.run.trace.some((entry) => entry.action === "inspect" && entry.status === "succeeded"));
});

test("BuildRun performs at most one model-assisted repair", async () => {
  assert.ok(buildRunModule, "BuildRun orchestration module must exist");
  const modes = [];
  const result = await buildRunModule.runBuildRun({
    spec: createBaseSpec(),
    provider: "openai",
    model: "gpt-5.2",
    prompt: "Polish the market explorer",
    callModel: async ({ mode, criticalFailures }) => {
      modes.push(mode);
      if (mode === "enhance") return { description: "Explore the full DropsTab universe" };
      assert.ok(criticalFailures.includes("truthfulness"));
      return { description: "Explore the full DropsTab universe" };
    },
  });

  assert.deepEqual(modes, ["enhance", "repair"]);
  assert.equal(result.run.modelCalls, 2);
  assert.equal(result.run.maxModelCalls, 2);
  assert.equal(result.run.status, "incomplete");
  assert.ok(result.quality.criticalFailures.includes("truthfulness"));
  assert.equal(result.run.trace.filter((entry) => entry.action === "model-repair").length, 1);
});

test("BuildRun rejects unrecognized model output and explicitly falls back to Free compiler", async () => {
  assert.ok(buildRunModule, "BuildRun orchestration module must exist");
  const result = await buildRunModule.runBuildRun({
    spec: createBaseSpec("openai"),
    provider: "openai",
    model: "gpt-5.2",
    prompt: "Polish the market explorer",
    callModel: async () => ({ html: "<script>not allowed</script>" }),
  });

  assert.deepEqual(result.spec.brain, {
    provider: "free",
    model: "Free compiler",
    enhanced: false,
  });
  assert.equal(result.run.status, "fallback");
  assert.equal(result.run.modelCalls, 1);
  assert.match(result.warning, /Free compiler/i);
  assert.ok(result.run.trace.some((entry) => entry.action === "model-enhance" && entry.status === "failed"));
});

test("an already planned product uses the authoritative compile and inspect run without another model call", async () => {
  const spec = createBaseSpec();
  const result = await buildRunModule.runValidatedBuild({ spec });

  assert.equal(result.run.status, "compiled");
  assert.equal(result.run.modelCalls, 0);
  assert.equal(result.spec.presetId, spec.presetId);
  assert.equal(result.spec.brain.provider, spec.brain.provider);
  assert.ok(result.quality.readyToPublish);
  assert.ok(result.run.trace.some((entry) => entry.action === "compile" && entry.status === "succeeded"));
  assert.ok(result.run.trace.some((entry) => entry.action === "inspect" && entry.status === "succeeded"));
});

test("BuildRun contains a deterministic compiler failure behind a safe error", () => {
  const source = String.raw`
    import { registerHooks } from "node:module";

    const projectRoot = new URL("./", import.meta.url);
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.endsWith("project-compiler.ts") && context.parentURL?.endsWith("/lib/build-run.ts")) {
          return {
            shortCircuit: true,
            url: "data:text/javascript," + encodeURIComponent(
              'export function compileProject(){ throw new Error("Bearer sk-fallback-secret-token"); }',
            ),
          };
        }
        if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
        const projectPath = specifier.slice(2);
        return {
          shortCircuit: true,
          url: new URL(projectPath.endsWith(".ts") ? projectPath : projectPath + ".ts", projectRoot).href,
        };
      },
    });

    const { createProjectSpec } = await import("./lib/project-factory.ts");
    const { runBuildRun } = await import("./lib/build-run.ts");
    const spec = createProjectSpec({
      presetId: "crypto-aggregator",
      values: {},
      prompt: "Build a focused market explorer",
      tools: ["DropsTab market data"],
      provider: "free",
      model: "Free Auto",
      market: [],
      prediction: { title: "No prediction selected", probability: null, change: null },
      origin: "http://localhost",
    });

    try {
      await runBuildRun({
        spec,
        provider: "openai",
        model: "gpt-5.2",
        prompt: "Polish it",
        callModel: async () => ({ html: "unsupported" }),
      });
      console.log(JSON.stringify({ resolved: true }));
    } catch (error) {
      console.log(JSON.stringify({
        resolved: false,
        name: error?.name,
        message: error?.message,
        trace: error?.trace,
      }));
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.resolved, false);
  assert.equal(payload.name, "BuildRunFallbackError");
  assert.match(payload.message, /Free compiler artifact could not be produced/i);
  assert.doesNotMatch(payload.message, /sk-fallback-secret-token/);
  assert.ok(payload.trace.some((entry) => entry.action === "finalize" && entry.status === "failed"));
});

test("generate route repairs a model-enhanced artifact once and returns the action trace", async () => {
  const responses = [
    { description: "Explore the full DropsTab universe" },
    { description: "Research the market with transparent data boundaries" },
  ];
  let calls = 0;

  const response = await withFetch(async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    const enhancement = responses[calls++];
    return Response.json({
      choices: [{ message: { content: JSON.stringify(enhancement) } }],
    });
  }, () => generateProject(requestBody(createBaseSpec("openai"))));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(payload.spec.brain.provider, "openai");
  assert.equal(payload.spec.brain.enhanced, true);
  assert.equal(payload.run.status, "repaired");
  assert.equal(payload.run.modelCalls, 2);
  assert.ok(payload.run.trace.some((entry) => entry.action === "model-repair" && entry.status === "succeeded"));
  assert.equal("html" in payload, false);
});

test("generate route keeps the build usable and truthful when the provider fails", async () => {
  const response = await withFetch(async () => Response.json(
    { error: { message: "Invalid API key" } },
    { status: 401 },
  ), () => generateProject(requestBody(createBaseSpec("openai"))));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.spec.brain, {
    provider: "free",
    model: "Free compiler",
    enhanced: false,
  });
  assert.equal(payload.run.status, "fallback");
  assert.equal(payload.run.modelCalls, 1);
  assert.match(payload.warning, /Free compiler/i);
});

test("generate route runs Free and Gateway plans through the same server release inspection", async () => {
  const response = await generateProject(requestBody(createBaseSpec(), {
    provider: "free",
    key: undefined,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.run.status, "compiled");
  assert.equal(payload.run.modelCalls, 0);
  assert.equal(payload.quality.readyToPublish, true);
  assert.equal("html" in payload, false);
});

test("generate route rejects cross-origin and oversized build requests before processing", async () => {
  const localAlias = new NextRequest("http://localhost:4173/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
    },
    body: JSON.stringify({ provider: "free", spec: createBaseSpec() }),
  });
  const localAliasResponse = await generateProject(localAlias);
  assert.equal(localAliasResponse.status, 200);

  const crossOrigin = new NextRequest("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: JSON.stringify({ provider: "free", spec: createBaseSpec() }),
  });
  const crossOriginResponse = await generateProject(crossOrigin);
  assert.equal(crossOriginResponse.status, 403);

  const oversized = new NextRequest("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(512 * 1024 + 1),
    },
    body: "{}",
  });
  const oversizedResponse = await generateProject(oversized);
  assert.equal(oversizedResponse.status, 413);
});
