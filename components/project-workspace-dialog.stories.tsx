import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { type ComponentProps, useState } from "react"
import { fn } from "storybook/test"

import {
  ProjectWorkspaceDialog,
  type WorkspaceRunReceiptView,
} from "@/components/project-workspace-dialog"
import type { ProjectWorkspace } from "@/lib/project-workspace"

const workspace: ProjectWorkspace = {
  schemaVersion: 1,
  revision: 7,
  updatedAt: "2026-07-30T10:00:00.000Z",
  files: [
    {
      path: "index.html",
      content: '<main data-project-kind="crypto-aggregator"></main>',
      language: "html",
      role: "entry",
      editable: true,
    },
    {
      path: "src/app.js",
      content: 'console.log("Drops workspace ready")',
      language: "javascript",
      role: "client",
      editable: true,
    },
    {
      path: "src/styles.css",
      content: ":root { color-scheme: light; }",
      language: "css",
      role: "style",
      editable: true,
    },
    {
      path: "package.json",
      content: JSON.stringify({
        private: true,
        type: "module",
        scripts: {
          check: "node scripts/check.mjs",
          test: "node tests/smoke.mjs",
          build: "node scripts/check.mjs && node tests/smoke.mjs",
          start: "node server.mjs",
        },
        dependencies: { zod: "4.0.0" },
      }, null, 2),
      language: "json",
      role: "package-manifest",
      editable: true,
    },
  ],
  tasks: [
    { id: "check", label: "Check workspace", command: "npm", args: ["run", "check"] },
    { id: "test", label: "Run tests", command: "npm", args: ["test"] },
    { id: "build", label: "Build release", command: "npm", args: ["run", "build"] },
    { id: "start", label: "Start preview", command: "npm", args: ["start"], port: 4173 },
  ],
  runtime: {
    executionMode: "static-preview",
    provider: "unconfigured",
    isolation: "browser-iframe",
    runtime: "node24",
    packageManager: "npm",
    installScripts: false,
  },
}

const verifiedReceipt: WorkspaceRunReceiptView = {
  provider: "vercel-sandbox",
  providerRunId: "drops-aggregator:session-01:command-01",
  workspaceId: "aggregator-project",
  workspaceRevision: 7,
  workspaceDigest: "a".repeat(64),
  task: "build",
  argv: ["npm", "run", "build"],
  exitCode: 0,
  stdout: "Workspace structure passed\nWorkspace runtime smoke passed",
  stderr: "",
  startedAt: "2026-07-30T10:00:00.000Z",
  finishedAt: "2026-07-30T10:00:02.000Z",
}

type WorkspaceStoryProps = ComponentProps<typeof ProjectWorkspaceDialog>

function WorkspaceStory(props: WorkspaceStoryProps) {
  const [open, setOpen] = useState(props.open)
  const [activePath, setActivePath] = useState(props.activePath)
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.workspace.files.map((file) => [file.path, file.content])),
  )
  const [prompt, setPrompt] = useState(props.aiPrompt)
  const draft = drafts[activePath] ?? ""

  return (
    <ProjectWorkspaceDialog
      {...props}
      open={open}
      activePath={activePath}
      draft={draft}
      aiPrompt={prompt}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        props.onOpenChange(nextOpen)
      }}
      onSelectPath={(path) => {
        setActivePath(path)
        props.onSelectPath(path)
      }}
      onDraftChange={(value) => {
        setDrafts((current) => ({ ...current, [activePath]: value }))
        props.onDraftChange(value)
      }}
      onAiPromptChange={(value) => {
        setPrompt(value)
        props.onAiPromptChange(value)
      }}
    />
  )
}

const meta = {
  title: "Project Studio/Source workspace",
  component: ProjectWorkspaceDialog,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    workspaceId: "aggregator-project",
    workspace,
    activePath: "src/app.js",
    draft: workspace.files[1].content,
    qualityReport: JSON.stringify({ score: 100, readyToPublish: true }, null, 2),
    issues: [],
    runningTask: null,
    receipt: null,
    currentWorkspaceDigest: "a".repeat(64),
    runError: "",
    aiPrompt: "",
    aiRunning: false,
    aiError: "",
    aiEvidence: null,
    aiQuota: null,
    onOpenChange: fn(),
    onSelectPath: fn(),
    onDraftChange: fn(),
    onApply: fn(),
    onCreateFile: fn(),
    onDeleteFile: fn(),
    onRunTask: fn(),
    onAiPromptChange: fn(),
    onGenerateAiPatch: fn(),
    onDownload: fn(),
    onToast: fn(),
  },
} satisfies Meta<typeof ProjectWorkspaceDialog>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyToEdit: Story = {
  render: (args) => <WorkspaceStory {...args} />,
}

export const VerifiedSandboxRun: Story = {
  args: {
    receipt: verifiedReceipt,
    aiEvidence: null,
    aiQuota: null,
  },
  parameters: {
    docs: {
      description: {
        story:
          "A completed ephemeral Vercel Sandbox receipt. The canonical workspace remains unconfigured at rest; the receipt is separate provider evidence for this run only.",
      },
    },
  },
  render: (args) => <WorkspaceStory {...args} />,
}

export const HistoricalSandboxRun: Story = {
  args: {
    receipt: { ...verifiedReceipt, workspaceRevision: 6 },
  },
  parameters: {
    docs: {
      description: {
        story:
          "Terminal output remains available after an edit, but the receipt is historical until the current workspace revision runs again.",
      },
    },
  },
  render: (args) => <WorkspaceStory {...args} />,
}
