import { KeyRound, ShieldCheck } from "lucide-react";

import { IntegrationCatalog } from "@/components/platform/integration-catalog";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";

export default function IntegrationsPage() {
  return <PlatformShell active="Integrations"><PageIntro eyebrow="Connection center" title="Bring intelligence, models, and delivery—safely." description="Manage session-only AI and DropsTab connections, then complete project-specific Drops Bot, Telegram, GitHub, and Vercel setup only when you need them." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><KeyRound className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">No credential values rendered</strong><p className="mt-1 text-xs text-[#52617a]">Only current-tab markers are inspected</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="setup">Evidence required</StatusBadge><ShieldCheck className="size-5 text-[#245fe5]" aria-hidden="true" /></div></>} /><IntegrationCatalog /></PlatformShell>;
}
