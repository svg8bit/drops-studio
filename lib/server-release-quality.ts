import { Script } from "node:vm";

import { evaluateProjectQuality } from "./project-quality.ts";
import type { GeneratedProjectSpec, ProjectQualityReport, ProjectRuntimeSmokeResult } from "./project-types.ts";

export type ReleaseProviderEvidence = "dropstab" | "fallback" | "unverified";

const categoryRuntimeMarkers: Record<GeneratedProjectSpec["presetId"], RegExp> = {
  "action-engine": /data-action=["']run-engine["']/,
  "alpha-channel": /telegram-workspace/,
  "morning-alpha": /tg-phone|telegram-workspace/,
  "prediction-impact": /relationship-map|impact-map/,
  "smart-money-copy": /data-action=["']paper-copy["']/,
  "crypto-aggregator": /id=["']coinSearch["']|market-explorer/,
  "crypto-game": /catcher-runtime|game-native-runtime|data-action=["'](?:play-catcher|start-market-race|next-quiz|resolve-battle)["']/,
  "personal-companion": /data-interest|discovery-companion/,
  "portfolio-tamagotchi": /data-action=["']save-holdings["']|character-habitat/,
  "crypto-product-hunt": /id=["']huntName["']|launch-board/,
  "crypto-radio": /data-action=["']toggle-radio["']|audio-studio/,
  "crypto-siri": /id=["']siriInput["']|voice-assistant/,
  "custom-product": /data-custom-component=|modular-crypto-app/,
};

function normalizeProvider(value: unknown): ReleaseProviderEvidence {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dropstab" || normalized === "fallback") return normalized;
  return "unverified";
}

function inlineRuntimeScripts(html: string): string[] {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/type=["'](?:application\/(?:ld\+)?json|module)["']/i.test(match[1]))
    .map((match) => match[2]);
}

export function inspectServerReleaseRuntime(
  spec: GeneratedProjectSpec,
  html: string,
  provider: ReleaseProviderEvidence | string = "unverified",
): ProjectRuntimeSmokeResult {
  const errors: string[] = [];
  const scripts = inlineRuntimeScripts(html);
  scripts.forEach((source, index) => {
    try {
      new Script(source, { filename: `published-inline-${index + 1}.js` });
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 160) : "Invalid runtime JavaScript");
    }
  });
  const categoryRuntime = categoryRuntimeMarkers[spec.presetId].test(html);
  const hasClickContract = /addEventListener\(["']click["']/.test(html) && /data-action=/.test(html);
  const hasAdapterContract = /function\s+refreshData\s*\(/.test(html) && Boolean(spec.dataEndpoint?.trim());
  const hasDropsBotContract = /function\s+dropsbotSetup\s*\(/.test(html) && /data-action=["'](?:dropsbot|dropsbot-setup)["']/.test(html);
  const hasUnsafeExecution = /<button[^>]*data-action=["'](?:execute-trade|auto-trade)["']/i.test(html);
  const hasApprovalBoundary = /Nothing was executed|no trade executed|approve|approval/i.test(html);
  return {
    mode: "server-artifact",
    dataProvider: normalizeProvider(provider),
    executed: true,
    runtime: scripts.length > 0 && errors.length === 0 && categoryRuntime,
    interactions: hasClickContract,
    dropstab: hasAdapterContract,
    dropsbot: hasDropsBotContract,
    actions: hasApprovalBoundary && !hasUnsafeExecution,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

export function evaluateServerReleaseQuality(
  spec: GeneratedProjectSpec,
  html: string,
  provider: ReleaseProviderEvidence | string = "unverified",
): ProjectQualityReport {
  const smoke = inspectServerReleaseRuntime(spec, html, provider);
  return evaluateProjectQuality(spec, html, smoke);
}

export function stampProviderEvidence(html: string, provider: ReleaseProviderEvidence | string): string {
  const evidence = normalizeProvider(provider);
  return html.replace(/<html\b(?![^>]*\bdata-provider-evidence=)/i, `<html data-provider-evidence="${evidence}"`);
}
