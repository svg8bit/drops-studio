import { ShieldCheck, UsersRound } from "lucide-react";

import { PlatformCapabilityConsole } from "@/components/platform/platform-capability-console";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";

export default function EnterprisePage() {
  return <PlatformShell active="Enterprise"><PageIntro eyebrow="Enterprise controls" title="Identity, collaboration and governance without theatre." description="Review the organization, RBAC, collaboration, OIDC, service account, policy, audit and lifecycle contracts. External identity, realtime and durable storage remain setup-required until their health evidence exists." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><UsersRound className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Control-plane evidence</strong><p className="mt-1 text-xs text-[#52617a]">Tenant-safe reference runtime</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="local">Core verified locally</StatusBadge><ShieldCheck className="size-5 text-[#139a62]" aria-hidden="true" /></div></>} /><PlatformCapabilityConsole mode="enterprise" /></PlatformShell>;
}
