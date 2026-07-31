import {
  canonicalProjectV2Json,
  hashProjectV2CanonicalState,
} from "./project-v2-hash.ts";
import {
  applyProjectV2FileOperations,
  createProjectV2File,
} from "./project-v2-files.ts";
import { assertProjectV2FileSetLimits } from "./project-v2-path.ts";
import type {
  BuilderTaskV2,
  ProjectFileLanguageV2,
  ProjectFileRoleV2,
  ProjectFileV2,
  ProjectIntegrationManifestV2,
  ProjectV2,
} from "./project-v2-types.ts";
import type { GeneratedProjectSpec } from "./project-types.ts";
import {
  PROJECT_TEMPLATE_DROPSTAB_CLIENT,
  PROJECT_TEMPLATE_DROPSTAB_ROUTE,
  PROJECT_TEMPLATE_DROPSTAB_SERVER,
  PROJECT_TEMPLATE_DROPSTAB_TEST,
  PROJECT_TEMPLATE_DROPSTAB_TYPES,
} from "./project-template-dropstab.ts";
import { validateProjectV2 } from "./project-v2-validator.ts";
import { validateProjectSpec } from "./project-validator.ts";
import {
  projectTemplateComponentSource,
  projectTemplateGlobalCss,
} from "./project-template-ui.ts";
import { projectManagedTemplate } from "./project-template-managed.ts";

interface CategoryTemplate {
  eyebrow: string;
  headline: string;
  description: string;
  primaryAction: string;
  metrics: [string, string, string];
  blocks: [string, string, string];
}

const categories: Record<GeneratedProjectSpec["presetId"], CategoryTemplate> = {
  "action-engine": {
    eyebrow: "DECISION ENGINE",
    headline: "Turn a sourced thesis into an approval-ready action plan",
    description: "Model triggers, invalidate assumptions and hand approved alerts to Drops Bot without executing a trade.",
    primaryAction: "Create thesis",
    metrics: ["Trigger confidence", "Risk budget", "Alert readiness"],
    blocks: ["Thesis graph", "Scenario checks", "Approval ledger"],
  },
  "alpha-channel": {
    eyebrow: "AI ALPHA CHANNEL",
    headline: "Compose sourced crypto posts from market, unlock and wallet context",
    description: "Every draft keeps its evidence trail and requires approval before Telegram delivery.",
    primaryAction: "Compose sourced post",
    metrics: ["Signals reviewed", "Sources attached", "Posts approved"],
    blocks: ["Signal inbox", "Editorial composer", "Telegram delivery"],
  },
  "morning-alpha": {
    eyebrow: "MORNING ALPHA",
    headline: "Start the day with a prioritized, sourced crypto brief",
    description: "Scan movers, unlocks and funding context before opening the underlying DropsTab research.",
    primaryAction: "Refresh brief",
    metrics: ["Priority assets", "Upcoming unlocks", "Research links"],
    blocks: ["Market pulse", "Decision brief", "Catalyst calendar"],
  },
  "prediction-impact": {
    eyebrow: "PREDICTION IMPACT",
    headline: "Map a prediction-market move to affected crypto assets",
    description: "Explore sensitivity and scenarios without presenting probability as certainty.",
    primaryAction: "Run scenario",
    metrics: ["Event probability", "Assets mapped", "Scenarios saved"],
    blocks: ["Odds signal", "Impact graph", "Scenario matrix"],
  },
  "smart-money-copy": {
    eyebrow: "WHALE INTELLIGENCE",
    headline: "Review wallet activity with market, FDV, unlock and funding context",
    description: "Score relevance, simulate locally and request an approved alert; no automatic trading or wallet custody.",
    primaryAction: "Add tracked wallet",
    metrics: ["Wallets tracked", "Events enriched", "Alerts approved"],
    blocks: ["Wallet event inbox", "Enrichment context", "Paper action ledger"],
  },
  "crypto-aggregator": {
    eyebrow: "CRYPTO EXPLORER",
    headline: "Search, rank and compare the market with sourced context",
    description: "Build watchlists and open official research without inventing unavailable live fields.",
    primaryAction: "Search coins",
    metrics: ["Assets indexed", "Comparisons", "Watchlist items"],
    blocks: ["Market table", "Coin comparison", "Research links"],
  },
  "crypto-game": {
    eyebrow: "MARKET GAME",
    headline: "Play a market round driven by the current available snapshot",
    description: "The game reacts to sourced market movement and labels local scores separately from live data.",
    primaryAction: "Start market round",
    metrics: ["Local score", "Current streak", "Snapshot assets"],
    blocks: ["Playable arena", "Market mechanics", "Challenge results"],
  },
  "personal-companion": {
    eyebrow: "CRYPTO COMPANION",
    headline: "Turn a personal watchlist into a focused daily research loop",
    description: "Recommendations explain their available evidence and keep preferences in demo-local storage.",
    primaryAction: "Set focus",
    metrics: ["Focus assets", "Briefs reviewed", "Alerts configured"],
    blocks: ["Daily focus", "Recommendations", "Memory controls"],
  },
  "portfolio-tamagotchi": {
    eyebrow: "PORTFOLIO TAMAGOTCHI",
    headline: "Care for a local portfolio character using honest market states",
    description: "Character mood reacts to available snapshot data; balances and scores remain local demo data.",
    primaryAction: "Check companion",
    metrics: ["Mood", "Care streak", "Assets watched"],
    blocks: ["Character habitat", "Care actions", "Market mood"],
  },
  "crypto-product-hunt": {
    eyebrow: "CRYPTO PRODUCT HUNT",
    headline: "Discover and curate crypto products with transparent moderation",
    description: "Local drafts work immediately; community submissions require the configured project-data backend.",
    primaryAction: "Submit product",
    metrics: ["Products reviewed", "Votes recorded", "Drafts saved"],
    blocks: ["Launch feed", "Category filters", "Submission studio"],
  },
  "crypto-radio": {
    eyebrow: "DROPS RADIO · MARKET INTELLIGENCE ON AIR",
    headline: "Crypto intelligence, always on",
    description: "Listen to a browser-generated market briefing, shape the rundown and inspect the evidence behind every segment.",
    primaryAction: "Play briefing",
    metrics: ["Stories queued", "Market sources", "Minutes on air"],
    blocks: ["Live desk", "Rundown editor", "Market frequency"],
  },
  "crypto-siri": {
    eyebrow: "CRYPTO ASSISTANT",
    headline: "Ask focused crypto questions and inspect the supporting context",
    description: "The assistant distinguishes cached/demo context from verified provider data and never executes wallet actions.",
    primaryAction: "Ask a question",
    metrics: ["Questions answered", "Sources opened", "Alerts requested"],
    blocks: ["Conversation", "Evidence drawer", "Safe actions"],
  },
  "custom-product": {
    eyebrow: "CUSTOM CRYPTO PRODUCT",
    headline: "A real editable workspace shaped around your requested product loop",
    description: "Extend routes, components, schemas and tests while keeping provider access behind server capabilities.",
    primaryAction: "Open product workflow",
    metrics: ["Modules ready", "Checks passing", "Connections configured"],
    blocks: ["Primary workflow", "Sourced data", "Local persistence"],
  },
};

const packageManifest = {
  name: "drops-project",
  version: "0.1.0",
  private: true,
  scripts: {
    dev: "next dev --hostname 0.0.0.0 --port 3000",
    build: "next build",
    start: "next start --hostname 0.0.0.0 --port 3000",
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    test: "node --test tests/*.mjs",
  },
  dependencies: {
    next: "16.2.12",
    react: "19.2.8",
    "react-dom": "19.2.8",
  },
  devDependencies: {
    "@tailwindcss/postcss": "4.2.1",
    "@types/node": "22.19.19",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    eslint: "9.39.1",
    "eslint-config-next": "16.2.12",
    tailwindcss: "4.2.1",
    typescript: "5.9.3",
  },
};

const tasks: BuilderTaskV2[] = [
  { id: "typecheck", label: "Typecheck", kind: "typecheck", command: "npm", args: ["run", "typecheck"], cwd: ".", timeoutMs: 120_000, approvalRequired: false },
  { id: "lint", label: "Lint", kind: "lint", command: "npm", args: ["run", "lint"], cwd: ".", timeoutMs: 120_000, approvalRequired: false },
  { id: "test", label: "Run tests", kind: "test", command: "npm", args: ["test"], cwd: ".", timeoutMs: 60_000, approvalRequired: false },
  { id: "build", label: "Production build", kind: "build", command: "npm", args: ["run", "build"], cwd: ".", timeoutMs: 300_000, approvalRequired: false },
  { id: "dev", label: "Start preview", kind: "dev", command: "npm", args: ["run", "dev"], cwd: ".", timeoutMs: 300_000, previewPort: 3000, approvalRequired: false },
];

function json(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function componentSource(spec: GeneratedProjectSpec, category: CategoryTemplate): string {
  return projectTemplateComponentSource(spec, category);
}

function sourceFiles(spec: GeneratedProjectSpec): Array<{
  path: string;
  content: string;
  language?: ProjectFileLanguageV2;
  role?: ProjectFileRoleV2;
}> {
  const category = categories[spec.presetId];
  const managed = projectManagedTemplate(spec);
  const integrationManifest: ProjectIntegrationManifestV2[] = [
    { id: "dropstab", kind: "dropstab", status: "demo", capabilities: ["coins"], proxyPath: "/api/capabilities/dropstab", providerEvidenceRequired: true },
    { id: "drops-bot", kind: "drops-bot", status: "setup-required", capabilities: ["wallet-events", "alerts", "webhooks"], proxyPath: "/api/capabilities/drops-bot", providerEvidenceRequired: true },
    { id: "telegram", kind: "telegram", status: "setup-required", capabilities: ["approved-delivery"], proxyPath: "/api/capabilities/telegram", providerEvidenceRequired: true },
    { id: "project-data", kind: "project-data", status: "setup-required", capabilities: ["demo-documents", "event-inbox"], proxyPath: "/api/project-data", providerEvidenceRequired: true },
    ...(managed.integration ? [managed.integration] : []),
  ];
  const environment = [
    { name: "DROPSTAB_API_KEY", description: "Optional server-side DropsTab credential.", required: false, secret: true, scope: "runtime" },
    { name: "DROPS_BOT_WEBHOOK_SECRET", description: "Optional server-side webhook verification secret.", required: false, secret: true, scope: "runtime" },
    ...managed.environment,
  ];
  return [
    { path: "package.json", content: json({ ...packageManifest, name: spec.slug }), language: "json", role: "manifest" },
    { path: "app/layout.tsx", content: `import type { Metadata } from "next";\nimport "./globals.css";\n\nexport const metadata: Metadata = { title: ${JSON.stringify(spec.name)}, description: ${JSON.stringify(spec.description)}, icons: { icon: "/icon.svg" } };\n\nexport default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }\n`, language: "tsx", role: "entry" },
    { path: "app/icon.svg", content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Drops Studio"><rect width="64" height="64" rx="16" fill="#07111f"/><path d="M32 10 49 29 32 54 15 29Z" fill="#67e8f9"/><path d="m32 19 9 11-9 14-9-14Z" fill="#0f172a"/></svg>\n`, language: "text", role: "asset" },
    { path: "app/page.tsx", content: `import { CryptoProduct } from "../components/crypto-product";\n\nexport default function Page() { return <CryptoProduct />; }\n`, language: "tsx", role: "entry" },
    { path: "app/globals.css", content: projectTemplateGlobalCss(spec), language: "css", role: "style" },
    { path: "components/crypto-product.tsx", content: componentSource(spec, category), language: "tsx", role: "component" },
    { path: "app/api/capabilities/dropstab/route.ts", content: PROJECT_TEMPLATE_DROPSTAB_ROUTE, language: "typescript", role: "integration" },
    { path: "lib/dropstab-types.ts", content: PROJECT_TEMPLATE_DROPSTAB_TYPES, language: "typescript", role: "integration" },
    { path: "lib/dropstab-server.ts", content: PROJECT_TEMPLATE_DROPSTAB_SERVER, language: "typescript", role: "integration" },
    { path: "lib/use-dropstab-coins.ts", content: PROJECT_TEMPLATE_DROPSTAB_CLIENT, language: "typescript", role: "integration" },
    { path: "lib/product-spec.ts", content: `export const productSpec = ${json({ presetId: spec.presetId, name: spec.name, tagline: spec.tagline, prompt: spec.prompt, experience: spec.experience, blueprint: spec.blueprint })} as const;\n`, language: "typescript", role: "source" },
    { path: "lib/drops-capabilities.ts", content: `export const dropsCapabilities = ${json(integrationManifest)} as const;\n\nexport type DropsCapabilityId = typeof dropsCapabilities[number]["id"];\n`, language: "typescript", role: "integration" },
    { path: "project.json", content: json(spec), language: "json", role: "config" },
    { path: "drops.config.json", content: json({ schemaVersion: 2, integrations: integrationManifest, truthfulFallback: "Demo data is never labelled live." }), language: "json", role: "integration" },
    { path: "environment.schema.json", content: json({ schemaVersion: 2, variables: environment }), language: "json", role: "config" },
    { path: "next.config.ts", content: `import type { NextConfig } from "next";\n\nconst config: NextConfig = { poweredByHeader: false, allowedDevOrigins: ["*.vercel.run"] };\nexport default config;\n`, language: "typescript", role: "config" },
    { path: "postcss.config.mjs", content: `const config = { plugins: { "@tailwindcss/postcss": {} } };\n\nexport default config;\n`, language: "javascript", role: "config" },
    { path: "eslint.config.mjs", content: `import { defineConfig, globalIgnores } from "eslint/config";\nimport nextVitals from "eslint-config-next/core-web-vitals";\nimport nextTypeScript from "eslint-config-next/typescript";\n\nexport default defineConfig([\n  ...nextVitals,\n  ...nextTypeScript,\n  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),\n]);\n`, language: "javascript", role: "config" },
    { path: "vercel.json", content: json({ framework: "nextjs", installCommand: "npm install --ignore-scripts" }), language: "json", role: "config" },
    { path: "tsconfig.json", content: json({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"], exclude: ["node_modules"] }), language: "json", role: "config" },
    { path: "tests/smoke.mjs", content: `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\n\nconst [page, component, config] = await Promise.all([readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../components/crypto-product.tsx", import.meta.url), "utf8"), readFile(new URL("../drops.config.json", import.meta.url), "utf8").then(JSON.parse)]);\nassert.match(page, /CryptoProduct/);\nassert.match(component, /${spec.presetId}/);\nassert.equal(config.truthfulFallback, "Demo data is never labelled live.");\nconsole.log("Project V2 smoke passed");\n`, language: "javascript", role: "test" },
    { path: "tests/dropstab-capability.test.mjs", content: PROJECT_TEMPLATE_DROPSTAB_TEST, language: "javascript", role: "test" },
    ...managed.files,
    { path: "README.md", content: `# ${spec.name}\n\nA category-native Drops Studio Project V2 built with Next.js, React, TypeScript and Tailwind CSS.\n\n## Run\n\n- \`npm install --ignore-scripts\`\n- \`npm run typecheck\`\n- \`npm run lint\`\n- \`npm test\`\n- \`npm run build\`\n- \`npm run dev\`\n\nThe same-origin \`/api/capabilities/dropstab\` route reads only the documented DropsTab \`/coins\` endpoint. \`DROPSTAB_API_KEY\` is read only by its server-only module; the browser receives normalized rows and explicit provider evidence. Without a configured key or a valid upstream response the route returns an embedded snapshot labelled \`demo\`, never live DropsTab data. Drops Bot and Telegram remain setup-required until confirmed by their providers.${managed.readme}\n`, language: "markdown", role: "documentation" },
  ];
}

export async function materializeProjectV2Template(input: {
  id: string;
  spec: GeneratedProjectSpec;
  now?: string;
}): Promise<ProjectV2> {
  const now = input.now ?? new Date().toISOString();
  const spec = validateProjectSpec(input.spec);
  const definitions = sourceFiles(spec);
  assertProjectV2FileSetLimits(definitions);
  const created = await Promise.all(
    definitions.map((definition) =>
      createProjectV2File({
        ...definition,
        provenance: "generated",
        now,
      }),
    ),
  );
  const files: Record<string, ProjectFileV2> = Object.fromEntries(
    created.map((file) => [file.path, file]),
  );
  const integrations = JSON.parse(files["drops.config.json"].content)
    .integrations as ProjectIntegrationManifestV2[];
  const environment = JSON.parse(files["environment.schema.json"].content)
    .variables as ProjectV2["environment"];
  const project: ProjectV2 = {
    schemaVersion: 2,
    id: input.id,
    revision: 1,
    contentHash: "",
    manifest: {
      schemaVersion: 2,
      name: spec.name,
      slug: spec.slug,
      packageManager: "npm",
      framework: { name: "nextjs", version: "16.2.12" },
      runtime: { name: "nodejs", version: "24" },
      scripts: { ...packageManifest.scripts },
      dependencies: { ...packageManifest.dependencies },
      devDependencies: { ...packageManifest.devDependencies },
      entrypoints: ["app/layout.tsx", "app/page.tsx"],
      legacyFallback: {
        supported: spec.presetId !== "custom-product",
        adapter: "legacy-html",
        reason: spec.presetId === "custom-product"
          ? "Custom Project V2 has no equivalent bounded legacy recipe."
          : "The deterministic V1 recipe remains available for compatibility if the V2 runtime is unavailable.",
        sourceSchemaVersion: 1,
      },
    },
    files,
    productSpec: spec,
    integrations,
    environment,
    permissions: [
      { id: "read-market", capability: "dropstab:read", effect: "allow", destructive: false, external: true },
      { id: "telegram-publish", capability: "telegram:publish", effect: "approval-required", destructive: false, external: true },
      { id: "wallet-action", capability: "wallet:execute", effect: "deny", destructive: true, external: true },
    ],
    tasks: tasks.map((task) => ({ ...task, args: [...task.args] })),
    runs: [],
    logs: [],
    checkpoints: [],
    migration: {
      sourceSchemaVersion: 2,
      sourceKind: "project-v2-template",
      sourceProjectId: input.id,
      sourceFidelity: "native",
      adapter: "native-v2",
      migratedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  project.contentHash = await hashProjectV2CanonicalState(project);
  return validateProjectV2(project);
}

/**
 * Re-materialize only files still owned by the deterministic template.
 * Manual and AI-authored files are intentionally preserved, while product
 * metadata and generated source advance together in one Project V2 revision.
 */
export async function refreshGeneratedProjectV2Template(input: {
  project: ProjectV2;
  spec: GeneratedProjectSpec;
  now?: string;
}): Promise<ProjectV2> {
  const project = await validateProjectV2(input.project);
  const spec = validateProjectSpec(input.spec);
  const now = input.now ?? new Date().toISOString();
  const fresh = await materializeProjectV2Template({
    id: project.id,
    spec,
    now,
  });
  const operations: Parameters<typeof applyProjectV2FileOperations>[2][number][] = [];

  for (const [path, file] of Object.entries(project.files)) {
    if (file.provenance === "generated" && !fresh.files[path]) {
      operations.push({ type: "delete", path });
    }
  }
  for (const [path, file] of Object.entries(fresh.files)) {
    const current = project.files[path];
    if (current && current.provenance !== "generated") continue;
    if (current?.hash === file.hash) continue;
    operations.push({
      type: "write",
      path,
      content: file.content,
      language: file.language,
      role: file.role,
      provenance: "generated",
      editable: file.editable,
    });
  }

  const metadataChanged = canonicalProjectV2Json({
    manifest: project.manifest,
    productSpec: project.productSpec,
    integrations: project.integrations,
    environment: project.environment,
    permissions: project.permissions,
    tasks: project.tasks,
  }) !== canonicalProjectV2Json({
    manifest: fresh.manifest,
    productSpec: fresh.productSpec,
    integrations: fresh.integrations,
    environment: fresh.environment,
    permissions: fresh.permissions,
    tasks: fresh.tasks,
  });

  if (!operations.length && !metadataChanged) return project;

  let next = operations.length
    ? await applyProjectV2FileOperations(project, project.revision, operations, {
        now: () => new Date(now),
      })
    : {
        ...project,
        revision: project.revision + 1,
        updatedAt: now,
        contentHash: "",
        preview: project.preview
          ? {
              status: "stopped" as const,
              projectRevision: project.revision + 1,
              stoppedAt: now,
            }
          : undefined,
      };

  next = {
    ...next,
    manifest: fresh.manifest,
    productSpec: fresh.productSpec,
    integrations: fresh.integrations,
    environment: fresh.environment,
    permissions: fresh.permissions,
    tasks: fresh.tasks,
    updatedAt: now,
    contentHash: "",
  };
  next.contentHash = await hashProjectV2CanonicalState(next);
  return validateProjectV2(next);
}
