"use client";

import {
  AudioLines,
  Blocks,
  ChartNoAxesCombined,
  Gamepad2,
  HeartPulse,
  Megaphone,
  Radio,
  Rocket,
  Search,
  Sparkles,
  Sun,
  TableProperties,
  UsersRound,
  Zap,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { presets } from "@/lib/presets";
import type { Preset } from "@/lib/presets";

import { StatusBadge } from "./platform-ui";

const iconMap = {
  AudioLines,
  Blocks,
  ChartNoAxesCombined,
  Gamepad2,
  HeartPulse,
  Megaphone,
  Radio,
  Rocket,
  Sparkles,
  Sun,
  TableProperties,
  UsersRound,
  Zap,
} as const;

function PresetCard({ preset }: { preset: Preset }) {
  const Icon = iconMap[preset.icon as keyof typeof iconMap] ?? Blocks;
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#dbe4f1] bg-white shadow-[0_12px_36px_rgba(49,84,144,0.055)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[#b9ccff] hover:shadow-[0_18px_46px_rgba(49,84,144,0.1)]">
      <div className="flex min-h-40 items-end justify-between gap-5 border-b border-[#e6edf7] p-5" style={{ background: `linear-gradient(145deg, ${preset.tint}, #ffffff)` }}>
        <span className="grid size-14 place-items-center rounded-2xl border border-white/80 bg-white/85 shadow-sm" style={{ color: preset.accent }}><Icon className="size-7" aria-hidden="true" /></span>
        <div className="text-right"><span className="text-xs font-semibold text-[#52617a]">{preset.category}</span><p className="mt-1 text-sm font-semibold text-[#07142f]">{preset.output}</p></div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3"><h2 className="text-xl font-semibold tracking-[-0.03em]">{preset.shortTitle}</h2><StatusBadge status="working">Recipe</StatusBadge></div>
        <p className="text-sm font-semibold text-[#31445f]">{preset.tagline}</p>
        <p className="mt-2 flex-1 text-sm leading-6 text-[#52617a]">{preset.description}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {preset.tools.slice(0, 3).map((tool) => <span key={tool} className="rounded-full border border-[#e1e8f3] bg-[#f8fbff] px-2.5 py-1 text-xs text-[#596980]">{tool}</span>)}
        </div>
        <Button nativeButton={false} render={<Link href={`/?preset=${encodeURIComponent(preset.id)}`} />} className="mt-5 w-full">
          Open in builder <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}

export function TemplateCatalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(() => ["All", ...new Set(presets.map((preset) => preset.category))], []);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return presets.filter((preset) => {
      const categoryMatch = category === "All" || preset.category === category;
      const searchMatch = !needle || [preset.title, preset.tagline, preset.description, ...preset.tools].join(" ").toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [category, query]);

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-[#dbe4f1] bg-white p-3 shadow-[0_10px_32px_rgba(49,84,144,0.055)]">
        <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#52617a]" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 pl-12" placeholder="Search all 12 crypto recipes" aria-label="Search templates" /></div>
        <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label="Template categories">
          {categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className={`min-h-11 shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30 ${category === item ? "border-[#245fe5] bg-[#245fe5] text-white" : "border-[#dbe4f1] bg-white text-[#52617a] hover:bg-[#f1f6ff]"}`}>{item}</button>)}
        </div>
      </div>

      <div className="mt-7 flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#245fe5]">Category-native starters</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{visible.length} proven foundations</h2></div><p className="hidden max-w-md text-right text-sm leading-6 text-[#52617a] md:block">Every card comes from the current production recipe catalog. No generic placeholder templates are added.</p></div>
      {visible.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map((preset) => <PresetCard key={preset.id} preset={preset} />)}</div> : <div className="mt-5 rounded-2xl border border-dashed border-[#b9ccff] bg-white px-6 py-16 text-center"><h2 className="text-xl font-semibold">No matching recipe</h2><p className="mt-2 text-sm text-[#52617a]">Try another search or open the blank-canvas builder.</p><Button nativeButton={false} render={<Link href="/" />} variant="outline" className="mt-5">Open custom builder</Button></div>}
    </section>
  );
}
