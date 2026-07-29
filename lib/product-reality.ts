import type { PresetId } from "@/lib/presets";
import type { ProjectLaunchStatus, ProjectRealityContract } from "@/lib/project-types";

export const PRODUCT_REALITY: Record<PresetId, ProjectRealityContract> = {
  "action-engine": {
    deliveryMode: "research-only",
    externalSetupRequired: false,
    deliverable: "A working decision-support app with a local review ledger; it never executes a trade.",
    worksNow: ["Live market context", "Decision rules", "Review ledger", "DropsTab research handoff"],
    requires: ["A broker or wallet integration for execution"],
    forbiddenClaims: ["trade executed", "position opened", "guaranteed signal"],
  },
  "alpha-channel": {
    deliveryMode: "connection-required",
    externalSetupRequired: true,
    deliverable: "A working Telegram channel setup app, sourced post composer and verified test-post sender.",
    worksNow: ["Market signal selection", "Sourced post composer", "Telegram preview", "Bot admin verification"],
    requires: ["An existing Telegram channel", "Drops Bot setup or a BotFather bot token", "Bot administrator access"],
    forbiddenClaims: ["already on air", "channel created", "subscribers"],
  },
  "morning-alpha": {
    deliveryMode: "connection-required",
    externalSetupRequired: true,
    deliverable: "A working daily brief builder with real market sections and verified Telegram delivery.",
    worksNow: ["Live price brief", "Watchlist settings", "Telegram preview", "Verified test delivery"],
    requires: ["DropsTab API for unlocks and funding", "An existing Telegram channel", "Drops Bot or a BotFather bot"],
    forbiddenClaims: ["online", "scheduled delivery active", "subscribers"],
  },
  "prediction-impact": {
    deliveryMode: "research-only",
    externalSetupRequired: false,
    deliverable: "A working event-to-asset research map with explicit external market links.",
    worksNow: ["Live Polymarket event context", "Related asset map", "DropsTab research links", "Alert handoff"],
    requires: ["A separate Polymarket account for trading"],
    forbiddenClaims: ["trade executed", "historical sensitivity verified", "automatic hedge"],
  },
  "smart-money-copy": {
    deliveryMode: "connection-required",
    externalSetupRequired: true,
    deliverable: "A working paper-copy rule builder and alert recipe; no live copy trade is implied.",
    worksNow: ["Wallet rule builder", "Risk limits", "Paper ledger", "Drops Bot recipe"],
    requires: ["A verified wallet feed", "Drops Bot alerts", "A broker or wallet for approved execution"],
    forbiddenClaims: ["copied live", "real wallet event", "position opened"],
  },
  "crypto-aggregator": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A working searchable crypto market aggregator with live data and local watchlists.",
    worksNow: ["Live rankings", "Search", "Sort", "Local favorites", "DropsTab research links"],
    requires: ["DropsTab API for the complete asset universe"],
    forbiddenClaims: ["full DropsTab universe"],
  },
  "crypto-game": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A playable browser game whose rounds use the current market snapshot.",
    worksNow: ["Playable rounds", "Keyboard and touch controls", "Local score", "Share challenge"],
    requires: ["DropsTab API for full live market coverage"],
    forbiddenClaims: ["global leaderboard", "players online", "prize pool"],
  },
  "personal-companion": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A working local-first recommendation companion that learns explicit likes and dismissals.",
    worksNow: ["Preference controls", "Personalized ranking", "Local memory", "DropsTab research links"],
    requires: ["An AI model connection for generated narrative answers"],
    forbiddenClaims: ["AI learned across devices", "news feed connected"],
  },
  "portfolio-tamagotchi": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A working portfolio-health toy calculated from user-entered holdings and market changes.",
    worksNow: ["Holdings input", "Explainable health score", "Local care history", "Market context"],
    requires: ["User-entered holdings or a future wallet connection"],
    forbiddenClaims: ["wallet connected", "portfolio rebalanced", "profit improved"],
  },
  "crypto-product-hunt": {
    deliveryMode: "connection-required",
    externalSetupRequired: true,
    deliverable: "A working private launch tracker and submission draft board.",
    worksNow: ["Local submissions", "Search", "Local votes", "DropsTab project context"],
    requires: ["A database and authentication for a public community board"],
    forbiddenClaims: ["community live", "verified votes", "trending launches"],
  },
  "crypto-radio": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A working browser audio rundown generated from the current market snapshot.",
    worksNow: ["Browser speech synthesis", "Rundown controls", "Market refresh", "Share link"],
    requires: ["Browser speech support", "AI connection for richer scripts"],
    forbiddenClaims: ["live broadcast", "listeners online", "studio stream"],
  },
  "crypto-siri": {
    deliveryMode: "web-native",
    externalSetupRequired: false,
    deliverable: "A working browser voice and text assistant over the current market snapshot.",
    worksNow: ["Text questions", "Browser speech recognition", "Spoken answers", "Drops Bot alert handoff"],
    requires: ["Browser speech support", "AI connection for open-ended answers"],
    forbiddenClaims: ["always listening", "alert created", "trade executed"],
  },
};

export function getProductReality(presetId: PresetId): ProjectRealityContract {
  return PRODUCT_REALITY[presetId];
}

export function launchStatusFor(presetId: PresetId): ProjectLaunchStatus {
  const mode = PRODUCT_REALITY[presetId].deliveryMode;
  if (mode === "connection-required") return "external-setup-required";
  if (mode === "research-only") return "research-only";
  return "web-ready";
}

const globallyForbidden = [
  /already on air/i,
  /10,842 subscribers/i,
  /\$32\.4M/i,
  /\$18\.7M/i,
  /🔥 128/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function truthfulnessViolations(presetId: PresetId, html: string): string[] {
  const violations = globallyForbidden.filter((pattern) => pattern.test(html)).map((pattern) => pattern.source);
  for (const claim of PRODUCT_REALITY[presetId].forbiddenClaims) {
    const pattern = new RegExp(escapeRegExp(claim), "i");
    if (pattern.test(html)) violations.push(pattern.source);
  }
  const presetPatterns: Partial<Record<PresetId, RegExp[]>> = {
    "alpha-channel": [/\d[\d,]* subscribers/i, /channel created/i],
    "morning-alpha": [/\d[\d,]* subscribers/i, /scheduled delivery active/i],
    "action-engine": [/position opened/i],
    "prediction-impact": [/executed on polymarket/i, /verified historical sensitivity/i],
    "smart-money-copy": [/copied live/i, /real wallet event/i],
    "crypto-aggregator": [/full DropsTab universe/i],
    "crypto-game": [/global leaderboard/i, /players online/i, /prize pool/i],
    "personal-companion": [/learned across devices/i, /news feed connected/i],
    "portfolio-tamagotchi": [/wallet connected/i, /portfolio rebalanced/i],
    "crypto-product-hunt": [/community live/i, /verified votes/i, /trending launches/i],
    "crypto-radio": [/live broadcast/i, /listeners online/i],
    "crypto-siri": [/alert created/i, /always listening/i],
  };
  for (const pattern of presetPatterns[presetId] ?? []) if (pattern.test(html)) violations.push(pattern.source);
  return [...new Set(violations)];
}
