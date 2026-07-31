import Link from "next/link";
import type { ReactNode } from "react";
import { Plus, ShieldCheck } from "lucide-react";

import "@/app/styles/platform-tailwind.css";

import { Button } from "@/components/ui/button";
import { DropsBrand } from "@/components/drops-brand";

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
            <DropsBrand compact showPartners={false} />
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
        <div className="mx-auto grid w-full max-w-[1500px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)] lg:px-8">
          <div className="flex min-w-0 flex-col items-start gap-4">
            <DropsBrand compact />
            <p className="max-w-sm text-sm leading-6 text-[#52617a]">Real crypto products powered by DropsTab intelligence and approved Drops Bot delivery.</p>
            <span className="inline-flex items-start gap-2 rounded-xl bg-[#eef4ff] p-3 text-xs leading-5 text-[#52617a]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#245fe5]" aria-hidden="true" />Provider and deployment states appear only with matching evidence.</span>
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <div className="flex flex-col items-start"><strong className="mb-2 text-sm">Product</strong><Link className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="/templates">Templates</Link><Link className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="/projects">Projects</Link><Link className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="/integrations">Integrations</Link></div>
            <div className="flex flex-col items-start"><strong className="mb-2 text-sm">Ecosystem</strong><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://dropstab.com" target="_blank" rel="noreferrer">DropsTab</a><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://dropstab.com/products/drops-bot" target="_blank" rel="noreferrer">Drops Bot</a><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://api-docs.dropstab.com" target="_blank" rel="noreferrer">API Docs</a></div>
            <div className="flex flex-col items-start"><strong className="mb-2 text-sm">Community</strong><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://x.com/Dropstab_com" target="_blank" rel="noreferrer">X / Twitter</a><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://t.me/dropstab_en" target="_blank" rel="noreferrer">Telegram</a><a className="min-h-11 py-3 text-sm text-[#52617a] no-underline hover:text-[#245fe5]" href="https://discord.com/invite/8krdPBCvEU" target="_blank" rel="noreferrer">Discord</a></div>
          </div>
          <div className="flex flex-col gap-2 border-t border-[#e5ebf4] pt-5 text-xs text-[#596980] md:col-span-2 sm:flex-row sm:justify-between"><span>© {new Date().getFullYear()} Drops Studio</span><span>Credentials stay in this browser session · explicit approval for external actions</span></div>
        </div>
      </footer>
    </div>
  );
}
