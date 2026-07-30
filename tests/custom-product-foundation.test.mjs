import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`, projectRoot).href,
    };
  },
});

const [
  { presets, customProductPreset, getProjectPreset },
  { routeProductIntent },
  { createProjectSpec },
  { validateProjectSpec },
  { compileProject },
  { fallbackAgentPlan },
  { inspectServerReleaseRuntime },
] = await Promise.all([
  import("../lib/presets.ts"),
  import("../lib/product-intent.ts"),
  import("../lib/project-factory.ts"),
  import("../lib/project-validator.ts"),
  import("../lib/project-compiler.ts"),
  import("../lib/product-blueprint.ts"),
  import("../lib/server-release-quality.ts"),
]);

function customSpec(prompt = "Build a treasury runway simulator with market context and alert handoffs") {
  return createProjectSpec({
    presetId: "custom-product",
    values: {},
    prompt,
    tools: [],
    provider: "free",
    model: "Free Auto",
    market: [
      { symbol: "BTC", name: "Bitcoin", price: "$68,120", change: 2.1, marketCap: "$1.34T" },
      { symbol: "ETH", name: "Ethereum", price: "$3,420", change: -0.8, marketCap: "$411B" },
      { symbol: "SOL", name: "Solana", price: "$171", change: 4.2, marketCap: "$81B" },
    ],
    prediction: { title: "No prediction selected", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
}

test("custom-product stays hidden from the 12 visible recipes", () => {
  assert.equal(presets.length, 12);
  assert.ok(!presets.some((preset) => preset.id === "custom-product"));
  assert.equal(customProductPreset.id, "custom-product");
  assert.equal(getProjectPreset("custom-product").id, "custom-product");
});

test("unknown free-form requests route to the bounded custom foundation", () => {
  assert.equal(
    routeProductIntent("Build a treasury runway simulator for protocol operators").presetId,
    "custom-product",
  );
  assert.equal(routeProductIntent("Create a Telegram alpha channel").presetId, "alpha-channel");
  assert.equal(routeProductIntent("Make a playable crypto arcade game").presetId, "crypto-game");
  assert.equal(routeProductIntent("Category ( custom-product )\nUser change: add a comparison screen").presetId, "custom-product");
});

test("fallback planning creates an editable screen, module and component graph", () => {
  const plan = fallbackAgentPlan("Build a token treasury runway simulator for protocol operators");
  assert.equal(plan.presetId, "custom-product");
  assert.equal(plan.experience?.archetype, "modular-crypto-app");
  assert.ok(plan.customGraph);
  assert.ok(plan.customGraph.screens.length >= 3);
  assert.ok(plan.customGraph.modules.length >= 3);
  assert.ok(plan.customGraph.components.length >= 6);
  assert.ok(plan.customGraph.components.some((component) => component.dataSource === "market"));
  assert.ok(plan.customGraph.components.some((component) => component.actions.includes("configure-dropsbot")));
});

test("custom graph validation enforces bounded safe primitives and references", () => {
  const base = customSpec();
  const malicious = validateProjectSpec({
    ...base,
    customGraph: {
      version: 99,
      appKind: "<script>alert(1)</script>",
      initialScreenId: "../../escape",
      components: Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? "../evil" : `component-${index}`,
        title: index === 0 ? "<img src=x onerror=alert(1)>" : `Component ${index}`,
        description: "Bounded component",
        kind: index === 0 ? "executable-code" : "market-table",
        dataSource: index === 0 ? "private-key" : "market",
        actions: ["execute-trade", "open-dropstab", "configure-dropsbot"],
        span: "full",
      })),
      modules: [{ id: "core", title: "Core", description: "Core module", componentIds: ["../evil", "missing", "component-1"] }],
      screens: [{ id: "home", title: "Home", route: "https://evil.example", layout: "grid", componentIds: ["../evil", "missing", "component-1"] }],
    },
  });

  assert.equal(malicious.customGraph?.version, 1);
  assert.ok((malicious.customGraph?.components.length ?? 0) <= 18);
  assert.ok(malicious.customGraph?.components.every((component) => !/[<>./]/.test(component.id)));
  assert.ok(malicious.customGraph?.components.every((component) => component.kind !== "executable-code"));
  assert.ok(malicious.customGraph?.components.every((component) => component.actions.every((action) => action !== "execute-trade")));
  assert.ok(malicious.customGraph?.screens.every((screen) => /^\/[a-z0-9/-]*$/.test(screen.route)));
  const componentIds = new Set(malicious.customGraph?.components.map((component) => component.id));
  assert.ok(malicious.customGraph?.screens.every((screen) => screen.componentIds.every((id) => componentIds.has(id))));
  assert.ok(malicious.customGraph?.modules.every((module) => module.componentIds.every((id) => componentIds.has(id))));
});

test("custom compiler renders a stateful standalone modular app without executable model code", () => {
  const spec = customSpec("Build a treasury runway simulator with watchlists, notes and alert setup");
  const html = compileProject(spec);

  assert.match(html, /data-project-kind="custom-product"/);
  assert.match(html, /data-experience="modular-crypto-app"/);
  assert.match(html, /function renderCustomProduct\(\)/);
  assert.match(html, /data-custom-screen=/);
  assert.match(html, /data-custom-component=/);
  assert.match(html, /data-custom-action="(?:favorite|compare|save-local|configure-dropsbot)"/);
  assert.match(html, /localStorage/);
  assert.match(html, /refreshData/);
  assert.match(html, /dropsbotSetup/);
  assert.match(html, /DropsTab/);
  assert.match(html, /Drops Bot/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /\beval\s*\(|new Function/);

  const runtime = inspectServerReleaseRuntime(spec, html, "dropstab");
  assert.deepEqual(runtime.errors, []);
  assert.equal(runtime.runtime, true);
  assert.equal(runtime.interactions, true);
  assert.equal(runtime.dropstab, true);
  assert.equal(runtime.dropsbot, true);
  assert.equal(runtime.actions, true);
});
