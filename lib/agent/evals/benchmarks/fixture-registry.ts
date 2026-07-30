import { createProjectSpec } from "../../../project-factory.ts";
import { materializeProjectV2Template } from "../../../project-template-materializer.ts";
import { validateProjectSpec } from "../../../project-validator.ts";
import { validateProjectV2 } from "../../../project-v2-validator.ts";
import { benchmarkFailureSeed, BENCHMARK_FAILURE_SEED_IDS } from "./seeders.ts";
import type {
  BenchmarkFixtureDefinition,
  BenchmarkFixtureEnvelope,
} from "./types.ts";

const FIXTURE_NOW = "2026-07-30T00:00:00.000Z";

export const BENCHMARK_FIXTURES: readonly BenchmarkFixtureDefinition[] = [
  { id: "blank-crypto-app", version: "1.0.0", presetId: "custom-product", prompt: "Build a bounded multi-page crypto product foundation.", tools: [], source: "synthetic", license: "CC0-1.0" },
  { id: "whale-intelligence", version: "1.0.0", presetId: "smart-money-copy", prompt: "Build a whale intelligence dashboard with wallet-event enrichment.", tools: ["DropsTab API", "Drops Bot", "Telegram"], source: "repository-owned", license: "repository" },
  { id: "alpha-channel", version: "1.0.0", presetId: "alpha-channel", prompt: "Build a sourced AI alpha channel with approval-gated delivery.", tools: ["DropsTab API", "Telegram"], source: "repository-owned", license: "repository" },
  { id: "market-aggregator", version: "1.0.0", presetId: "crypto-aggregator", prompt: "Build a searchable crypto market aggregator with provider evidence.", tools: ["DropsTab API"], source: "repository-owned", license: "repository" },
  { id: "market-game", version: "1.0.0", presetId: "crypto-game", prompt: "Build a playable crypto game driven by a labelled market snapshot.", tools: ["DropsTab API"], source: "repository-owned", license: "repository" },
  { id: "prediction-impact", version: "1.0.0", presetId: "prediction-impact", prompt: "Build a scenario product mapping prediction events to crypto impact.", tools: ["DropsTab API"], source: "repository-owned", license: "repository" },
  { id: "multipage-saas", version: "1.0.0", presetId: "custom-product", prompt: "Build a multi-page crypto SaaS with project-local data and API routes.", tools: ["Project data"], source: "synthetic", license: "CC0-1.0" },
  { id: "wallet-alerts", version: "1.0.0", presetId: "action-engine", prompt: "Build a wallet alert workflow with explicit approval boundaries.", tools: ["Drops Bot", "Telegram"], source: "repository-owned", license: "repository" },
  { id: "integration-lab", version: "1.0.0", presetId: "custom-product", prompt: "Build a provider-adapter test product with truthful setup states.", tools: ["DropsTab API", "Drops Bot", "Telegram"], source: "synthetic", license: "CC0-1.0" },
  { id: "retrieval-lab", version: "1.0.0", presetId: "custom-product", prompt: "Build a symbol-rich fixture for current and stale context retrieval.", tools: [], source: "synthetic", license: "CC0-1.0" },
  { id: "design-lab", version: "1.0.0", presetId: "crypto-aggregator", prompt: "Build a category-native responsive crypto design verification fixture.", tools: ["DropsTab API"], source: "synthetic", license: "CC0-1.0" },
] as const;

export const BENCHMARK_FIXTURE_IDS = new Set(BENCHMARK_FIXTURES.map((entry) => entry.id));

export function benchmarkFixtureDefinition(id: string): BenchmarkFixtureDefinition {
  const fixture = BENCHMARK_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Unknown benchmark fixture ${id}.`);
  return structuredClone(fixture);
}

export async function materializeBenchmarkFixture(
  fixtureId: string,
  failureSeedIds: readonly string[] = [],
): Promise<BenchmarkFixtureEnvelope> {
  const fixture = benchmarkFixtureDefinition(fixtureId);
  for (const seedId of failureSeedIds) {
    if (!BENCHMARK_FAILURE_SEED_IDS.has(seedId)) throw new Error(`Unknown benchmark failure seed ${seedId}.`);
  }
  const generated = createProjectSpec({
    presetId: fixture.presetId,
    values: {},
    prompt: fixture.prompt,
    tools: fixture.tools,
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: { title: "No prediction", probability: null, change: null },
    origin: "https://drops-studio.example",
  });
  const spec = validateProjectSpec({ ...generated, createdAt: FIXTURE_NOW });
  const canonicalProject = await materializeProjectV2Template({
    id: `benchmark-${fixture.id}`,
    spec,
    now: FIXTURE_NOW,
  });
  await validateProjectV2(canonicalProject);
  return {
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    canonicalProject,
    failureSeeds: failureSeedIds.map(benchmarkFailureSeed),
    source: fixture.source,
    license: fixture.license,
  };
}
