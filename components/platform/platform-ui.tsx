import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type PlatformStatus = "working" | "local" | "setup" | "configured" | "feature-gated";

const statusStyle: Record<PlatformStatus, string> = {
  working: "border-[#bde7d2] bg-[#eefbf4] text-[#087449]",
  local: "border-[#cfdcff] bg-[#f1f6ff] text-[#245fe5]",
  setup: "border-[#ecd9bb] bg-[#fff9ef] text-[#8a5709]",
  configured: "border-[#cfdcff] bg-[#eef4ff] text-[#1e55e8]",
  "feature-gated": "border-[#dbe4f1] bg-[#f7f9fc] text-[#596980]",
};

export function StatusBadge({ status, children }: { status: PlatformStatus; children: ReactNode }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${statusStyle[status]}`}>{children}</span>;
}

export function PageIntro({
  eyebrow,
  title,
  description,
  receipt,
}: {
  eyebrow: string;
  title: string;
  description: string;
  receipt?: ReactNode;
}) {
  return (
    <section className="mx-auto grid w-full max-w-[1500px] gap-8 px-4 pb-9 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end lg:px-8 lg:pt-20">
      <div>
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-[#245fe5]">{eyebrow}</p>
        <h1 className="max-w-5xl text-[42px] font-semibold leading-[0.98] tracking-[-0.055em] text-balance sm:text-[54px] lg:text-[68px]">{title}</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[#52617a]">{description}</p>
      </div>
      {receipt ? <aside className="rounded-3xl border border-[#cfdcff] bg-white p-5 shadow-[0_18px_54px_rgba(49,84,144,0.08)]">{receipt}</aside> : null}
    </section>
  );
}

export function SurfaceCard({
  icon: Icon,
  title,
  children,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`min-w-0 rounded-2xl border border-[#dbe4f1] bg-white p-5 shadow-[0_10px_32px_rgba(49,84,144,0.055)] ${className}`}>
      <div className="mb-5 flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><Icon className="size-5" aria-hidden="true" /></span><h2 className="text-lg font-semibold tracking-[-0.025em]">{title}</h2></div>
      {children}
    </article>
  );
}
