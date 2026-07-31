import { Activity, UsersRound } from "lucide-react";

import { EnterpriseRuntimeConsole } from "@/components/platform/enterprise-runtime-console";
import { PlatformCapabilityConsole } from "@/components/platform/platform-capability-console";
import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";

export default function EnterprisePage() {
  return (
    <PlatformShell active="Enterprise">
      <PageIntro
        eyebrow="Enterprise controls"
        title="Identity, collaboration and governance without theatre."
        description="Review organization, RBAC, collaboration, OIDC, service account, policy, audit and lifecycle contracts. Realtime and identity provider status is read from the public capability snapshot below."
        receipt={(
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]">
                <UsersRound className="size-5" aria-hidden="true" />
              </span>
              <div>
                <strong className="text-sm">Live server capability receipt</strong>
                <p className="mt-1 text-xs text-[#52617a]">Runtime status comes from the public capability snapshot</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <StatusBadge status="configured">Live receipts below</StatusBadge>
              <Activity className="size-5 text-[#245fe5]" aria-hidden="true" />
            </div>
          </>
        )}
      />
      <EnterpriseRuntimeConsole />
      <PlatformCapabilityConsole mode="enterprise" />
    </PlatformShell>
  );
}
