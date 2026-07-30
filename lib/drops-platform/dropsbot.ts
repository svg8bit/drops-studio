import { createHash } from "node:crypto";

import {
  redactDropsBotWebhookPayload,
  type DropsBotJsonObject,
  type DropsBotJsonValue,
} from "../dropsbot-webhook.ts";

export type DropsBotCapabilityId =
  | "connectedAccount"
  | "webhookInbox"
  | "telegramHandoff"
  | "walletCrud";

export type DropsBotSupport = "documented" | "documented-handoff" | "setup-required";

export interface DropsBotCapabilityDefinition {
  support: DropsBotSupport;
  externalAction: boolean;
  approvalRequired: boolean;
  completionEvidence: string;
  instructions: string;
}

export const DROPSBOT_CAPABILITY_REGISTRY = {
  connectedAccount: {
    support: "documented-handoff",
    externalAction: true,
    approvalRequired: true,
    completionEvidence: "Explicit provider-confirmed account evidence supplied by the connection flow.",
    instructions: "Connect through the documented Drops Bot or Telegram setup flow; a Studio session alone is not provider proof.",
  },
  webhookInbox: {
    support: "documented",
    externalAction: false,
    approvalRequired: true,
    completionEvidence: "A capability-authenticated callback was persisted in the project inbox.",
    instructions: "Create the callback with consent, then register it manually through @drops.",
  },
  telegramHandoff: {
    support: "documented-handoff",
    externalAction: true,
    approvalRequired: true,
    completionEvidence: "Telegram provider evidence from the approved MTProto or Bot API flow.",
    instructions: "Use the approved Telegram connection wizard or copy the documented @drops profile command.",
  },
  walletCrud: {
    support: "setup-required",
    externalAction: true,
    approvalRequired: true,
    completionEvidence: "No public remote wallet CRUD contract is documented in the current integration evidence.",
    instructions: "Manage tracked wallets manually in @drops. Studio must not report completion without a documented provider response.",
  },
} as const satisfies Record<DropsBotCapabilityId, DropsBotCapabilityDefinition>;

export type DropsBotEvidenceKind =
  | "setup-required"
  | "callback-pending"
  | "callback-received"
  | "telegram-verified"
  | "provider-confirmed";

export interface DropsBotCapabilityState {
  capability: DropsBotCapabilityId;
  status: "available" | "pending" | "setup_required";
  completed: boolean;
  providerVerified: boolean;
  evidence: DropsBotEvidenceKind;
  instructions: string;
}

export function capabilityStateForDropsBot(
  capability: DropsBotCapabilityId,
  evidence: DropsBotEvidenceKind = "setup-required",
): DropsBotCapabilityState {
  const definition = DROPSBOT_CAPABILITY_REGISTRY[capability];
  if (capability === "walletCrud") {
    return {
      capability,
      status: "setup_required",
      completed: false,
      providerVerified: false,
      evidence: "setup-required",
      instructions: definition.instructions,
    };
  }
  const providerVerified = evidence === "provider-confirmed" || evidence === "telegram-verified";
  const callbackAvailable = capability === "webhookInbox" && evidence === "callback-received";
  const completed = providerVerified || callbackAvailable;
  return {
    capability,
    status: completed ? "available" : evidence === "callback-pending" ? "pending" : "setup_required",
    completed,
    providerVerified,
    evidence,
    instructions: definition.instructions,
  };
}

export type NormalizedWalletEventKind = "swap" | "transfer" | "contract" | "price" | "unknown";

export interface DropsBotEventEvidence {
  kind: DropsBotEvidenceKind;
  providerVerified: boolean;
  providerSignatureVerified: false;
  explanation: string;
}

export interface NormalizedWalletEvent {
  id: string;
  contentHash: string;
  kind: NormalizedWalletEventKind;
  walletAddress?: string;
  chain?: string;
  transactionHash?: string;
  tokenSymbols: string[];
  valueUsd?: number;
  occurredAt: string;
  receivedAt: string;
  payload: DropsBotJsonObject;
  evidence: DropsBotEventEvidence;
}

function object(value: DropsBotJsonValue | undefined): DropsBotJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DropsBotJsonObject
    : undefined;
}

function candidates(payload: DropsBotJsonObject): DropsBotJsonObject[] {
  const nested = object(payload.data) ?? object(payload.event) ?? object(payload.payload);
  return nested ? [payload, nested] : [payload];
}

function firstString(objects: DropsBotJsonObject[], keys: readonly string[]): string | undefined {
  for (const item of objects) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 512);
    }
  }
  return undefined;
}

function firstNumber(objects: DropsBotJsonObject[], keys: readonly string[]): number | undefined {
  for (const item of objects) {
    for (const key of keys) {
      const value = item[key];
      const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      if (Number.isFinite(number) && number >= 0) return number;
    }
  }
  return undefined;
}

function eventKind(value: string | undefined): NormalizedWalletEventKind {
  const normalized = value?.toLowerCase() ?? "";
  if (/swap|trade|exchange/.test(normalized)) return "swap";
  if (/transfer|send|receive|deposit|withdraw/.test(normalized)) return "transfer";
  if (/contract|program|deploy|call/.test(normalized)) return "contract";
  if (/price|movement|pump|dump/.test(normalized)) return "price";
  return "unknown";
}

function isoDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const milliseconds = /^\d{10,13}$/.test(value)
    ? Number(value) * (value.length === 10 ? 1_000 : 1)
    : Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : fallback;
}

function evidenceFor(kind: DropsBotEvidenceKind): DropsBotEventEvidence {
  const providerVerified = kind === "provider-confirmed" || kind === "telegram-verified";
  return {
    kind,
    providerVerified,
    providerSignatureVerified: false,
    explanation: providerVerified
      ? "The surrounding approved connection flow supplied provider evidence; no webhook signature scheme is claimed."
      : kind === "callback-received"
        ? "A valid callback capability delivered this event, but that does not prove provider identity or a provider signature."
        : "Provider identity is not verified. Complete the documented setup flow.",
  };
}

export function normalizeDropsBotWebhookEvent(
  payload: DropsBotJsonObject,
  input: {
    receivedAt?: string;
    providerEvidence?: DropsBotEvidenceKind;
    sensitiveValues?: readonly string[];
  } = {},
): NormalizedWalletEvent {
  const receivedAt = isoDate(input.receivedAt, new Date().toISOString());
  const safePayload = redactDropsBotWebhookPayload(payload, input.sensitiveValues ?? []);
  const sources = candidates(safePayload);
  const type = firstString(sources, ["eventType", "event_type", "type", "activityType", "activity_type", "action"]);
  const walletAddress = firstString(sources, ["walletAddress", "wallet_address", "wallet", "ownerAddress", "owner_address"]);
  const chain = firstString(sources, ["chain", "blockchain", "network"])?.toLowerCase();
  const transactionHash = firstString(sources, ["transactionHash", "transaction_hash", "txHash", "tx_hash", "signature"]);
  const symbols = [
    firstString(sources, ["symbol", "tokenSymbol", "token_symbol"]),
    firstString(sources, ["tokenInSymbol", "token_in_symbol", "fromSymbol", "from_symbol"]),
    firstString(sources, ["tokenOutSymbol", "token_out_symbol", "toSymbol", "to_symbol"]),
  ].filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase().slice(0, 24));
  const canonical = JSON.stringify(safePayload);
  const contentHash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return {
    id: `wallet_${contentHash.slice(0, 24)}`,
    contentHash,
    kind: eventKind(type),
    ...(walletAddress ? { walletAddress } : {}),
    ...(chain ? { chain } : {}),
    ...(transactionHash ? { transactionHash } : {}),
    tokenSymbols: [...new Set(symbols)],
    ...(firstNumber(sources, ["valueUsd", "value_usd", "usdValue", "usd_value", "amountUsd", "amount_usd"]) !== undefined
      ? { valueUsd: firstNumber(sources, ["valueUsd", "value_usd", "usdValue", "usd_value", "amountUsd", "amount_usd"]) }
      : {}),
    occurredAt: isoDate(firstString(sources, ["occurredAt", "occurred_at", "timestamp", "createdAt", "created_at", "time"]), receivedAt),
    receivedAt,
    payload: safePayload,
    evidence: evidenceFor(input.providerEvidence ?? "setup-required"),
  };
}

export interface DropsBotWalletMutationHandoff {
  status: "setup_required";
  completed: false;
  providerVerified: false;
  action: "create" | "update" | "delete";
  instructions: string;
}

export function requestDropsBotWalletMutation(
  action: DropsBotWalletMutationHandoff["action"],
): DropsBotWalletMutationHandoff {
  return {
    status: "setup_required",
    completed: false,
    providerVerified: false,
    action,
    instructions: DROPSBOT_CAPABILITY_REGISTRY.walletCrud.instructions,
  };
}

export type { DropsBotJsonObject, DropsBotJsonValue };
