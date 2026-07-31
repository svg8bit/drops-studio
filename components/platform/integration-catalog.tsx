"use client";

import {
  Bot,
  Braces,
  BrainCircuit,
  CloudUpload,
  DatabaseZap,
  GitBranch,
  KeyRound,
  Network,
  Route,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import { StatusBadge, type PlatformStatus } from "./platform-ui";

const integrations = [
  { id: "free", name: "Free Auto", eyebrow: "Deterministic fallback", description: "Built-in planning and generation fallback. No provider key is required.", icon: Sparkles, href: "/", fixed: "built-in" },
  { id: "dropstab", name: "DropsTab API", eyebrow: "Market intelligence", description: "Session-only key for documented market, unlock, funding, and activity capabilities.", icon: DatabaseZap, href: "/?connections=1&provider=dropstab" },
  { id: "dropsbot", name: "Drops Bot + Telegram", eyebrow: "Monitoring and delivery", description: "Guided account, channel, bot, and provider verification. No delivery is assumed.", icon: Send, href: "/?connections=1&provider=dropsbot&flow=telegram-channel", fixed: "setup" },
  { id: "openai", name: "OpenAI", eyebrow: "Bring your key", description: "Use a session-only OpenAI API project key and a provider-returned model.", icon: BrainCircuit, href: "/?connections=1&provider=openai" },
  { id: "anthropic", name: "Anthropic", eyebrow: "Bring your key", description: "Use a session-only Anthropic API key for supported Claude models.", icon: Bot, href: "/?connections=1&provider=anthropic" },
  { id: "openrouter", name: "OpenRouter", eyebrow: "Account and BYOK", description: "PKCE member flow or session-only key with provider-returned model catalog.", icon: Route, href: "/?connections=1&provider=openrouter" },
  { id: "kimi", name: "Kimi", eyebrow: "Long context", description: "Use a session-only Moonshot API key and verified model identifier.", icon: Network, href: "/?connections=1&provider=kimi" },
  { id: "custom", name: "Custom provider", eyebrow: "OpenAI-compatible", description: "Configure a public HTTPS chat-completions endpoint for this browser tab.", icon: Braces, href: "/?connections=1&provider=custom" },
  { id: "github", name: "GitHub App", eyebrow: "Repository delivery", description: "Project-scoped branch, commit, and pull request actions require configured credentials and approval.", icon: GitBranch, href: "/projects", fixed: "setup" },
  { id: "vercel", name: "Vercel deployment", eyebrow: "Preview and release", description: "A deployment is shown ready only after Vercel returns a confirmed provider receipt.", icon: CloudUpload, href: "/projects", fixed: "setup" },
] as const;

function subscribeToSessionConnections(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getSessionConnectionSnapshot() {
  try {
    return integrations
      .filter((integration) => !("fixed" in integration))
      .filter((integration) => Boolean(window.sessionStorage.getItem(`drops-studio:${integration.id}`)))
      .map((integration) => integration.id)
      .join(",");
  } catch {
    return "";
  }
}

export function IntegrationCatalog() {
  const snapshot = useSyncExternalStore(subscribeToSessionConnections, getSessionConnectionSnapshot, () => "");
  const sessionConnections = useMemo(() => new Set(snapshot ? snapshot.split(",") : []), [snapshot]);

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-col gap-3 rounded-2xl border border-[#cfdcff] bg-[#eef4ff] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#245fe5]"><KeyRound className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Session-only credential contract</strong><p className="mt-1 text-xs leading-5 text-[#596980]">This page checks only whether the current tab has a configured marker. It never reads, displays, or persists credential values.</p></div></div><StatusBadge status="local">This tab only</StatusBadge></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const sessionConfigured = sessionConnections.has(integration.id);
          const fixed = "fixed" in integration ? integration.fixed : null;
          const status: PlatformStatus = fixed === "built-in" ? "working" : sessionConfigured ? "configured" : "setup";
          const label = fixed === "built-in" ? "Built in" : sessionConfigured ? "Session configured" : "Setup required";
          return (
            <article key={integration.id} className="flex min-w-0 flex-col rounded-2xl border border-[#dbe4f1] bg-white p-5 shadow-[0_10px_32px_rgba(49,84,144,0.055)]">
              <div className="flex items-start justify-between gap-4"><span className="grid size-12 place-items-center rounded-2xl bg-[#eef4ff] text-[#245fe5]"><Icon className="size-6" aria-hidden="true" /></span><StatusBadge status={status}>{label}</StatusBadge></div>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.12em] text-[#245fe5]">{integration.eyebrow}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">{integration.name}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-[#52617a]">{integration.description}</p>
              <Button render={<Link href={integration.href} />} variant={status === "configured" || status === "working" ? "outline" : "default"} className="mt-5 w-full">
                {status === "configured" ? "Manage in Connections" : status === "working" ? "Open builder" : integration.id === "github" || integration.id === "vercel" ? "Open a project" : "Set up connection"}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
