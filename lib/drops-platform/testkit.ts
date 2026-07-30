import type { DropsBotJsonObject } from "./dropsbot.ts";
import type { DropsTabWalletEnrichment } from "./rules-engine.ts";

export const whaleSwapFixture = Object.freeze({
  walletAddress: "7Ywhale11111111111111111111111111111111111",
  transactionHash: "5wapsignature111111111111111111111111111111111111111111111111111",
  receivedAt: "2026-07-30T00:00:00.000Z",
  payload: {
    eventType: "wallet_swap",
    chain: "solana",
    walletAddress: "7Ywhale11111111111111111111111111111111111",
    transactionHash: "5wapsignature111111111111111111111111111111111111111111111111111",
    tokenInSymbol: "USDC",
    tokenOutSymbol: "SOL",
    valueUsd: 275_000,
    occurredAt: "2026-07-29T23:59:30.000Z",
  } satisfies DropsBotJsonObject,
});

export const dropsTabWhaleEnrichmentFixture = Object.freeze({
  provider: "dropstab",
  providerVerified: true,
  marketCapUsd: 85_000_000_000,
  fdvUsd: 90_000_000_000,
  nextUnlockAt: "2026-08-16T00:00:00.000Z",
  fundingContext: "Sourced institutional funding context is available.",
} satisfies DropsTabWalletEnrichment);

export function createDropsPlatformFixtureInbox() {
  const records: unknown[] = [];
  return {
    records,
    async save(record: unknown): Promise<void> {
      records.push(structuredClone(record));
    },
  };
}
