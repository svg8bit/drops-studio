"use client";

import { Building2, Check, LoaderCircle, Plus, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { StatusBadge } from "./platform-ui";

interface WorkspaceMember {
  identity: string;
  role: "owner" | "editor" | "viewer";
}

interface TeamWorkspaceSummary {
  id: string;
  name: string;
  revision: number;
  ownerIdentity: string;
  members: WorkspaceMember[];
  projects: Array<{ projectId: string }>;
  updatedAt: string;
}

type LoadState = "loading" | "ready" | "signed-out" | "setup" | "error";

function safeMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string" && message.trim() ? message.slice(0, 240) : fallback;
}

export function OrganizationConsole() {
  const [state, setState] = useState<LoadState>("loading");
  const [workspaces, setWorkspaces] = useState<TeamWorkspaceSummary[]>([]);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/teams", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as { workspaces?: TeamWorkspaceSummary[] };
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 503) {
        setState("setup");
        setMessage(safeMessage(payload, "Organization storage is not configured."));
        return;
      }
      if (!response.ok) throw new Error(safeMessage(payload, "Organizations could not be loaded."));
      setWorkspaces(Array.isArray(payload.workspaces) ? payload.workspaces : []);
      setState("ready");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Organizations could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function createWorkspace() {
    if (creating || !consent || name.trim().length < 2) return;
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), consent: true }),
      });
      const payload = await response.json().catch(() => ({})) as { workspace?: TeamWorkspaceSummary; code?: string };
      if (!response.ok || !payload.workspace) {
        throw new Error(safeMessage(
          payload,
          payload.code === "PRO_REQUIRED"
            ? "A verified Pro entitlement is required to create a team workspace."
            : "Workspace could not be created.",
        ));
      }
      setWorkspaces((current) => [payload.workspace!, ...current.filter((item) => item.id !== payload.workspace!.id)]);
      setName("");
      setConsent(false);
      setState("ready");
      setMessage("Workspace created with a verified server receipt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workspace could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 rounded-3xl border border-[#dbe4f1] bg-white p-5 shadow-[0_14px_42px_rgba(49,84,144,0.06)] sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">Current account</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">Organization workspaces</h2></div>
            <Button type="button" onClick={() => void refresh()} variant="outline" disabled={state === "loading"}>{state === "loading" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}Refresh</Button>
          </div>

          {state === "loading" ? <div className="mt-6 grid min-h-56 place-items-center rounded-2xl bg-[#f8fbff]" aria-live="polite"><LoaderCircle className="size-6 animate-spin text-[#245fe5]" aria-hidden="true" /><span className="sr-only">Loading organizations</span></div> : null}
          {state === "signed-out" ? <div className="mt-6 rounded-2xl border border-[#cfdcff] bg-[#f1f6ff] p-6"><StatusBadge status="setup">Sign in required</StatusBadge><h3 className="mt-4 text-xl font-semibold">Connect a Studio member account</h3><p className="mt-2 text-sm leading-6 text-[#596980]">Organization data is private and is never filled with sample members. Use the OpenRouter member flow from Connections, then return here.</p><Button render={<Link href="/?connections=1&provider=openrouter" />} className="mt-5">Open Connections</Button></div> : null}
          {state === "setup" || state === "error" ? <div className="mt-6 rounded-2xl border border-[#ecd9bb] bg-[#fff9ef] p-6"><StatusBadge status="setup">{state === "setup" ? "Setup required" : "Unavailable"}</StatusBadge><h3 className="mt-4 text-xl font-semibold">Organization control plane is not ready in this environment</h3><p className="mt-2 text-sm leading-6 text-[#6f5a35]">{message || "Durable organization storage or authorization is unavailable."}</p></div> : null}
          {state === "ready" && workspaces.length === 0 ? <div className="mt-6 grid min-h-56 place-items-center rounded-2xl border border-dashed border-[#b9ccff] bg-[#f8fbff] p-6 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#245fe5]"><Building2 aria-hidden="true" /></span><h3 className="mt-4 text-xl font-semibold">No workspaces yet</h3><p className="mt-2 text-sm text-[#52617a]">Create one below when the account has a verified team entitlement.</p></div></div> : null}
          {state === "ready" && workspaces.length ? <div className="mt-6 grid gap-3">{workspaces.map((workspace) => <article key={workspace.id} className="rounded-2xl border border-[#dbe4f1] bg-[#f8fbff] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{workspace.name}</h3><StatusBadge status="working">Server revision {workspace.revision}</StatusBadge></div><p className="mt-2 text-xs text-[#52617a]">Updated {new Date(workspace.updatedAt).toLocaleString()}</p></div><div className="flex gap-4 text-sm text-[#52617a]"><span className="flex items-center gap-1.5"><UsersRound className="size-4" aria-hidden="true" />{workspace.members.length}</span><span className="flex items-center gap-1.5"><Building2 className="size-4" aria-hidden="true" />{workspace.projects.length}</span></div></div><div className="mt-4 flex flex-wrap gap-2">{workspace.members.map((member) => <span key={member.identity} className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[#dbe4f1] bg-white px-3 text-xs text-[#596980]"><UserRound className="size-3.5" aria-hidden="true" />{member.role}<span className="font-mono">{member.identity.slice(0, 8)}</span></span>)}</div></article>)}</div> : null}
        </div>

        <aside className="rounded-3xl border border-[#cfdcff] bg-white p-5 shadow-[0_14px_42px_rgba(49,84,144,0.06)] sm:p-6">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Plus className="size-5" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold">Create workspace</h2><p className="mt-1 text-xs text-[#52617a]">Real server mutation with entitlement check</p></div></div>
          <label className="mt-6 block text-sm font-semibold" htmlFor="workspace-name">Workspace name</label>
          <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-12" maxLength={80} placeholder="Crypto Research" disabled={state !== "ready" || creating} />
          <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-[#dbe4f1] p-3 text-sm leading-5 text-[#52617a]"><Checkbox checked={consent} onCheckedChange={(value) => setConsent(value === true)} disabled={state !== "ready" || creating} aria-label="Confirm workspace creation" /><span>I approve creation of this team workspace and its first owner membership.</span></label>
          <Button type="button" onClick={() => void createWorkspace()} disabled={state !== "ready" || creating || !consent || name.trim().length < 2} className="mt-4 w-full">{creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}{creating ? "Creating…" : "Create workspace"}</Button>
          {message ? <p className="mt-4 rounded-xl bg-[#f8fbff] p-3 text-xs leading-5 text-[#596980]" role="status">{message}</p> : null}
          <div className="mt-6 border-t border-[#e5ecf5] pt-5"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-[#139a62]" aria-hidden="true" />Server authorization</div><p className="mt-2 text-xs leading-5 text-[#52617a]">Cross-origin requests, missing identity, unverified billing, stale revisions, invite replay, and disallowed roles are rejected by the existing team APIs.</p></div>
        </aside>
      </div>
    </section>
  );
}
