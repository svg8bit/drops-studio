import { Layers3, ShieldCheck } from "lucide-react";

import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";
import { TemplateCatalog } from "@/components/platform/template-catalog";

export default function TemplatesPage() {
  return <PlatformShell active="Templates"><PageIntro eyebrow="12 production recipes" title="Start with crypto-native product depth." description="Browse the current Drops Studio foundations for intelligence, monitoring, creator, community, voice, and playable market experiences." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Layers3 className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Current recipe catalog</strong><p className="mt-1 text-xs text-[#52617a]">Imported directly from lib/presets</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="working">12 registered</StatusBadge><span className="flex items-center gap-1.5 text-xs text-[#596980]"><ShieldCheck className="size-4 text-[#139a62]" aria-hidden="true" />No placeholder presets</span></div></>} /><TemplateCatalog /></PlatformShell>;
}
