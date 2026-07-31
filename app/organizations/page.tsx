import { Building2, ShieldCheck } from "lucide-react";

import { OrganizationConsole } from "@/components/platform/organization-console";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";

export default function OrganizationsPage() {
  return <PlatformShell active="Organizations"><PageIntro eyebrow="Organizations and workspaces" title="Collaborate without inventing team state." description="Use the current signed team APIs for real workspaces and revisioned shared projects. Rich enterprise roles, OIDC, presence, and policy controls activate only with matching authorization and adapter evidence." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Building2 className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Tenant-aware control plane</strong><p className="mt-1 text-xs text-[#52617a]">Account and storage status are read live</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="setup">Account dependent</StatusBadge><ShieldCheck className="size-5 text-[#139a62]" aria-hidden="true" /></div></>} /><OrganizationConsole /></PlatformShell>;
}
