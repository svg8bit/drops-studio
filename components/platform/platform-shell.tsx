import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Plus, ShieldCheck } from "lucide-react";

import "@/app/styles/platform-tailwind.css";

import { Button } from "@/components/ui/button";

const navigation = [
  { href: "/projects", label: "Projects" },
  { href: "/templates", label: "Templates" },
  { href: "/backend", label: "Backend" },
  { href: "/integrations", label: "Integrations" },
  { href: "/organizations", label: "Organizations" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/platform", label: "Platform" },
] as const;

export function PlatformShell({
  active,
  children,
}: {
  active: (typeof navigation)[number]["label"];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-x-clip bg-[#f8fbff] text-[#07142f]">
      <header className="sticky top-0 z-40 border-b border-[#dbe4f1] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-[1500px] flex-wrap items-center gap-3 px-4 py-2 sm:px-6 lg:flex-nowrap lg:px-8">
          <Link href="/" className="flex min-h-11 min-w-11 items-center gap-2.5 rounded-xl pr-3 text-sm font-semibold tracking-[-0.02em] no-underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30">
            <span className="grid size-9 place-items-center rounded-xl bg-[#eef4ff]">
              <Image src="/brand/dropstab-mark.svg" alt="" width={22} height={22} priority />
            </span>
            <span className="text-lg">Drops <b className="text-[#245fe5]">Studio</b></span>
          </Link>

          <nav aria-label="Product navigation" className="order-3 flex w-full gap-1 overflow-x-auto border-t border-[#e8eef7] pt-2 lg:order-none lg:ml-6 lg:w-auto lg:border-0 lg:pt-0">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active === item.label ? "page" : undefined}
                className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-2 text-center text-xs font-semibold no-underline transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30 sm:px-4 sm:text-sm ${
                  active === item.label
                    ? "bg-[#eef4ff] text-[#1e55e8]"
                    : "text-[#52617a] hover:bg-[#f1f6ff] hover:text-[#07142f]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button nativeButton={false} render={<Link href="/?connections=1" />} variant="outline" className="hidden no-underline sm:inline-flex">
              Connections
            </Button>
            <Button nativeButton={false} render={<Link href="/" />} className="no-underline">
              <Plus aria-hidden="true" />
              New project
            </Button>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-[#dbe4f1] bg-white">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><ShieldCheck className="size-5" aria-hidden="true" /></span>
            <div><strong className="text-sm">Truthful by design</strong><p className="mt-1 max-w-xl text-xs leading-5 text-[#52617a]">Provider, build, integration, and deployment states appear only when Drops Studio has matching evidence.</p></div>
          </div>
          <Link href="/platform" className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[#245fe5] no-underline hover:bg-[#eef4ff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#316cff]/30">
            Explore the platform <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
