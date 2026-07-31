import { Boxes, Braces, CloudCog, DatabaseZap, GitPullRequest, KeyRound, RadioTower, ShieldCheck, UsersRound, Webhook } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type {
  PlatformCapabilitySnapshot,
  PlatformCapabilityState,
} from "@/lib/platform-capabilities";

import { StatusBadge, SurfaceCard } from "./platform-ui";

const capabilityGroups = [
  { id: "project-v2", icon: Boxes, title: "Project runtime" },
  { id: "sandbox", icon: CloudCog, title: "Vercel Sandbox" },
  { id: "project-data", icon: DatabaseZap, title: "Project data" },
  { id: "managed-backend", icon: Webhook, title: "Managed workflows" },
  { id: "deployment", icon: GitPullRequest, title: "Delivery" },
  { id: "audit-backup", icon: ShieldCheck, title: "Safety and recovery" },
];

const managedRoadmap = [
  { href: "/organizations", icon: UsersRound, title: "Organizations and RBAC", text: "The current team control plane reads real member state; the V4 role engine adds tenant-safe default and custom role contracts." },
  { href: "/backend", icon: Braces, title: "Managed backend", text: "The reference runtime covers schema through recovery. Production data still requires a healthy D1 or Postgres adapter; blob storage is never treated as relational storage." },
  { href: "/enterprise", icon: RadioTower, title: "Realtime collaboration", text: "Concurrent edits, presence expiry, comments and AI branch conflicts are verified locally. Production transport remains setup-required." },
  { href: "/enterprise", icon: KeyRound, title: "Enterprise identity", text: "OIDC, domains, service tokens, policies and audit have executable local contracts. External IdP health evidence remains required." },
];

function badgeStatus(state: PlatformCapabilityState) {
  if (state === "working") return "working" as const;
  if (state === "working-local-test") return "local" as const;
  if (state === "unavailable") return "feature-gated" as const;
  return "setup" as const;
}

function stateLabel(state: PlatformCapabilityState): string {
  if (state === "working") return "Working";
  if (state === "working-local-test") return "Core verified locally";
  if (state === "unavailable") return "Health evidence required";
  return "Setup required";
}

export function PlatformOverview({ snapshot }: { snapshot: PlatformCapabilitySnapshot }) {
  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {capabilityGroups.map((item) => {
          const receipt = snapshot.capabilities.find((capability) => capability.id === item.id);
          return <SurfaceCard key={item.id} icon={item.icon} title={item.title}>{receipt ? <><StatusBadge status={badgeStatus(receipt.state)}>{stateLabel(receipt.state)}</StatusBadge><p className="mt-4 text-sm leading-6 text-[#52617a]">{receipt.detail}</p>{receipt.evidence.length ? <p className="mt-3 break-words font-mono text-xs leading-5 text-[#596980]">{receipt.evidence.join(" · ")}</p> : null}</> : <><StatusBadge status="setup">Evidence unavailable</StatusBadge><p className="mt-4 text-sm leading-6 text-[#52617a]">No server capability receipt was returned for this surface.</p></>}</SurfaceCard>;
        })}
      </div>

      <div className="mt-12 grid gap-7 rounded-3xl border border-[#cfdcff] bg-white p-5 shadow-[0_18px_54px_rgba(49,84,144,0.07)] sm:p-7 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">Managed platform V4</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">Executable cores, explicit provider boundaries.</h2><p className="mt-4 text-base leading-7 text-[#52617a]">The data, collaboration and enterprise domains have tested reference implementations. The cards above come from the server capability snapshot, and configuration markers stay non-working until matching runtime health evidence exists.</p><Button render={<Link href="/backend" />} className="mt-6 no-underline">Inspect backend readiness</Button></div>
        <div className="grid gap-3 sm:grid-cols-2">{managedRoadmap.map((item) => { const Icon = item.icon; return <Link href={item.href} key={item.title} className="min-h-44 rounded-2xl border border-[#dbe4f1] bg-[#f8fbff] p-4 no-underline transition-colors hover:border-[#a9c0ff] hover:bg-[#f1f6ff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-white text-[#245fe5]"><Icon className="size-5" aria-hidden="true" /></span><h3 className="text-base font-semibold">{item.title}</h3></div><p className="mt-3 text-xs leading-5 text-[#52617a]">{item.text}</p><div className="mt-4"><StatusBadge status="local">Core verified · provider-aware</StatusBadge></div></Link>; })}</div>
      </div>
    </section>
  );
}
