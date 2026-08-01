import { Cloud, FolderKanban } from "lucide-react";

import { PlatformShell } from "@/components/platform/platform-shell";
import { PageIntro, StatusBadge } from "@/components/platform/platform-ui";
import { ProjectLibrary } from "@/components/platform/project-library";

export default function ProjectsPage() {
  return <PlatformShell active="Projects"><PageIntro eyebrow="Project workspace" title="Your private projects, one click from Studio." description="Sign in to restore account-owned projects, inspect verified publication receipts, or start a new multi-file crypto product. Guest browser drafts are kept separate." receipt={<><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#245fe5]"><FolderKanban className="size-5" aria-hidden="true" /></span><div><strong className="text-sm">Account-scoped library</strong><p className="mt-1 text-xs text-[#52617a]">No guest draft is presented as account data</p></div></div><div className="mt-5 flex items-center justify-between gap-3"><StatusBadge status="configured">Private sync</StatusBadge><Cloud className="size-5 text-[#245fe5]" aria-hidden="true" /></div></>} /><ProjectLibrary /></PlatformShell>;
}
