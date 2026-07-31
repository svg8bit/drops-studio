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

const { projectPresetIds } = await import("../lib/presets.ts");
const { findArtifactSecrets } = await import("../lib/artifact-security.ts");
const { createProjectSpec } = await import("../lib/project-factory.ts");
const {
  materializeProjectV2Template,
  refreshGeneratedProjectV2Template,
} = await import("../lib/project-template-materializer.ts");
const { writeProjectV2File } = await import("../lib/project-v2-files.ts");
const { projectTemplateComponentSource } = await import("../lib/project-template-ui.ts");
const { validateProjectV2 } = await import("../lib/project-v2-validator.ts");

const categoryExpectations = {
  "action-engine": ["ActionEngine", "Thesis graph"],
  "alpha-channel": ["AlphaChannel", "Editorial composer"],
  "morning-alpha": ["MorningAlpha", "Priority brief"],
  "prediction-impact": ["PredictionImpact", "Impact graph"],
  "smart-money-copy": ["WhaleIntelligence", "Tracked wallets"],
  "crypto-aggregator": ["MarketExplorer", "Coin search"],
  "crypto-game": ["MarketGame", "MARKET MOMENTUM RUN"],
  "personal-companion": ["PersonalCompanion", "Memory controls"],
  "portfolio-tamagotchi": ["PortfolioPal", "Feed research"],
  "crypto-product-hunt": ["ProductHunt", "Submission studio"],
  "crypto-radio": ["CryptoRadio", "Rundown editor"],
  "crypto-siri": ["CryptoAssistant", "Evidence drawer"],
  "custom-product": ["CustomProduct", "PROMPT-DERIVED MODULES"],
};

const categoryComponentPattern = /function (?:ActionEngine|AlphaChannel|MorningAlpha|PredictionImpact|WhaleIntelligence|MarketExplorer|MarketGame|PersonalCompanion|PortfolioPal|ProductHunt|CryptoRadio|CryptoAssistant|CustomProduct)\(\)/g;

test("materializes all 12 recipes and custom into runnable Next React TypeScript Tailwind projects", async () => {
  assert.equal(projectPresetIds.length, 13);
  const renderedSources = new Set();
  for (const presetId of projectPresetIds) {
    const spec = createProjectSpec({
      presetId,
      values: {},
      prompt: `Build a category-native ${presetId} product`,
      tools: ["DropsTab API", "Drops Bot"],
      provider: "free",
      model: "Free compiler",
      market: [],
      prediction: { title: "No prediction", probability: null, change: null },
      origin: "https://drops-studio.example",
    });
    const project = await materializeProjectV2Template({
      id: `template-${presetId}`,
      spec,
      now: "2026-07-30T12:00:00.000Z",
    });
    const packageJson = JSON.parse(project.files["package.json"].content);
    assert.equal(project.manifest.framework.name, "nextjs", presetId);
    assert.equal(project.manifest.runtime.version, "24", presetId);
    assert.equal(packageJson.dependencies.next, "16.2.12", presetId);
    assert.equal(packageJson.scripts.lint, "eslint .", presetId);
    assert.equal(JSON.parse(project.files["tsconfig.json"].content).compilerOptions.esModuleInterop, true, presetId);
    assert.ok(project.files["app/page.tsx"], presetId);
    assert.ok(project.files["app/icon.svg"], presetId);
    assert.match(project.files["next.config.ts"].content, /allowedDevOrigins: \["\*\.vercel\.run"\]/, presetId);
    assert.ok(project.files["app/api/capabilities/dropstab/route.ts"], presetId);
    assert.ok(project.files["lib/dropstab-server.ts"], presetId);
    assert.ok(project.files["lib/use-dropstab-coins.ts"], presetId);
    assert.ok(project.files["tests/dropstab-capability.test.mjs"], presetId);
    assert.ok(project.files["eslint.config.mjs"], presetId);
    assert.match(project.files["postcss.config.mjs"].content, /const config =/, presetId);
    assert.ok(project.files["app/globals.css"].content.includes('@import "tailwindcss"'), presetId);
    const component = project.files["components/crypto-product.tsx"];
    const [componentName, categoryEvidence] = categoryExpectations[presetId];
    assert.ok(component.content.includes(spec.name), presetId);
    assert.match(component.content, new RegExp(`function ${componentName}\\(\\)`), presetId);
    assert.ok(component.content.includes(categoryEvidence), `${presetId}: ${categoryEvidence}`);
    assert.equal(component.content.match(categoryComponentPattern)?.length, 1, `${presetId}: one category runtime`);
    assert.doesNotMatch(component.content, /const products = \{/, `${presetId}: no unrelated runtime registry`);
    renderedSources.add(component.hash);
    assert.equal(project.manifest.legacyFallback.supported, presetId !== "custom-product", presetId);
    assert.equal(
      project.integrations.find((item) => item.id === "project-data")?.status,
      "setup-required",
      `${presetId}: project data must not claim availability before its capability is configured`,
    );
    assert.equal((await validateProjectV2(project)).contentHash, project.contentHash, presetId);
  }
  assert.equal(renderedSources.size, projectPresetIds.length, "each starter must materialize a distinct category source snapshot");
});

test("generated DropsTab /coins capability is server-only, bounded and honest", async () => {
  const spec = createProjectSpec({
    presetId: "crypto-aggregator",
    values: {},
    prompt: "Build a market explorer with live DropsTab evidence",
    tools: ["DropsTab API"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const project = await materializeProjectV2Template({ id: "dropstab-capability", spec, now: "2026-07-30T12:00:00.000Z" });
  const server = project.files["lib/dropstab-server.ts"].content;
  const client = project.files["lib/use-dropstab-coins.ts"].content;
  const route = project.files["app/api/capabilities/dropstab/route.ts"].content;
  const component = project.files["components/crypto-product.tsx"].content;
  const integration = project.integrations.find((item) => item.id === "dropstab");

  assert.match(server, /import "server-only"/);
  assert.match(server, /public-api\.dropstab\.com\/api\/v1\/coins\?page=0&pageSize=10/);
  assert.match(server, /process\.env\.DROPSTAB_API_KEY/);
  assert.match(server, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(server, /CACHE_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(server, /provider: "demo"/);
  assert.match(server, /verified: true/);
  assert.doesNotMatch(route, /process\.env|x-dropstab-api-key|public-api\.dropstab/);
  assert.doesNotMatch(client, /DROPSTAB_API_KEY|x-dropstab-api-key|public-api\.dropstab/);
  assert.doesNotMatch(component, /DROPSTAB_API_KEY|x-dropstab-api-key|public-api\.dropstab/);
  assert.match(component, /market\.snapshot\?\.coins/);
  assert.equal(integration?.proxyPath, "/api/capabilities/dropstab");
  assert.deepEqual(integration?.capabilities, ["coins"]);
});

test("refreshes generated V2 source from product edits without overwriting manual files", async () => {
  const spec = createProjectSpec({
    presetId: "crypto-radio",
    values: {},
    prompt: "Build a crypto radio",
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const base = await materializeProjectV2Template({
    id: "refresh-radio",
    spec,
    now: "2026-07-30T12:00:00.000Z",
  });
  const manual = await writeProjectV2File(base, base.revision, {
    type: "write",
    path: "README.md",
    content: "# Manually curated radio notes\n",
    provenance: "manual",
  });
  const withPreview = {
    ...manual,
    preview: {
      status: "ready",
      projectRevision: manual.revision,
      url: "https://radio-preview.vercel.run/",
      port: 3000,
      startedAt: "2026-07-30T12:01:00.000Z",
    },
  };
  const editedSpec = {
    ...spec,
    name: "Drops Signal Radio",
    slug: "drops-signal-radio",
    theme: { ...spec.theme, accent: "#a3ff12", surface: "#080d10" },
  };
  const refreshed = await refreshGeneratedProjectV2Template({
    project: withPreview,
    spec: editedSpec,
    now: "2026-07-30T12:02:00.000Z",
  });

  assert.equal(refreshed.revision, manual.revision + 1);
  assert.equal(refreshed.productSpec.name, "Drops Signal Radio");
  assert.equal(refreshed.manifest.slug, "drops-signal-radio");
  assert.match(refreshed.files["app/globals.css"].content, /--project-accent: #a3ff12/);
  assert.equal(refreshed.files["README.md"].content, "# Manually curated radio notes\n");
  assert.equal(refreshed.files["README.md"].provenance, "manual");
  assert.equal(refreshed.preview?.status, "stopped");
  assert.equal(refreshed.preview?.projectRevision, refreshed.revision);
  assert.equal((await validateProjectV2(refreshed)).contentHash, refreshed.contentHash);

  const noOp = await refreshGeneratedProjectV2Template({
    project: refreshed,
    spec: editedSpec,
    now: "2026-07-30T12:03:00.000Z",
  });
  assert.equal(noOp.revision, refreshed.revision);
});

test("crypto radio starter has working browser playback and evidence-first editorial controls", async () => {
  const spec = createProjectSpec({
    presetId: "crypto-radio",
    values: {},
    prompt: "Build a premium crypto radio",
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const project = await materializeProjectV2Template({
    id: "premium-radio",
    spec,
    now: "2026-07-30T12:00:00.000Z",
  });
  const component = project.files["components/crypto-product.tsx"].content;
  assert.match(component, /SpeechSynthesisUtterance/);
  assert.match(component, /Play briefing/);
  assert.match(component, /Four crypto desks, one broadcast/);
  assert.match(component, /Rundown editor/);
  assert.match(component, /const updateScript = \(value: string\)/);
  assert.match(component, /index === segmentIndex \? \{ \.\.\.item, script: value \} : item/);
  assert.match(component, /evidenceLabel\(market\)/);
  assert.match(component, /Drops Bot, Telegram and public distribution remain setup-required/);
});

test("mandatory vertical demos contain their real category interactions and honest boundaries", async () => {
  const cases = [
    ["smart-money-copy", ["Tracked wallets", "Enrichment context", "Approve alert", "no custody or trading"]],
    ["alpha-channel", ["Signal inbox", "Editorial composer", "Approve draft", "Telegram requires explicit approval"]],
    ["crypto-game", ["MARKET MOMENTUM RUN", "Momentum up", "Local score", "prices are labeled fixtures"]],
  ];
  for (const [presetId, evidence] of cases) {
    const spec = createProjectSpec({
      presetId,
      values: {},
      prompt: `Build the ${presetId} end-to-end demo`,
      tools: ["DropsTab API", "Drops Bot"],
      provider: "free",
      model: "Free compiler",
      market: [],
      prediction: { title: "No prediction", probability: null, change: null },
      origin: "https://drops-studio.example",
    });
    const project = await materializeProjectV2Template({ id: `vertical-${presetId}`, spec, now: "2026-07-30T12:00:00.000Z" });
    const source = project.files["components/crypto-product.tsx"].content;
    for (const text of evidence) assert.match(source, new RegExp(text, "i"), `${presetId}: ${text}`);
  }
});

test("custom collaborative SaaS prompts materialize a secret-free managed backend contract", async () => {
  const spec = createProjectSpec({
    presetId: "custom-product",
    values: {},
    prompt: "Build a multi-user whale intelligence SaaS with organizations, RBAC, auth, collaborative comments, wallet webhooks, jobs, realtime updates, audit and approved Telegram alerts.",
    tools: ["DropsTab API", "Drops Bot", "Telegram"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const project = await materializeProjectV2Template({ id: "managed-collaborative-saas", spec, now: "2026-07-30T12:00:00.000Z" });
  const manifest = JSON.parse(project.files["backend/manifest.json"].content);
  const schema = JSON.parse(project.files["backend/schema.json"].content);
  const policies = JSON.parse(project.files["backend/policies.json"].content);
  const integration = project.integrations.find((item) => item.id === "managed-backend");
  const environment = project.environment.find((item) => item.name === "DROPS_MANAGED_PROJECT_CAPABILITY");

  assert.equal(manifest.productionProvider, "setup-required-until-health-receipt");
  assert.deepEqual(Object.keys(schema.collections), ["wallet_events", "alerts", "comments", "workflow_items"]);
  assert.ok(policies.approvals.includes("telegram.publish"));
  assert.equal(integration?.status, "setup-required");
  assert.ok(integration?.capabilities.includes("collaboration"));
  assert.ok(integration?.capabilities.includes("enterprise-policy"));
  assert.equal(environment?.secret, true);
  assert.match(project.files["app/api/backend/status/route.ts"].content, /\.\.\/\.\.\/\.\.\/\.\.\/lib\/drops-managed-server/);
  assert.match(project.files["lib/drops-managed-server.ts"].content, /target\.origin !== origin/);
  assert.match(project.files["lib/drops-managed-server.ts"].content, /redirect: "error"/);
  assert.match(project.files["app/api/backend/collections/[collection]/route.ts"].content, /ALLOWED_COLLECTIONS/);
  assert.match(project.files["lib/use-managed-collection.ts"].content, /Browser-local demo · cloud setup required/);
  assert.match(project.files["components/crypto-product.tsx"].content, /useManagedCollection\("workflow_items"\)/);
  assert.ok(project.files["tests/managed-backend-manifest.test.mjs"]);
  const generatedSource = Object.values(project.files).map((file) => file.content).join("\n");
  assert.deepEqual(findArtifactSecrets(generatedSource, "managed collaborative template"), []);
  assert.equal((await validateProjectV2(project)).contentHash, project.contentHash);
});

test("dynamic template values are inserted verbatim without replacement-token expansion", () => {
  const spec = createProjectSpec({
    presetId: "custom-product",
    values: {},
    prompt: "Build a custom product",
    tools: [],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const source = projectTemplateComponentSource(spec, {
    eyebrow: "VALUE $&",
    headline: "Literal $` and $'",
    description: "Replacement tokens stay data",
    primaryAction: "Create",
    metrics: ["One", "Two", "Three"],
    blocks: ["A", "B", "C"],
  });
  assert.match(source, /VALUE \$&/);
  assert.match(source, /Literal \$` and \$'/);
  assert.doesNotMatch(source, /__PRODUCT_MODEL__|__MANAGED_IMPORT__/);
});
