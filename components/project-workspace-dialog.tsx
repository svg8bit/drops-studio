"use client"

import "@/app/styles/tailwind.css"

import {
  Box,
  Check,
  CircleStop,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileJson2,
  FileText,
  FolderTree,
  LoaderCircle,
  Package,
  Play,
  TerminalSquare,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import type {
  ProjectWorkspace,
  ProjectWorkspaceTask,
} from "@/lib/project-workspace"
import { workspaceRunReceiptStatus } from "@/lib/workspace-run-receipt"

export interface WorkspaceRunReceiptView {
  provider: "vercel-sandbox"
  providerRunId: string
  workspaceId: string
  workspaceRevision: number
  workspaceDigest: string
  task: string
  argv: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  startedAt: string
  finishedAt?: string
  previewUrl?: string
}

export interface WorkspaceAiEvidenceView {
  status: "provider-response"
  provider: "vercel-ai-gateway" | "openrouter" | "openai" | "anthropic" | "kimi"
  model: string
  providerRequestId: string | null
  credentialOwner: "platform" | "visitor"
  keyPersisted: false
  billing: "platform-funded" | "provider-direct-no-studio-markup"
  generatedAt: string
}

export interface WorkspaceAiQuotaView {
  tier: "guest" | "member" | "pro"
  limit: number
  used: number
  remaining: number
  reset: "daily-utc"
}

interface ProjectWorkspaceDialogProps {
  open: boolean
  workspaceId: string
  workspace: ProjectWorkspace
  activePath: string
  draft: string
  qualityReport: string
  issues: string[]
  runningTask: ProjectWorkspaceTask["id"] | null
  receipt: WorkspaceRunReceiptView | null
  currentWorkspaceDigest: string | null
  runError: string
  aiPrompt: string
  aiRunning: boolean
  aiError: string
  aiEvidence: WorkspaceAiEvidenceView | null
  aiQuota: WorkspaceAiQuotaView | null
  onOpenChange: (open: boolean) => void
  onSelectPath: (path: string) => void
  onDraftChange: (value: string) => void
  onApply: () => void
  onCreateFile: (path: string) => void
  onDeleteFile: (path: string) => void
  onRunTask: (task: ProjectWorkspaceTask) => void
  onAiPromptChange: (value: string) => void
  onGenerateAiPatch: () => void
  onDownload: () => void
  onToast: (message: string) => void
}

function sourceIcon(path: string) {
  if (path.endsWith(".json")) return FileJson2
  if (path.endsWith(".md")) return FileText
  return FileCode2
}

function dependencyCount(workspace: ProjectWorkspace): number {
  const manifest = workspace.files.find((file) => file.path === "package.json")
  if (!manifest) return 0
  try {
    const parsed = JSON.parse(manifest.content) as {
      dependencies?: Record<string, unknown>
    }
    return Object.keys(parsed.dependencies ?? {}).length
  } catch {
    return 0
  }
}

export function ProjectWorkspaceDialog({
  open,
  workspaceId,
  workspace,
  activePath,
  draft,
  qualityReport,
  issues,
  runningTask,
  receipt,
  currentWorkspaceDigest,
  runError,
  aiPrompt,
  aiRunning,
  aiError,
  aiEvidence,
  aiQuota,
  onOpenChange,
  onSelectPath,
  onDraftChange,
  onApply,
  onCreateFile,
  onDeleteFile,
  onRunTask,
  onAiPromptChange,
  onGenerateAiPatch,
  onDownload,
  onToast,
}: ProjectWorkspaceDialogProps) {
  const [newPath, setNewPath] = useState("")
  const receiptStatus = workspaceRunReceiptStatus(
    receipt,
    {
      workspaceId,
      workspaceRevision: workspace.revision,
      workspaceDigest: currentWorkspaceDigest,
      task: receipt?.task ?? null,
    },
    { running: Boolean(runningTask), error: runError },
  )
  const receiptMatchesWorkspace = receiptStatus === "verified"
  const qualitySelected = activePath === "quality-report.json"
  const activeFile = workspace.files.find((file) => file.path === activePath)
  const activeContent = qualitySelected ? qualityReport : draft
  const editable = Boolean(activeFile?.editable && !qualitySelected)
  const requiredPath = new Set([
    "index.html",
    "src/styles.css",
    "src/app.js",
    "project.json",
    "drops.config.json",
    "package.json",
    "server.mjs",
    "scripts/check.mjs",
    "tests/smoke.mjs",
    "README.md",
  ]).has(activePath)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(92vh,920px)] w-[min(96vw,1480px)] max-w-none sm:max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-2xl"
        overlayClassName="bg-slate-950/45 backdrop-blur-sm"
        showCloseButton={false}
      >
        <DialogHeader className="gap-3 border-b border-border px-5 py-4 pr-16 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <TerminalSquare className="size-5 text-primary" aria-hidden="true" />
              Owned source workspace
            </DialogTitle>
            <DialogDescription className="text-sm">
              Edit the same multi-file revision that preview, sandbox tasks, ZIP,
              and publishing consume.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">Revision {workspace.revision}</Badge>
            <Badge variant="secondary">
              <Package data-icon="inline-start" aria-hidden="true" />
              {dependencyCount(workspace)} dependencies
            </Badge>
            <Badge variant="outline">Node 24</Badge>
            <DialogClose
              aria-label="Close source workspace"
              className="ml-1 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="min-h-0 border-b border-border bg-muted/35 lg:border-r lg:border-b-0" aria-label="Workspace files">
            <div className="flex h-12 items-center gap-2 border-b border-border px-4 text-sm font-medium">
              <FolderTree className="size-4" aria-hidden="true" />
              Files
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {workspace.files.length}
              </span>
            </div>
            <ScrollArea className="h-[150px] lg:h-[calc(100%-3rem)]">
              <form
                className="flex gap-2 border-b border-border p-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const path = newPath.trim()
                  if (!path) return
                  onCreateFile(path)
                  setNewPath("")
                }}
              >
                <Input
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  placeholder="src/new-file.js"
                  aria-label="New workspace file path"
                  className="min-w-0 text-sm"
                />
                <Button type="submit" variant="outline" size="icon-sm" aria-label="Create workspace file">
                  <FilePlus2 aria-hidden="true" />
                </Button>
              </form>
              <nav className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="Source files">
                {[...workspace.files, {
                  path: "quality-report.json",
                  content: qualityReport,
                  language: "json",
                  role: "project-config" as const,
                  editable: false,
                }].map((file) => {
                  const Icon = sourceIcon(file.path)
                  const selected = file.path === activePath
                  return (
                    <Button
                      key={file.path}
                      type="button"
                      variant={selected ? "secondary" : "ghost"}
                      className="h-11 min-w-0 justify-start overflow-hidden px-3 text-sm"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => onSelectPath(file.path)}
                    >
                      <Icon data-icon="inline-start" aria-hidden="true" />
                      <span className="truncate">{file.path}</span>
                    </Button>
                  )
                })}
              </nav>
            </ScrollArea>
          </aside>

          <main className="grid min-h-0 grid-rows-[auto_auto_minmax(220px,1fr)_auto_minmax(150px,0.48fr)] bg-background">
            <section className="space-y-2 border-b border-border bg-blue-50/70 p-3 text-blue-950" aria-label="AI workspace change">
              <div className="flex flex-wrap items-center gap-2">
                <WandSparkles className="size-4" aria-hidden="true" />
                <strong className="text-sm">AI source change</strong>
                <span className="text-sm text-blue-800">
                  One reviewed patch, one optimistic revision, no raw shell commands.
                </span>
                {aiEvidence ? (
                  <Badge variant="outline" className="ml-auto border-blue-300 bg-white text-blue-900">
                    {aiEvidence.model} · {aiEvidence.credentialOwner === "visitor" ? "BYOK, 0% Studio markup" : "platform funded"}
                  </Badge>
                ) : null}
                {aiQuota ? (
                  <Badge variant="outline" className="border-blue-300 bg-white text-blue-900">
                    {aiQuota.tier} · {aiQuota.remaining}/{aiQuota.limit} builds left today
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Textarea
                  value={aiPrompt}
                  onChange={(event) => onAiPromptChange(event.target.value)}
                  placeholder="Describe a coherent product change across the source files…"
                  aria-label="AI workspace change request"
                  className="min-h-11 flex-1 resize-y border-blue-200 bg-white text-sm leading-6"
                  rows={2}
                />
                <Button
                  type="button"
                  className="min-h-11 shrink-0"
                  disabled={aiRunning || aiPrompt.trim().length < 3}
                  onClick={onGenerateAiPatch}
                >
                  {aiRunning ? (
                    <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                  ) : (
                    <WandSparkles data-icon="inline-start" aria-hidden="true" />
                  )}
                  {aiRunning ? "Generating patch…" : "Generate & apply"}
                </Button>
              </div>
              {aiError ? <p className="text-sm leading-6 text-destructive" role="alert">{aiError}</p> : null}
            </section>

            <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <Code2 className="size-4 text-muted-foreground" aria-hidden="true" />
              <code className="min-w-0 truncate text-sm font-medium">{activePath}</code>
              {!editable ? <Badge variant="outline">Read only</Badge> : null}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      onToast("Copy is unavailable in this browser")
                      return
                    }
                    void navigator.clipboard.writeText(activeContent)
                      .then(() => onToast(`${activePath} copied`))
                      .catch(() => onToast("Could not copy this file"))
                  }}
                >
                  <Copy data-icon="inline-start" aria-hidden="true" />
                  Copy
                </Button>
                {editable ? (
                  <>
                    {!requiredPath ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-sm"
                        aria-label={`Delete ${activePath}`}
                        onClick={() => onDeleteFile(activePath)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" onClick={onApply}>
                      <Check data-icon="inline-start" aria-hidden="true" />
                      Validate & apply
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {qualitySelected ? (
              <ScrollArea className="min-h-0">
                <pre className="min-h-full whitespace-pre-wrap p-4 font-mono text-sm leading-6 text-foreground" tabIndex={0} aria-label="quality-report.json contents">
                  {qualityReport}
                </pre>
              </ScrollArea>
            ) : (
              <Textarea
                className="min-h-0 resize-none rounded-none border-0 bg-background p-4 font-mono text-sm leading-6 shadow-none focus-visible:ring-0"
                spellCheck={false}
                readOnly={!editable}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                aria-label={
                  activePath === "index.html"
                    ? "Editable runnable HTML"
                    : `Editable ${activePath}`
                }
              />
            )}

            <div className="border-y border-border bg-[var(--muted-surface)] text-[var(--foreground)]">
              {issues.length ? (
                <div className="px-4 py-3 text-sm text-destructive" role="alert">
                  <strong>Validation stopped this revision</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {issues.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2">
                  <TerminalSquare className="size-4" aria-hidden="true" />
                  <strong className="text-sm">Tasks</strong>
                  {workspace.tasks.map((task) => (
                    <Button
                      key={task.id}
                      type="button"
                      variant={task.id === "start" ? "default" : "outline"}
                      size="sm"
                      disabled={Boolean(runningTask)}
                      onClick={() => onRunTask(task)}
                    >
                      {runningTask === task.id ? (
                        <CircleStop data-icon="inline-start" className="animate-pulse" aria-hidden="true" />
                      ) : task.id === "start" ? (
                        <Play data-icon="inline-start" aria-hidden="true" />
                      ) : (
                        <Box data-icon="inline-start" aria-hidden="true" />
                      )}
                      {task.label}
                    </Button>
                  ))}
                  <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
                  <span className="text-sm text-muted-foreground">
                    Registry packages only · install scripts disabled
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onDownload}>
                    <Download data-icon="inline-start" aria-hidden="true" />
                    Download full ZIP
                  </Button>
                </div>
              )}
            </div>

            <section className="min-h-0 bg-slate-950 text-slate-100" aria-label="Terminal output">
              <div className="flex min-h-11 items-center gap-2 border-b border-white/10 px-4 text-sm">
                <TerminalSquare className="size-4" aria-hidden="true" />
                <strong>Terminal</strong>
                {receiptMatchesWorkspace ? (
                  <Badge className="ml-auto border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                    Verified sandbox receipt · exact digest · revision {receipt?.workspaceRevision}
                  </Badge>
                ) : receiptStatus === "previous" && receipt ? (
                  <Badge className="ml-auto border-slate-400/30 bg-slate-400/10 text-slate-200">
                    Previous verified receipt · revision {receipt.workspaceRevision}
                  </Badge>
                ) : receipt ? (
                  <Badge className="ml-auto border-amber-400/30 bg-amber-400/10 text-amber-200">
                    Historical receipt · revision {receipt.workspaceRevision}
                  </Badge>
                ) : (
                  <span className="ml-auto text-sm text-slate-400">No provider claim before a real run</span>
                )}
              </div>
              <ScrollArea className="h-[calc(100%-2.75rem)]">
                <div className="space-y-2 p-4 font-mono text-sm leading-6">
                  {runningTask ? <p className="text-blue-300">$ Running {runningTask} in an isolated workspace…</p> : null}
                  {runError ? <p className="whitespace-pre-wrap text-rose-300">{runError}</p> : null}
                  {receipt ? (
                    <>
                      {receiptStatus === "previous" ? (
                        <p className="whitespace-pre-wrap text-slate-300">
                          The current run is pending or failed. Output retained below belongs to the previous verified attempt for revision {receipt.workspaceRevision}.
                        </p>
                      ) : receiptStatus === "historical" ? (
                        <p className="whitespace-pre-wrap text-amber-200">
                          Output retained from workspace revision {receipt.workspaceRevision}; current revision {workspace.revision} needs a new sandbox run.
                        </p>
                      ) : null}
                      <p className="text-slate-400">$ {receipt.task} · run {receipt.providerRunId}</p>
                      {receipt.stdout ? <pre className="whitespace-pre-wrap text-slate-100">{receipt.stdout}</pre> : null}
                      {receipt.stderr ? <pre className="whitespace-pre-wrap text-amber-200">{receipt.stderr}</pre> : null}
                      <p className={receiptMatchesWorkspace ? (receipt.exitCode === null ? "text-sky-300" : receipt.exitCode === 0 ? "text-emerald-300" : "text-rose-300") : "text-slate-300"}>
                        {receiptMatchesWorkspace
                          ? receipt.exitCode === null
                            ? "Process running in isolated preview"
                            : `Process exited with code ${receipt.exitCode}`
                          : receipt.exitCode === null
                            ? "Retained receipt recorded a running isolated preview"
                            : `Retained receipt exited with code ${receipt.exitCode}`}
                      </p>
                      {receipt.previewUrl ? (
                        <a className="inline-flex min-h-11 items-center gap-2 text-blue-300 underline underline-offset-4" href={receipt.previewUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" aria-hidden="true" />
                          {receiptMatchesWorkspace
                            ? "Open live sandbox port"
                            : receiptStatus === "previous"
                              ? "Open previous sandbox port"
                              : "Open historical sandbox port"}
                        </a>
                      ) : null}
                    </>
                  ) : !runningTask && !runError ? (
                    <p className="text-slate-400">Run Check, Test, Build, or Start. Stdout, stderr, exit code, and provider run ID will appear here.</p>
                  ) : null}
                </div>
              </ScrollArea>
            </section>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
