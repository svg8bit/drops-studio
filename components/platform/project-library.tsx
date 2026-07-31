"use client";

import { AppWindow, ArrowRight, Cloud, FolderKanban, Globe2, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { getProjectPreset } from "@/lib/presets";
import { readProjectsFromStore } from "@/lib/project-store";
import type { GeneratedProject } from "@/lib/project-types";

import { StatusBadge } from "./platform-ui";

export function ProjectLibrary() {
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () => {
      try { setProjects(readProjectsFromStore()); } catch { setProjects([]); }
      setReady(true);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  const published = useMemo(() => projects.filter((project) => Boolean(project.publishedUrl)).length, [projects]);

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-[#dbe4f1] bg-white p-5"><AppWindow className="size-5 text-[#245fe5]" aria-hidden="true" /><p className="mt-5 text-xs font-semibold text-[#52617a]">Browser projects</p><strong className="mt-1 block text-3xl tracking-[-0.04em]">{ready ? projects.length : "—"}</strong></article>
        <article className="rounded-2xl border border-[#dbe4f1] bg-white p-5"><Globe2 className="size-5 text-[#245fe5]" aria-hidden="true" /><p className="mt-5 text-xs font-semibold text-[#52617a]">Published receipts</p><strong className="mt-1 block text-3xl tracking-[-0.04em]">{ready ? published : "—"}</strong></article>
        <article className="rounded-2xl border border-[#dbe4f1] bg-white p-5"><Cloud className="size-5 text-[#245fe5]" aria-hidden="true" /><p className="mt-5 text-xs font-semibold text-[#52617a]">Storage mode</p><strong className="mt-1 block text-lg tracking-[-0.025em]">Browser-first</strong><p className="mt-1 text-xs leading-5 text-[#52617a]">Private cloud sync activates only in an eligible signed-in account.</p></article>
      </div>

      <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">Your workspace</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">Real saved projects</h2></div><Button nativeButton={false} render={<Link href="/" />}><Plus aria-hidden="true" />Build new project</Button></div>

      {!ready ? <div className="mt-5 min-h-52 animate-pulse rounded-2xl border border-[#dbe4f1] bg-white" aria-label="Loading browser projects" /> : projects.length ? (
        <div className="mt-5 grid gap-3">
          {projects.map((project) => {
            const preset = getProjectPreset(project.spec.presetId);
            return (
              <Link key={project.id} href={`/studio/${encodeURIComponent(project.id)}`} className="group grid min-h-24 gap-4 rounded-2xl border border-[#dbe4f1] bg-white p-4 shadow-[0_8px_28px_rgba(49,84,144,0.045)] transition-colors hover:border-[#b9ccff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:items-center">
                <span className="grid size-13 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Save className="size-5" aria-hidden="true" /></span>
                <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-lg tracking-[-0.025em]">{project.spec.name}</strong><StatusBadge status={project.publishedUrl ? "working" : "local"}>{project.publishedUrl ? "Published receipt" : "Saved locally"}</StatusBadge></span><small className="mt-2 block text-xs leading-5 text-[#52617a]">{preset.output} · updated {new Date(project.updatedAt).toLocaleDateString()}</small></span>
                <span className="flex min-h-11 items-center gap-2 text-sm font-semibold text-[#245fe5]">Open Studio <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 grid min-h-72 place-items-center rounded-3xl border border-dashed border-[#b9ccff] bg-white p-7 text-center"><div><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#eef4ff] text-[#245fe5]"><FolderKanban className="size-7" aria-hidden="true" /></span><h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">No browser projects yet</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#52617a]">Start from one of the 12 real recipes or describe a custom crypto product. Nothing is fabricated to fill this library.</p><div className="mt-5 flex flex-wrap justify-center gap-2"><Button nativeButton={false} render={<Link href="/templates" />}>Browse templates</Button><Button nativeButton={false} render={<Link href="/" />} variant="outline">Open builder</Button></div></div></div>
      )}
    </section>
  );
}
