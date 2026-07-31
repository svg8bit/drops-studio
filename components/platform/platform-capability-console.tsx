"use client";

import {
  Activity,
  ArchiveRestore,
  Braces,
  Clock3,
  Cloud,
  Database,
  Fingerprint,
  FolderKey,
  Gauge,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  RadioTower,
  ScrollText,
  ServerCog,
  ShieldCheck,
  TableProperties,
  UsersRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  PlatformCapabilityReceipt,
  PlatformCapabilitySnapshot,
  PlatformCapabilityState,
} from "@/lib/platform-capabilities";

import { StatusBadge, type PlatformStatus } from "./platform-ui";

interface ConsoleSection {
  id: string;
  label: string;
  icon: LucideIcon;
  capabilityIds: string[];
  description: string;
  boundary: string;
}

const backendSections: ConsoleSection[] = [
  { id: "overview", label: "Overview", icon: Gauge, capabilityIds: ["managed-backend", "project-data"], description: "Runtime readiness across the generated app data plane.", boundary: "Reference-core evidence and production-provider evidence are shown separately." },
  { id: "data", label: "Data", icon: Database, capabilityIds: ["managed-backend", "project-data"], description: "Scoped collections, revisions, idempotency and bounded queries.", boundary: "Browser-local documents remain explicitly labelled when durable storage is unavailable." },
  { id: "schema", label: "Schema", icon: TableProperties, capabilityIds: ["managed-backend"], description: "Versioned schemas, migration plans and production backup gates.", boundary: "A selected provider is not considered ready until its health receipt succeeds." },
  { id: "auth", label: "Auth", icon: Fingerprint, capabilityIds: ["managed-backend", "enterprise-identity"], description: "Project-scoped users, sessions, CSRF and enterprise identity boundaries.", boundary: "Email and external OIDC delivery require configured adapters." },
  { id: "storage", label: "Storage", icon: Cloud, capabilityIds: ["managed-backend", "project-data"], description: "Object metadata, quotas, scanning and short-lived signed capabilities.", boundary: "Secrets and provider bytes are never embedded in project source or checkpoints." },
  { id: "functions", label: "Functions", icon: Braces, capabilityIds: ["managed-backend"], description: "Typed manifests, bounded timeouts and explicit network allowlists.", boundary: "No unrestricted host shell and no inherited production environment." },
  { id: "jobs", label: "Jobs", icon: ListChecks, capabilityIds: ["managed-backend"], description: "Idempotent jobs, bounded retries and dead-letter records.", boundary: "External side effects remain approval-gated." },
  { id: "cron", label: "Cron", icon: Clock3, capabilityIds: ["managed-backend"], description: "Validated schedules, time zones and production approval.", boundary: "A schedule declaration is not reported as running without provider evidence." },
  { id: "webhooks", label: "Webhooks", icon: Webhook, capabilityIds: ["managed-backend"], description: "Signed ingestion, replay protection and event normalization.", boundary: "Remote registration is never presented as complete without a provider receipt." },
  { id: "realtime", label: "Realtime", icon: RadioTower, capabilityIds: ["collaboration", "managed-backend"], description: "Ordered revision invalidations and bounded visible-tab polling.", boundary: "Production status requires authenticated client reads plus durable write, ordering, idempotency and cleanup evidence; this is not a WebSocket or cursor-presence claim." },
  { id: "secrets", label: "Secrets", icon: FolderKey, capabilityIds: ["managed-backend"], description: "Encrypted values, metadata-only listings and scoped references.", boundary: "Values never appear in API responses, source archives, logs or checkpoints." },
  { id: "logs", label: "Logs", icon: Activity, capabilityIds: ["managed-backend", "audit-backup"], description: "Structured, bounded and secret-sanitized runtime evidence.", boundary: "Empty log stores are not converted into fake successful terminal output." },
  { id: "backups", label: "Backups", icon: ArchiveRestore, capabilityIds: ["audit-backup", "managed-backend"], description: "Checksummed snapshots and restore-to-new-environment defaults.", boundary: "Provider object bytes and secret values require separate approved recovery paths." },
  { id: "settings", label: "Settings", icon: ServerCog, capabilityIds: ["managed-backend", "deployment"], description: "Provider, quota and deployment readiness without secret values.", boundary: "Configuration markers never substitute for a live adapter health check." },
];

const enterpriseSections: ConsoleSection[] = [
  { id: "organizations", label: "Organizations", icon: UsersRound, capabilityIds: ["organizations"], description: "Tenant-scoped organizations, workspaces, membership and invitations.", boundary: "Every mutation is scoped to a verified actor and entitlement." },
  { id: "roles", label: "Roles & RBAC", icon: ShieldCheck, capabilityIds: ["organizations", "enterprise-identity"], description: "Owner, admin, developer, designer, analyst, viewer, billing and security roles.", boundary: "Custom roles cannot grant permissions their creator does not hold." },
  { id: "collaboration", label: "Collaboration", icon: RadioTower, capabilityIds: ["collaboration"], description: "Verified team revision signals, authoritative snapshot reload and explicit local apply.", boundary: "Rooms are tenant-scoped; every request requires a signed member and workspace RBAC, while viewers remain read-only." },
  { id: "identity", label: "Identity", icon: Fingerprint, capabilityIds: ["enterprise-identity"], description: "OIDC discovery, public JWKS, PKCE, one-time codes and user claims.", boundary: "The first-party issuer uses signed Studio identity upstream; SAML and SCIM remain separate adapters." },
  { id: "credentials", label: "Service accounts", icon: KeyRound, capabilityIds: ["enterprise-identity"], description: "One-time scoped tokens with hashed storage, expiry and revocation.", boundary: "Raw tokens are returned once and never persisted in projects." },
  { id: "policies", label: "Policies", icon: LockKeyhole, capabilityIds: ["enterprise-identity", "audit-backup"], description: "Deterministic precedence for provider, model, retention and action controls.", boundary: "Higher-priority policy can only tighten inherited constraints." },
  { id: "audit", label: "Audit", icon: ScrollText, capabilityIds: ["audit-backup"], description: "Append-only, tenant-filtered and tamper-evident audit events.", boundary: "Secret-like metadata is rejected before it reaches the audit chain." },
  { id: "lifecycle", label: "Lifecycle", icon: ArchiveRestore, capabilityIds: ["audit-backup"], description: "Retention, sanitized exports, deletion scheduling, backups and restore.", boundary: "Production restore is approval-gated and targets a separate environment by default." },
];

function badgeStatus(state: PlatformCapabilityState): PlatformStatus {
  if (state === "working") return "working";
  if (state === "working-local-test") return "local";
  if (state === "unavailable") return "feature-gated";
  return "setup";
}

function stateLabel(state: PlatformCapabilityState): string {
  if (state === "working") return "Working";
  if (state === "working-local-test") return "Core verified locally";
  if (state === "unavailable") return "Health evidence required";
  return "Setup required";
}

function CapabilityCard({ capability }: { capability: PlatformCapabilityReceipt }) {
  return (
    <article className="rounded-2xl border border-[#dbe4f1] bg-[#f8fbff] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-base font-semibold">{capability.label}</h3><p className="mt-1 break-words font-mono text-xs text-[#52617a]">{capability.mode}</p></div>
        <StatusBadge status={badgeStatus(capability.state)}>{stateLabel(capability.state)}</StatusBadge>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#52617a]">{capability.detail}</p>
      {capability.evidence.length ? <div className="mt-4 flex flex-wrap gap-2" aria-label="Available evidence">{capability.evidence.map((item) => <span key={item} className="rounded-full border border-[#cfdcff] bg-white px-2.5 py-1 text-xs font-semibold text-[#245fe5]">{item}</span>)}</div> : null}
      {capability.requiredEnvironment.length ? <div className="mt-4 border-t border-[#dbe4f1] pt-4"><p className="text-xs font-semibold text-[#596980]">Required configuration names</p><div className="mt-2 flex flex-wrap gap-2">{capability.requiredEnvironment.map((name) => <code key={name} className="max-w-full break-all rounded-lg bg-white px-2 py-1 text-xs text-[#52617a]">{name}</code>)}</div></div> : null}
    </article>
  );
}

export function PlatformCapabilityConsole({ mode }: { mode: "backend" | "enterprise" }) {
  const sections = mode === "backend" ? backendSections : enterpriseSections;
  const [activeId, setActiveId] = useState(sections[0].id);
  const [snapshot, setSnapshot] = useState<PlatformCapabilitySnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/platform/capabilities", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as PlatformCapabilitySnapshot | null;
      if (!response.ok || !payload || !Array.isArray(payload.capabilities)) throw new Error("Capability evidence is unavailable.");
      setSnapshot(payload);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof DOMException && cause.name === "AbortError"
        ? "Capability evidence request timed out."
        : cause instanceof Error ? cause.message : "Capability evidence is unavailable.");
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const active = sections.find((section) => section.id === activeId) ?? sections[0];
  const receipts = useMemo(() => {
    if (!snapshot) return [];
    return active.capabilityIds
      .map((id) => snapshot.capabilities.find((capability) => capability.id === id))
      .filter((value): value is PlatformCapabilityReceipt => Boolean(value));
  }, [active.capabilityIds, snapshot]);
  const ActiveIcon = active.icon;

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="grid min-h-[680px] min-w-0 grid-cols-1 overflow-hidden rounded-3xl border border-[#cfdcff] bg-white shadow-[0_18px_54px_rgba(49,84,144,0.08)] lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-[#dbe4f1] bg-[#f8fbff] p-3 lg:border-b-0 lg:border-r">
          <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1" role="tablist" aria-label={`${mode} sections`}>
            {sections.map((section) => { const Icon = section.icon; return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={section.id === active.id}
                onClick={() => setActiveId(section.id)}
                className={`flex min-h-11 shrink-0 items-center gap-3 rounded-xl border-0 px-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30 lg:w-full ${section.id === active.id ? "bg-white text-[#1e55e8] shadow-sm" : "text-[#596980] hover:bg-white/70 hover:text-[#07142f]"}`}
              >
                <Icon className="size-4" aria-hidden="true" />{section.label}
              </button>
            ); })}
          </div>
        </aside>

        <div className="min-w-0 p-5 sm:p-7 lg:p-9">
          <div className="flex flex-col gap-4 border-b border-[#e5ecf5] pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#eef4ff] text-[#245fe5]"><ActiveIcon className="size-5" aria-hidden="true" /></span><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">{mode} / {active.label}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{active.description}</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-[#52617a]">{active.boundary}</p></div></div>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Activity aria-hidden="true" />}Refresh evidence</Button>
          </div>

          {loading ? <div className="grid min-h-72 place-items-center" aria-live="polite"><div className="text-center"><LoaderCircle className="mx-auto size-7 animate-spin text-[#245fe5]" aria-hidden="true" /><p className="mt-3 text-sm text-[#52617a]">Reading server capability receipts…</p></div></div> : null}
          {!loading && error ? <div className="mt-6 rounded-2xl border border-[#ecd9bb] bg-[#fff9ef] p-6"><StatusBadge status="setup">Evidence unavailable</StatusBadge><p className="mt-4 text-sm leading-6 text-[#6f5a35]">{error}</p></div> : null}
          {!loading && snapshot ? <div className="mt-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#52617a]"><span>Environment: <strong className="text-[#07142f]">{snapshot.environment}</strong></span><span>Provider health checked: {snapshot.healthCheckedAt ? new Date(snapshot.healthCheckedAt).toLocaleString() : "No current live receipt"}</span></div><div className="grid gap-4 xl:grid-cols-2">{receipts.map((receipt) => <CapabilityCard key={receipt.id} capability={receipt} />)}</div></div> : null}
        </div>
      </div>
    </section>
  );
}
