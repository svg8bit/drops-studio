import type { GeneratedProjectSpec, ProjectQualityCheck, ProjectQualityReport, ProjectRuntimeSmokeResult } from "@/lib/project-types";
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
  return true;
}

export function evaluateProjectQuality(spec: GeneratedProjectSpec, html: string, runtimeSmoke?: ProjectRuntimeSmokeResult | null): ProjectQualityReport {
  const smokePassed = Boolean(runtimeSmoke?.executed && runtimeSmoke.errors.length === 0);
  const reality = getProductReality(spec.presetId);
  const truthfulness = truthfulnessViolations(spec.presetId, html);
  const deliveryMarker = `data-delivery-mode="${reality.deliveryMode}"`;
  const checks: ProjectQualityCheck[] = [
    check("category", "Category-native product", categoryNative(spec), `${spec.experience.archetype} matches ${spec.presetId}`, 3, true),
    check("truthfulness", "Truthful delivery contract", truthfulness.length === 0 && html.includes(deliveryMarker), truthfulness.length ? `Unsupported claims: ${truthfulness.join(", ")}` : `${reality.deliveryMode} contract is visible in the runtime`, 3, true),
    check("runtime", "Runnable standalone output", html.length > 18_000 && html.includes(`data-project-kind="${spec.presetId}"`) && smokePassed && Boolean(runtimeSmoke?.runtime), runtimeSmoke ? "Compiled app executed inside the sandbox and rendered its category runtime" : "Waiting for the sandboxed runtime smoke test", 3, true),
    check("screens", "Complete experience map", spec.blueprint.screens.length >= 3 && spec.blueprint.modules.length >= 4, `${spec.blueprint.screens.length} screens · ${spec.blueprint.modules.length} modules`, 2),
    check("interactions", "Working interaction contract", spec.blueprint.interactions.length >= 4 && /addEventListener\("click"/.test(html) && smokePassed && Boolean(runtimeSmoke?.interactions), runtimeSmoke ? `${spec.blueprint.interactions.length} declared interactions and live controls verified` : "Waiting for live controls to execute in the sandbox", 2, true),
    check("dropstab", "DropsTab data foundation", spec.blueprint.dropsTabUse.length >= 2 && html.includes("refreshData") && smokePassed && Boolean(runtimeSmoke?.dropstab), runtimeSmoke ? `${spec.blueprint.dropsTabUse.length} mapped capabilities and data adapter completed` : "Waiting for the sandboxed data-adapter handshake", 2, true),
    check("dropsbot", "Drops Bot action foundation", spec.blueprint.dropsBotUse.length >= 1 && html.includes("dropsbotSetup") && smokePassed && Boolean(runtimeSmoke?.dropsbot), runtimeSmoke ? `${spec.blueprint.dropsBotUse.length} truthful handoffs and a live Drops Bot action verified` : "Waiting for Drops Bot action discovery in the runtime", 2, true),
    check("state", "Persistent product state", html.includes("localStorage") && html.includes("function save"), "User progress and settings persist in the standalone app", 1),
    check("design", "Visual editing contract", html.includes("data-studio-block") && Object.keys(spec.blocks).length <= 32, "Runtime exposes safe selectable blocks", 1),
    check("responsive", "Responsive runtime", html.includes("@media(max-width:760px)"), "Desktop and mobile layout rules compiled", 1),
    check("a11y", "Document essentials", /<title>[\s\S]+<\/title>/.test(html) && html.includes('name="viewport"'), "Title and viewport metadata are present", 1),
    check("security", "No executable secret or unsafe evaluator", !/(?:sk-(?:proj-|ant-|or-v1-)|xai-|AIza)[a-z0-9_-]{12,}/i.test(html) && !/\beval\s*\(|new Function/.test(html), "No known API-key pattern, eval or Function constructor found", 3, true),
    check("actions", "Approval-safe external actions", /Nothing was executed|no trade executed|approve|approval/i.test(html) && smokePassed && Boolean(runtimeSmoke?.actions), runtimeSmoke ? "The executed runtime exposes handoffs without an automatic trade action" : "Waiting for action safety verification in the sandbox", 2, true),
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
