import { Database, ShieldCheck } from "lucide-react";

import { PlatformCapabilityConsole } from "@/components/platform/platform-capability-console";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";

export default function BackendPage() {
  return <PlatformShell active="Backend"><PageIntro eyebrow="Managed backend" title="A complete backend surface, with honest runtime evidence." description="Inspect data, schema, auth, storage, functions, jobs, cron, webhooks, realtime, secrets, logs and recovery. Local reference capabilities and durable production providers never share the same status label." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Database className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Data-plane readiness</strong><p className="mt-1 text-xs text-[#52617a]">Live server capability receipt</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="local">Reference core verified</StatusBadge><ShieldCheck className="size-5 text-[#139a62]" aria-hidden="true" /></div></>} /><PlatformCapabilityConsole mode="backend" /></PlatformShell>;
}
