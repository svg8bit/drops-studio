import type { Metadata } from "next";

import { AgentEvalDashboard } from "@/components/agent-eval-dashboard";
import { createAgentV3PlatformEvidence } from "@/lib/agent/evals/dashboard-evidence";
import { DefaultAgentEvalStore } from "@/lib/agent/evals/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent evals · Drops Studio",
  description: "Internal privacy-safe evaluation evidence for Drops Studio Agent Intelligence v2.",
  robots: { index: false, follow: false },
};

export default async function AgentEvalsPage() {
  let snapshot = null;
  let storageAvailable = true;
  try {
    snapshot = (await new DefaultAgentEvalStore().listEvidenceSnapshots(1))[0] ?? null;
  } catch {
    storageAvailable = false;
  }
  const platform = await createAgentV3PlatformEvidence({ env: process.env, snapshot, storageAvailable });
  return <AgentEvalDashboard initialPlatform={platform} />;
}
