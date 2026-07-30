import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import {
  ProjectV2Workspace,
  type ProjectV2PreviewDevice,
  type ProjectV2WorkspaceProps,
  type ProjectV2WorkspaceView,
} from "@/components/project-v2-workspace";
import type { ProjectFileV2, ProjectV2 } from "@/lib/project-v2-types";

const createdAt = "2026-07-30T12:00:00.000Z";

const files: Record<string, ProjectFileV2> = {
  "app/page.tsx": {
    kind: "file",
    path: "app/page.tsx",
    content: `export default function Page() {\n  return <main>Whale intelligence</main>;\n}\n`,
    language: "tsx",
    role: "entry",
    provenance: "generated",
    editable: true,
    bytes: 83,
    hash: "1111111111111111111111111111111111111111111111111111111111111111",
    createdAt,
    updatedAt: createdAt,
  },
  "components/market-table.tsx": {
    kind: "file",
    path: "components/market-table.tsx",
    content: `export function MarketTable() {\n  return <section>Market context</section>;\n}\n`,
    language: "tsx",
    role: "component",
    provenance: "ai",
    editable: true,
    bytes: 82,
    hash: "2222222222222222222222222222222222222222222222222222222222222222",
    createdAt,
    updatedAt: createdAt,
  },
  "package.json": {
    kind: "file",
    path: "package.json",
    content: JSON.stringify({ private: true, scripts: { build: "next build", test: "node --test" } }, null, 2),
    language: "json",
    role: "manifest",
    provenance: "generated",
    editable: true,
    bytes: 112,
    hash: "3333333333333333333333333333333333333333333333333333333333333333",
    createdAt,
    updatedAt: createdAt,
  },
};

const productSpec = {} as ProjectV2["productSpec"];

const project: ProjectV2 = {
  schemaVersion: 2,
  id: "whale-intelligence-v2",
  revision: 4,
  contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  manifest: {
    schemaVersion: 2,
    name: "Whale Intelligence",
    slug: "whale-intelligence",
    packageManager: "npm",
    framework: { name: "nextjs", version: "16.2.12" },
    runtime: { name: "nodejs", version: "24" },
    scripts: { build: "next build", test: "node --test", dev: "next dev" },
    dependencies: { next: "16.2.12", react: "19.2.4", "react-dom": "19.2.4" },
    devDependencies: { typescript: "5.9.3" },
    entrypoints: ["app/page.tsx"],
    legacyFallback: {
      supported: true,
      adapter: "legacy-html",
      reason: "V1 compatibility remains available.",
      sourceSchemaVersion: 1,
    },
  },
  files,
  productSpec,
  integrations: [
    {
      id: "dropstab",
      kind: "dropstab",
      status: "setup-required",
      capabilities: ["coins", "unlocks", "funding"],
      proxyPath: "/api/public-data",
      providerEvidenceRequired: true,
    },
    {
      id: "project-data",
      kind: "project-data",
      status: "demo",
      capabilities: ["documents", "event-inbox"],
      proxyPath: "/api/project-data",
      providerEvidenceRequired: false,
    },
  ],
  environment: [
    {
      name: "DROPSTAB_API_KEY",
      description: "Server-side DropsTab connection for live market enrichment.",
      required: false,
      secret: true,
      scope: "runtime",
    },
  ],
  permissions: [
    {
      id: "telegram-delivery",
      capability: "telegram.publish",
      effect: "approval-required",
      destructive: false,
      external: true,
    },
  ],
  tasks: [
    { id: "typecheck", label: "Typecheck", kind: "typecheck", command: "npm", args: ["run", "typecheck"], cwd: ".", timeoutMs: 120_000, approvalRequired: false },
    { id: "build", label: "Production build", kind: "build", command: "npm", args: ["run", "build"], cwd: ".", timeoutMs: 300_000, approvalRequired: false },
  ],
  runs: [],
  logs: [],
  checkpoints: [],
  preview: { status: "idle", projectRevision: 4 },
  deployment: { status: "none", provider: "vercel" },
  migration: {
    sourceSchemaVersion: 2,
    sourceKind: "project-v2-template",
    sourceFidelity: "native",
    adapter: "native-v2",
    migratedAt: createdAt,
  },
  createdAt,
  updatedAt: createdAt,
};

function WorkspaceStory(props: ProjectV2WorkspaceProps) {
  const [selectedPath, setSelectedPath] = useState(props.selectedPath);
  const [draft, setDraft] = useState(props.draftContent);
  const [view, setView] = useState<ProjectV2WorkspaceView>(props.activeView ?? "files");
  const [device, setDevice] = useState<ProjectV2PreviewDevice>(props.previewDevice ?? "desktop");

  function selectFile(path: string) {
    setSelectedPath(path);
    setDraft(props.project.files[path]?.content ?? "");
    props.onSelectFile(path);
  }

  return (
    <div style={{ minHeight: 790, padding: 16 }}>
      <ProjectV2Workspace
        {...props}
        activeView={view}
        draftContent={draft}
        onActiveViewChange={setView}
        onDraftChange={setDraft}
        onPreviewDeviceChange={setDevice}
        onSelectFile={selectFile}
        previewDevice={device}
        selectedPath={selectedPath}
      />
    </div>
  );
}

const meta = {
  title: "Project Studio/V2 Workspace",
  component: ProjectV2Workspace,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    project,
    selectedPath: "app/page.tsx",
    draftContent: files["app/page.tsx"].content,
    comparisonFiles: {
      ...files,
      "app/page.tsx": {
        ...files["app/page.tsx"],
        content: `export default function Page() {\n  return <main>Wallet monitor</main>;\n}\n`,
      },
    },
    comparisonLabel: "Checkpoint before Director edit",
    checks: [],
    logEntries: [],
    browserErrors: [],
    deploymentHistory: [],
    releaseReadiness: { status: "unknown", evidence: [], blockers: [] },
    onSelectFile: fn(),
    onDraftChange: fn(),
    onSaveFile: fn(),
    onRevertFile: fn(),
    onCreateFile: fn(),
    onRenameFile: fn(),
    onDeleteFile: fn(),
    onRunTask: fn(),
    onRefreshPreview: fn(),
    onStopSandbox: fn(),
    onRestoreCheckpoint: fn(),
    onRequestDeployment: fn(),
    onRequestRollback: fn(),
    onOperationError: fn(),
  },
  render: (args) => <WorkspaceStory {...args} />,
} satisfies Meta<typeof ProjectV2Workspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToEdit: Story = {};

export const RuntimeUnavailable: Story = {
  args: {
    activeView: "preview",
    sandboxState: {
      status: "unavailable",
      message: "Vercel Sandbox credentials are not configured for this environment.",
    },
  },
};

export const ReadOnlyFallback: Story = {
  args: {
    readOnly: true,
    activeView: "integrations",
  },
};
