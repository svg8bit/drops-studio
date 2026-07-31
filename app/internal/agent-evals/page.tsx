import type { Metadata } from "next";

import { AgentEvalDashboard } from "@/components/agent-eval-dashboard";
import { createAgentV3PlatformEvidence } from "@/lib/agent/evals/dashboard-evidence";

export const metadata: Metadata = {
  title: "Agent evals · Drops Studio",
  description: "Internal privacy-safe evaluation evidence for Drops Studio Agent Intelligence v2.",
  robots: { index: false, follow: false },
};

export default async function AgentEvalsPage() {
  const platform = await createAgentV3PlatformEvidence({ env: process.env });
  return <AgentEvalDashboard initialPlatform={platform} />;
}
