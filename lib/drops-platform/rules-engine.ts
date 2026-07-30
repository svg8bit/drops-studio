import {
  normalizeDropsBotWebhookEvent,
  type DropsBotEvidenceKind,
  type DropsBotJsonObject,
  type NormalizedWalletEvent,
  type NormalizedWalletEventKind,
} from "./dropsbot.ts";

export interface WalletRuleFilters {
  eventKinds?: NormalizedWalletEventKind[];
  chains?: string[];
  wallets?: string[];
  tokenSymbols?: string[];
  minimumValueUsd?: number;
}

export interface WalletIntelligenceRule {
  id: string;
  name: string;
  enabled: boolean;
  filters: WalletRuleFilters;
  scoreThreshold: number;
  delivery?: {
    channel: "telegram" | "dropsbot";
    destinationLabel: string;
  };
}

export interface DropsTabWalletEnrichment {
  provider: "dropstab" | "fallback" | "unverified";
  providerVerified: boolean;
  marketCapUsd?: number;
  fdvUsd?: number;
  nextUnlockAt?: string;
  fundingContext?: string;
  issue?: string;
}

export interface WalletIntelligenceRecord {
  event: NormalizedWalletEvent;
  ruleId: string;
  matched: boolean;
  score: number;
  reasons: string[];
  enrichment: DropsTabWalletEnrichment;
  summary?: string;
  savedAt: string;
}

export interface ApprovalRequiredDelivery {
  status: "approval_required" | "not_requested";
  sent: false;
  channel?: "telegram" | "dropsbot";
  destinationLabel?: string;
  reason: string;
}

export interface WalletIntelligenceResult extends WalletIntelligenceRecord {
  delivery: ApprovalRequiredDelivery;
  steps: Array<"normalize" | "enrich" | "filter" | "score" | "summarize" | "save" | "approval">;
}

function normalizedSet(values: readonly string[] | undefined): Set<string> | undefined {
  return values?.length ? new Set(values.map((value) => value.trim().toLowerCase())) : undefined;
}

export function matchWalletRule(event: NormalizedWalletEvent, rule: WalletIntelligenceRule): {
  matched: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!rule.enabled) reasons.push("Rule is disabled.");
  const kinds = rule.filters.eventKinds?.length ? new Set(rule.filters.eventKinds) : undefined;
  if (kinds && !kinds.has(event.kind)) reasons.push(`Event kind ${event.kind} is outside the rule filter.`);
  const chains = normalizedSet(rule.filters.chains);
  if (chains && (!event.chain || !chains.has(event.chain.toLowerCase()))) reasons.push("Chain does not match the rule filter.");
  const wallets = normalizedSet(rule.filters.wallets);
  if (wallets && (!event.walletAddress || !wallets.has(event.walletAddress.toLowerCase()))) reasons.push("Wallet does not match the rule filter.");
  const symbols = normalizedSet(rule.filters.tokenSymbols);
  if (symbols && !event.tokenSymbols.some((symbol) => symbols.has(symbol.toLowerCase()))) reasons.push("Token does not match the rule filter.");
  const minimum = rule.filters.minimumValueUsd;
  if (minimum !== undefined && (!Number.isFinite(event.valueUsd) || (event.valueUsd ?? 0) < minimum)) {
    reasons.push("Event value is below the rule threshold or unavailable.");
  }
  return { matched: reasons.length === 0, reasons };
}

export function scoreWalletEvent(
  event: NormalizedWalletEvent,
  enrichment: DropsTabWalletEnrichment,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (event.kind === "swap") { score += 20; reasons.push("Swap activity"); }
  if ((event.valueUsd ?? 0) >= 100_000) { score += 30; reasons.push("Whale-size value"); }
  if ((event.valueUsd ?? 0) >= 1_000_000) { score += 15; reasons.push("Seven-figure value"); }
  if (enrichment.providerVerified) { score += 15; reasons.push("Verified DropsTab context"); }
  if (enrichment.marketCapUsd !== undefined || enrichment.fdvUsd !== undefined) { score += 10; reasons.push("Valuation context"); }
  if (enrichment.nextUnlockAt) { score += 10; reasons.push("Upcoming unlock context"); }
  if (enrichment.fundingContext) { score += 5; reasons.push("Funding context"); }
  return { score: Math.min(100, score), reasons };
}

const unavailableEnrichment: DropsTabWalletEnrichment = {
  provider: "unverified",
  providerVerified: false,
  issue: "DropsTab enrichment is unavailable; no market context is claimed.",
};

export async function processWalletIntelligenceEvent(input: {
  payload: DropsBotJsonObject;
  receivedAt?: string;
  providerEvidence?: DropsBotEvidenceKind;
  rule: WalletIntelligenceRule;
  enrich?: (event: NormalizedWalletEvent) => Promise<DropsTabWalletEnrichment>;
  summarize?: (record: Omit<WalletIntelligenceRecord, "summary" | "savedAt">) => Promise<string | undefined>;
  save: (record: WalletIntelligenceRecord) => Promise<void>;
  now?: () => string;
}): Promise<WalletIntelligenceResult> {
  const steps: WalletIntelligenceResult["steps"] = ["normalize"];
  const event = normalizeDropsBotWebhookEvent(input.payload, {
    receivedAt: input.receivedAt,
    providerEvidence: input.providerEvidence,
  });
  let enrichment = unavailableEnrichment;
  if (input.enrich) {
    try {
      enrichment = await input.enrich(event);
    } catch {
      enrichment = { ...unavailableEnrichment };
    }
  }
  steps.push("enrich");
  const match = matchWalletRule(event, input.rule);
  steps.push("filter");
  const scored = scoreWalletEvent(event, enrichment);
  steps.push("score");
  const base = {
    event,
    ruleId: input.rule.id,
    matched: match.matched,
    score: scored.score,
    reasons: [...match.reasons, ...scored.reasons],
    enrichment,
  };
  let summary: string | undefined;
  if (match.matched && input.summarize) {
    try {
      summary = (await input.summarize(base))?.trim().slice(0, 2_000) || undefined;
    } catch {
      summary = undefined;
    }
  }
  steps.push("summarize");
  const record: WalletIntelligenceRecord = {
    ...base,
    ...(summary ? { summary } : {}),
    savedAt: input.now?.() ?? new Date().toISOString(),
  };
  await input.save(record);
  steps.push("save");
  const deliveryReady = match.matched
    && scored.score >= input.rule.scoreThreshold
    && Boolean(input.rule.delivery);
  const delivery: ApprovalRequiredDelivery = deliveryReady
    ? {
        status: "approval_required",
        sent: false,
        channel: input.rule.delivery?.channel,
        destinationLabel: input.rule.delivery?.destinationLabel,
        reason: "External delivery requires explicit user approval and verified destination evidence.",
      }
    : {
        status: "not_requested",
        sent: false,
        reason: match.matched
          ? "The event did not reach the delivery threshold or no destination is configured."
          : "The event did not match the rule filters.",
      };
  steps.push("approval");
  return { ...record, delivery, steps };
}
