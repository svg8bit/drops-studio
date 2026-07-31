import { Boxes, ShieldCheck } from "lucide-react";

import { PlatformOverview } from "@/components/platform/platform-overview";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";
import { platformCapabilitySnapshotWithHealth } from "@/lib/platform-capabilities";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const snapshot = await platformCapabilitySnapshotWithHealth();
  return <PlatformShell active="Platform"><PageIntro eyebrow="Drops platform" title="A crypto builder that shows its evidence." description="See what works locally, what needs provider configuration, and what remains feature-gated across Project V2, Sandbox, Drops intelligence, delivery, and the managed platform rollout." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Boxes className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Capability-aware UI</strong><p className="mt-1 text-xs text-[#52617a]">Working, local, and setup states stay distinct</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="working">Truthful states</StatusBadge><ShieldCheck className="size-5 text-[#139a62]" aria-hidden="true" /></div></>} /><PlatformOverview snapshot={snapshot} /></PlatformShell>;
}
