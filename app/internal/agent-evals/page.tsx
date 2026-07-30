import type { Metadata } from "next";

import { AgentEvalDashboard } from "@/components/agent-eval-dashboard";

export const metadata: Metadata = {
  title: "Agent evals · Drops Studio",
  description: "Internal privacy-safe evaluation evidence for Drops Studio Agent Intelligence v2.",
  robots: { index: false, follow: false },
};

export default function AgentEvalsPage() {
  return <AgentEvalDashboard />;
}
