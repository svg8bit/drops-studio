import { defineBenchmarkCase } from "../define-case.ts";
import type { BenchmarkCaseV3 } from "../types.ts";
import { browserFlow, REQUIRED_VIEWPORTS } from "./helpers.ts";

interface DesignInput {
  id: string;
  title: string;
  prompt: string;
  fixture: string;
  capability: string;
  artifact: string;
  context: [string, string, ...string[]];
  forbidden: string;
  blocker: string;
  seed?: string;
  axe?: boolean;
  category?: "build" | "edit";
}

function design(input: DesignInput): BenchmarkCaseV3 {
  return defineBenchmarkCase({
    id: input.id,
    title: input.title,
    suite: "design-responsive",
    intentKey: `${input.id}-intent`,
    prompt: input.prompt,
    fixtureProject: input.fixture,
    requiredCapabilities: ["reference-driven-design", input.capability],
    expectedArtifacts: ["responsive-design-evidence", input.artifact],
    deterministicChecks: [...new Set([
      "project-v2-valid",
      "expected-artifacts",
      "design-viewports",
      "design-rubric",
      "browser-primary-flow",
      "no-console-errors",
      "no-horizontal-overflow",
      ...(input.axe ? ["axe-no-critical"] : []),
    ])],
    browserFlow: browserFlow(input.id, { axe: input.axe }),
    visualViewports: REQUIRED_VIEWPORTS.map((viewport) => ({ ...viewport })),
    forbiddenClaims: [input.forbidden],
    hardBlockers: [input.blocker],
    seededFailures: input.seed ? [input.seed] : [],
    maxDurationMs: 240_000,
    maxEstimatedCostUsd: 0.8,
    tags: ["v3", "design", input.capability],
    category: input.category ?? "edit",
    expectedRoute: "coder",
    requiredContext: input.context,
    requiresApprovalBoundary: false,
  });
}

export const DESIGN_BENCHMARK_CASES: readonly BenchmarkCaseV3[] = [
  design({
    id: "design-whale-premium-directions",
    title: "Premium whale intelligence workspace",
    prompt: "Produce a category-native whale intelligence workspace with high-signal event hierarchy, evidence-rich enrichment cards, and restrained DropsTab visual language across all required viewports.",
    fixture: "whale-intelligence",
    capability: "whale-dashboard-design",
    artifact: "whale-responsive-captures",
    context: ["whale-product-brief", "dropstab-design-tokens", "event-evidence"],
    forbidden: "the result is a generic admin dashboard with renamed headings",
    blocker: "wallet events or provider evidence are not legible at 390 pixels",
  }),
  design({
    id: "design-alpha-channel-telegram-native",
    title: "Telegram-native alpha channel composition",
    prompt: "Design an AI alpha channel whose sourced market briefs, approval queue, and Telegram delivery state read as one native workflow rather than disconnected dashboard widgets.",
    fixture: "alpha-channel",
    capability: "alpha-channel-design",
    artifact: "alpha-channel-responsive-captures",
    context: ["alpha-channel-brief", "telegram-delivery-state", "source-attribution"],
    forbidden: "delivery state is represented by a fake connected badge",
    blocker: "approval and provider evidence disappear on mobile",
  }),
  design({
    id: "design-crypto-game-playable-mobile",
    title: "Playable market-reactive crypto game",
    prompt: "Make the market-reactive crypto game genuinely playable with thumb-sized controls, visible market mechanics, truthful data mode, and stable game state at desktop, tablet, and mobile widths.",
    fixture: "market-game",
    capability: "playable-game-design",
    artifact: "gameplay-responsive-captures",
    context: ["game-mechanics", "market-data-mode", "interaction-state"],
    forbidden: "a decorative chart is presented as playable gameplay",
    blocker: "the primary game action cannot be completed at 390 pixels",
    axe: true,
  }),
  design({
    id: "design-market-aggregator-density",
    title: "Dense market aggregator without overflow",
    prompt: "Balance dense coin comparison, filters, market metadata, and research links so expert users retain scan speed while tablet and mobile layouts avoid clipped tables or horizontal overflow.",
    fixture: "market-aggregator",
    capability: "dense-data-design",
    artifact: "aggregator-responsive-captures",
    context: ["market-table", "comparison-controls", "research-attribution"],
    forbidden: "important market columns are silently hidden without an alternate view",
    blocker: "content overflows horizontally at any required viewport",
  }),
  design({
    id: "design-multipage-saas-navigation",
    title: "Coherent multipage crypto SaaS navigation",
    prompt: "Create coherent navigation for a multipage crypto SaaS with preserved route context, clear active state, accessible mobile disclosure, and no return to obsolete permanent panels.",
    fixture: "multipage-saas",
    capability: "multipage-navigation-design",
    artifact: "navigation-responsive-captures",
    context: ["route-map", "unified-workspace", "navigation-state"],
    forbidden: "mobile navigation removes access to an application route",
    blocker: "active route state is ambiguous or keyboard-inaccessible",
    axe: true,
  }),
  design({
    id: "design-mobile-390-hierarchy",
    title: "Mobile-first 390 pixel information hierarchy",
    prompt: "Recompose the wallet alert workspace at 390 pixels with 44-pixel targets, readable helper text, a single primary action, and preserved alert evidence without shrinking desktop panels.",
    fixture: "wallet-alerts",
    capability: "mobile-hierarchy",
    artifact: "mobile-390-capture",
    context: ["mobile-layout", "alert-priority", "touch-target-policy"],
    forbidden: "desktop columns are merely scaled down on mobile",
    blocker: "critical alert actions or evidence require horizontal scrolling",
    axe: true,
  }),
  design({
    id: "design-tablet-1024-composition",
    title: "Purposeful tablet workspace composition",
    prompt: "Compose the research terminal specifically for 1024 pixels with collapsible supporting context, stable reading measure, and direct access to search and evidence instead of a squeezed desktop layout.",
    fixture: "design-lab",
    capability: "tablet-composition",
    artifact: "tablet-1024-capture",
    context: ["tablet-layout", "research-terminal", "evidence-panel"],
    forbidden: "tablet is an untested interpolation between desktop and mobile",
    blocker: "primary research content is obscured by fixed chrome",
  }),
  design({
    id: "design-accessibility-contrast-focus",
    title: "Accessible contrast and focus treatment",
    prompt: "Apply the existing Drops Studio tokens so controls meet contrast expectations, focus remains visible in every theme, status is not color-only, and keyboard order follows visual hierarchy.",
    fixture: "design-lab",
    capability: "accessible-visual-system",
    artifact: "accessibility-design-evidence",
    context: ["design-tokens", "focus-order", "status-semantics"],
    forbidden: "visual polish removes focus outlines or semantic labels",
    blocker: "critical Axe findings or invisible focus remain",
    axe: true,
  }),
  design({
    id: "design-non-generic-category-native",
    title: "Category-native prediction impact product",
    prompt: "Transform the prediction impact starter into a category-native decision product where catalysts, confidence, market context, and outcome tracking shape the composition rather than generic KPI cards.",
    fixture: "prediction-impact",
    capability: "category-native-composition",
    artifact: "prediction-impact-captures",
    context: ["prediction-product-brief", "catalyst-evidence", "outcome-workflow"],
    forbidden: "generic dashboard cards are accepted as category specificity",
    blocker: "the primary prediction workflow is not visually discoverable",
    category: "build",
  }),
  design({
    id: "design-visual-verifier-blocks-overflow",
    title: "Visual verifier blocks mobile overflow",
    prompt: "Given a seeded mobile overflow regression, require rendered evidence at every target width, identify the responsible element, and block release until the corrected layout passes again.",
    fixture: "design-lab",
    capability: "visual-release-verifier",
    artifact: "overflow-repair-captures",
    context: ["seeded-overflow", "viewport-captures", "release-verdict"],
    forbidden: "desktop success is used to waive a mobile visual failure",
    blocker: "release passes while horizontal overflow remains at 390 pixels",
    seed: "browser-runtime-mobile-overflow",
  }),
] as const;
