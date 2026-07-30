import type { GeneratedProjectSpec, ProjectQualityCheck, ProjectQualityReport, ProjectRuntimeSmokeResult } from "@/lib/project-types";
import { findArtifactSecrets } from "./artifact-security.ts";
import { getProductReality, launchStatusFor, truthfulnessViolations } from "./product-reality.ts";

const expectedArchetype: Record<GeneratedProjectSpec["presetId"], GeneratedProjectSpec["experience"]["archetype"]> = {
  "action-engine": "decision-cockpit",
  "alpha-channel": "creator-feed",
  "morning-alpha": "editorial-brief",
  "prediction-impact": "impact-map",
  "smart-money-copy": "strategy-monitor",
  "crypto-aggregator": "market-explorer",
  "crypto-game": "game-world",
  "personal-companion": "discovery-companion",
  "portfolio-tamagotchi": "character-habitat",
  "crypto-product-hunt": "launch-board",
  "crypto-radio": "audio-studio",
  "crypto-siri": "voice-assistant",
  "custom-product": "modular-crypto-app",
};

function check(id: string, label: string, passed: boolean, detail: string, weight = 1, critical = false): ProjectQualityCheck {
  return { id, label, passed, detail, weight, critical };
}

function categoryNative(spec: GeneratedProjectSpec): boolean {
  if (spec.experience.archetype !== expectedArchetype[spec.presetId]) return false;
  if (spec.presetId === "crypto-game") return Boolean(spec.gameDirection && spec.blueprint.game);
  if (spec.presetId === "alpha-channel" || spec.presetId === "morning-alpha") {
    return /telegram/i.test(`${spec.blueprint.productType} ${spec.blueprint.visualConcept} ${spec.blueprint.screens.join(" ")}`);
  }
  if (spec.presetId === "crypto-radio") return /audio|radio|player|speech/i.test(`${spec.blueprint.productType} ${spec.blueprint.modules.join(" ")}`);
  if (spec.presetId === "crypto-siri") return /voice|assistant|convers/i.test(`${spec.blueprint.productType} ${spec.blueprint.modules.join(" ")}`);
  if (spec.presetId === "custom-product") {
    return Boolean(
      spec.customGraph
      && spec.customGraph.screens.length >= 3
      && spec.customGraph.modules.length >= 3
      && spec.customGraph.components.length >= 6,
    );
  }
  return true;
}

export interface ProjectQualityHostEvidence {
  dataProvider?: "dropstab" | "fallback" | "unverified";
}

export function evaluateProjectQuality(
  spec: GeneratedProjectSpec,
  html: string,
  runtimeSmoke?: ProjectRuntimeSmokeResult | null,
  hostEvidence?: ProjectQualityHostEvidence,
): ProjectQualityReport {
  const staticInspection = runtimeSmoke?.mode === "server-inspection"
    || runtimeSmoke?.mode === "server-artifact";
  const smokePassed = Boolean(
    staticInspection
      && (runtimeSmoke.errors?.length ?? 0) === 0,
  );
  const trustedApiProvider = hostEvidence?.dataProvider === "dropstab"
    || hostEvidence?.dataProvider === "fallback"
    ? hostEvidence.dataProvider
    : null;
  const providerEvidence = trustedApiProvider
    ?? (staticInspection
      ? String(runtimeSmoke?.dataProvider || "unverified").trim().toLowerCase()
      : "unverified");
  const runtimeEvidence = staticInspection
    ? "Static server inspection parsed JavaScript syntax and found the category runtime contract; it did not execute the application"
    : runtimeSmoke
      ? "Browser telemetry received; isolated execution remains unverified until a host-side check completes"
      : "Waiting for a host-side runtime check";
  const reality = getProductReality(spec.presetId);
  const truthfulness = truthfulnessViolations(spec.presetId, html);
  const deliveryMarker = `data-delivery-mode="${reality.deliveryMode}"`;
  const checks: ProjectQualityCheck[] = [
    check("category", "Category-native product", categoryNative(spec), `${spec.experience.archetype} matches ${spec.presetId}`, 3, true),
    check("truthfulness", "Truthful delivery contract", truthfulness.length === 0 && html.includes(deliveryMarker), truthfulness.length ? `Unsupported claims: ${truthfulness.join(", ")}` : `${reality.deliveryMode} contract is visible in the runtime`, 3, true),
    check("runtime", "Runnable standalone output", html.length > 18_000 && html.includes(`data-project-kind="${spec.presetId}"`) && smokePassed && Boolean(runtimeSmoke?.runtime), runtimeEvidence, 3, true),
    check("screens", "Complete experience map", spec.blueprint.screens.length >= 3 && spec.blueprint.modules.length >= 4, `${spec.blueprint.screens.length} screens · ${spec.blueprint.modules.length} modules`, 2),
    check("interactions", "Working interaction contract", spec.blueprint.interactions.length >= 4 && /addEventListener\(["']click["']/.test(html) && smokePassed && Boolean(runtimeSmoke?.interactions), staticInspection ? `${spec.blueprint.interactions.length} declared interactions and their static event contracts were inspected` : runtimeSmoke ? "Browser interaction telemetry received; host verification is still required" : "Waiting for a host-side interaction check", 2, true),
    check("data-adapter", "DropsTab-compatible adapter contract", spec.blueprint.dropsTabUse.length >= 2 && html.includes("refreshData") && smokePassed && Boolean(runtimeSmoke?.dropstab), staticInspection ? `${spec.blueprint.dropsTabUse.length} mapped capabilities and the static data-adapter contract were inspected` : runtimeSmoke ? "Browser adapter telemetry received; provider and host execution remain unverified" : "Waiting for a host-side data-adapter check", 2, true),
    check("provider-evidence", "Live DropsTab provider evidence", providerEvidence === "dropstab", providerEvidence === "dropstab" ? "Same-origin host/API evidence reports provider=dropstab" : `Provider evidence: ${providerEvidence || "unverified"}. Browser telemetry cannot assert a live DropsTab provider.`, 1),
    check("dropsbot", "Drops Bot action handoff", spec.blueprint.dropsBotUse.length >= 1 && html.includes("dropsbotSetup") && smokePassed && Boolean(runtimeSmoke?.dropsbot), staticInspection ? `${spec.blueprint.dropsBotUse.length} truthful setup or approval handoff contracts were inspected; no external action is claimed` : runtimeSmoke ? "Browser handoff telemetry received; host verification is still required" : "Waiting for a host-side Drops Bot handoff check", 2, true),
    check("state", "Persistent product state", html.includes("localStorage") && html.includes("function save"), "User progress and settings persist in the standalone app", 1),
    check("design", "Visual editing contract", html.includes("data-studio-block") && Object.keys(spec.blocks).length <= 32, "Runtime exposes safe selectable blocks", 1),
    check("responsive", "Responsive runtime", html.includes("@media(max-width:760px)"), "Desktop and mobile layout rules compiled", 1),
    check("a11y", "Document essentials", /<title>[\s\S]+<\/title>/.test(html) && html.includes('name="viewport"'), "Title and viewport metadata are present", 1),
    check("security", "No executable secret or unsafe evaluator", findArtifactSecrets(html, "runtime").length === 0 && !/\beval\s*\(|new Function/.test(html), "No known credential pattern, eval or Function constructor found", 3, true),
    check("actions", "Approval-safe external actions", /Nothing was executed|no trade executed|approve|approval/i.test(html) && smokePassed && Boolean(runtimeSmoke?.actions), staticInspection ? "Static inspection found approval boundaries and no automatic trade control" : runtimeSmoke ? "Browser action telemetry received; it is not execution evidence" : "Waiting for a host-side action safety check", 2, true),
  ];
  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  const passedWeight = checks.filter((item) => item.passed).reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round((passedWeight / totalWeight) * 100);
  const criticalFailures = checks.filter((item) => item.critical && !item.passed).map((item) => item.id);
  return {
    score,
    readyToPublish: score >= 85 && criticalFailures.length === 0,
    launchStatus: launchStatusFor(spec.presetId),
    deliveryMode: reality.deliveryMode,
    externalSetupRequired: reality.externalSetupRequired,
    checkedAt: new Date().toISOString(),
    checks,
    criticalFailures,
    ...(runtimeSmoke ? { runtimeSmoke } : {}),
  };
}
