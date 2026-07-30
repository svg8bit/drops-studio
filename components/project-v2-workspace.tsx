"use client";

import {
  AlertCircle,
  ArchiveRestore,
  BrainCircuit,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clock3,
  CloudUpload,
  Code2,
  Database,
  File,
  FileDiff,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  History,
  KeyRound,
  Laptop,
  ListChecks,
  LoaderCircle,
  Logs,
  Monitor,
  Pencil,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  BuilderRunV2,
  ProjectDeploymentStateV2,
  ProjectFileV2,
  ProjectIntegrationManifestV2,
  ProjectV2,
} from "@/lib/project-v2-types";
import type { AgentRunTrace } from "@/lib/agent/evals/types";

import { ProjectV2AgentIntelligence } from "./project-v2-agent-intelligence";

import {
  buildProjectV2FileTree,
  createProjectV2LineDiff,
  filterProjectV2FileTree,
  formatProjectV2Duration,
  verifiedProjectV2PreviewUrl,
  type ProjectV2FileTreeNode,
} from "./project-v2-workspace-model";
import styles from "./project-v2-workspace.module.css";

const LazyCodeEditor = lazy(() => import("./project-v2-code-editor"));

export type ProjectV2WorkspaceView =
  | "files"
  | "preview"
  | "agent"
  | "data"
  | "logic"
  | "checks"
  | "logs"
  | "integrations"
  | "history"
  | "deploy";

export type ProjectV2PreviewDevice = "desktop" | "tablet" | "mobile";

export type ProjectV2WorkspaceAction =
  | `save:${string}`
  | `revert:${string}`
  | `create:${string}`
  | `rename:${string}`
  | `delete:${string}`
  | `task:${string}`
  | `checkpoint:${string}`
  | `rollback:${string}`
  | "refresh-preview"
  | "stop-sandbox"
  | "github-inspect"
  | "github-import"
  | "github-publish"
  | "request-deployment";

export interface ProjectV2GitHubFile {
  path: string;
  content: string;
}

export interface ProjectV2SandboxViewState {
  status: "unavailable" | "creating" | "running" | "stopping" | "stopped" | "failed";
  sandboxId?: string;
  startedAt?: string;
  idleDeadlineAt?: string;
  message?: string;
}

export interface ProjectV2CheckView {
  id: string;
  label: string;
  kind: "build" | "browser" | "lint" | "security" | "test" | "typecheck";
  status: "idle" | "running" | "passed" | "failed" | "unavailable";
  message?: string;
  runId?: string;
  durationMs?: number;
  taskId?: string;
}

export interface ProjectV2LogEntryView {
  id: string;
  runId: string;
  stream: "audit" | "browser" | "stderr" | "stdout";
  timestamp: string;
  text: string;
  truncated?: boolean;
}

export interface ProjectV2BrowserErrorView {
  id: string;
  kind: "console" | "network" | "page";
  message: string;
  timestamp: string;
  url?: string;
}

export interface ProjectV2DeploymentReceiptView extends ProjectDeploymentStateV2 {
  id: string;
  projectRevision: number;
  finishedAt?: string;
  commitSha?: string;
  error?: string;
}

export interface ProjectV2ReleaseReadiness {
  status: "unknown" | "blocked" | "ready";
  evidence: string[];
  blockers: string[];
}

export interface ProjectV2WorkspaceProps {
  project: ProjectV2;
  selectedPath: string | null;
  draftContent: string;
  activeView?: ProjectV2WorkspaceView;
  previewDevice?: ProjectV2PreviewDevice;
  readOnly?: boolean;
  busyAction?: ProjectV2WorkspaceAction | null;
  comparisonFiles?: Record<string, ProjectFileV2>;
  comparisonLabel?: string;
  sandboxState?: ProjectV2SandboxViewState;
  checks?: readonly ProjectV2CheckView[];
  logEntries?: readonly ProjectV2LogEntryView[];
  browserErrors?: readonly ProjectV2BrowserErrorView[];
  deploymentHistory?: readonly ProjectV2DeploymentReceiptView[];
  releaseReadiness?: ProjectV2ReleaseReadiness;
  agentTrace?: AgentRunTrace | null;
  className?: string;
  onActiveViewChange?: (view: ProjectV2WorkspaceView) => void;
  onPreviewDeviceChange?: (device: ProjectV2PreviewDevice) => void;
  onSelectFile: (path: string) => void;
  onDraftChange: (content: string) => void;
  onSaveFile?: (path: string, content: string) => void | Promise<void>;
  onRevertFile?: (path: string) => void | Promise<void>;
  onCreateFile?: (path: string) => void | Promise<void>;
  onRenameFile?: (from: string, to: string) => void | Promise<void>;
  onDeleteFile?: (path: string) => void | Promise<void>;
  onRunTask?: (taskId: string) => void | Promise<void>;
  onRefreshPreview?: () => void | Promise<void>;
  onStopSandbox?: () => void | Promise<void>;
  onRestoreCheckpoint?: (checkpointId: string) => void | Promise<void>;
  onRequestDeployment?: () => void | Promise<void>;
  onRequestRollback?: (deploymentId: string) => void | Promise<void>;
  onImportGitHubFiles?: (files: readonly ProjectV2GitHubFile[]) => void | Promise<void>;
  onOperationError?: (error: unknown, action: ProjectV2WorkspaceAction) => void;
}

const EMPTY_CHECKS: readonly ProjectV2CheckView[] = [];
const EMPTY_LOGS: readonly ProjectV2LogEntryView[] = [];
const EMPTY_BROWSER_ERRORS: readonly ProjectV2BrowserErrorView[] = [];
const EMPTY_DEPLOYMENTS: readonly ProjectV2DeploymentReceiptView[] = [];

const workspaceViews: Array<{
  id: ProjectV2WorkspaceView;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "files", label: "Files", icon: Files },
  { id: "preview", label: "Preview", icon: Monitor },
  { id: "agent", label: "Agent", icon: BrainCircuit },
  { id: "integrations", label: "Integrations", icon: PlugZap },
  { id: "data", label: "Data", icon: Database },
  { id: "logic", label: "Logic", icon: Braces },
  { id: "checks", label: "Test", icon: ListChecks },
  { id: "logs", label: "Logs", icon: Logs },
  { id: "history", label: "History", icon: History },
  { id: "deploy", label: "Deploy", icon: CloudUpload },
];

function displayTime(value: string | undefined): string {
  if (!value) return "Unavailable";
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(milliseconds);
}

function displayDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return "Duration unavailable";
  return milliseconds < 1_000
    ? `${Math.max(0, Math.round(milliseconds))} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusClass(status: string): string {
  if (["available", "passed", "ready", "running", "succeeded"].includes(status)) return styles.statusPositive;
  if (["failed", "blocked"].includes(status)) return styles.statusNegative;
  if (["building", "creating", "pending", "queued", "starting", "stopping", "running"].includes(status)) return styles.statusProgress;
  return styles.statusNeutral;
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge className={`${styles.statusBadge} ${statusClass(status)}`} variant="outline">
      {label ?? status.replaceAll("-", " ")}
    </Badge>
  );
}

function FileTreeBranch({
  nodes,
  expanded,
  selectedPath,
  searchActive,
  onSelect,
  onToggle,
}: {
  nodes: readonly ProjectV2FileTreeNode[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  return (
    <ul className={styles.fileTreeList}>
      {nodes.map((node) => {
        const open = searchActive || expanded.has(node.path);
        if (node.kind === "directory") {
          return (
            <li key={node.path}>
              <button
                aria-expanded={open}
                className={styles.treeRow}
                onClick={() => onToggle(node.path)}
                type="button"
              >
                {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                {open ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
                <span>{node.name}</span>
              </button>
              {open ? (
                <FileTreeBranch
                  expanded={expanded}
                  nodes={node.children}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  searchActive={searchActive}
                  selectedPath={selectedPath}
                />
              ) : null}
            </li>
          );
        }
        return (
          <li key={node.path}>
            <button
              aria-current={selectedPath === node.path ? "page" : undefined}
              className={`${styles.treeRow} ${selectedPath === node.path ? styles.treeRowSelected : ""}`}
              onClick={() => onSelect(node.path)}
              title={node.path}
              type="button"
            >
              <span className={styles.treeSpacer} />
              <File aria-hidden="true" />
              <span>{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({
  icon: Icon = Box,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.emptyState}>
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function RunStatus({ run }: { run: BuilderRunV2 }) {
  return (
    <article className={styles.runRow}>
      <div>
        <strong>{run.taskId}</strong>
        <span>Revision {run.projectRevision} · {displayTime(run.startedAt)}</span>
      </div>
      <StatusBadge status={run.status} />
    </article>
  );
}

interface GitHubReadinessPayload {
  configured?: boolean;
  mode?: "github-app" | "session-token-required";
  permissions?: string[];
  sessionTokenSupported?: boolean;
  explicitApprovalRequired?: string[];
  error?: string;
}

interface GitHubRepositoryView {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

interface GitHubPublishView {
  branch: string;
  commitSha: string;
  commitUrl: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  status: "pull-request-open";
}

interface GitHubActionPayload extends GitHubReadinessPayload {
  repository?: GitHubRepositoryView;
  files?: ProjectV2GitHubFile[];
  result?: GitHubPublishView;
  confirmed?: boolean;
}

const GITHUB_TOKEN_STORAGE_KEY = "drops-studio:github-access-token";

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function GitHubIntegrationPanel({
  project,
  releaseReadiness,
  readOnly,
  onImportFiles,
  onOperationError,
}: {
  project: ProjectV2;
  releaseReadiness?: ProjectV2ReleaseReadiness;
  readOnly: boolean;
  onImportFiles?: (files: readonly ProjectV2GitHubFile[]) => void | Promise<void>;
  onOperationError?: (error: unknown, action: ProjectV2WorkspaceAction) => void;
}) {
  const [readiness, setReadiness] = useState<GitHubReadinessPayload | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenConnected, setTokenConnected] = useState(false);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [repository, setRepository] = useState<GitHubRepositoryView | null>(null);
  const [publishReceipt, setPublishReceipt] = useState<GitHubPublishView | null>(null);
  const [busy, setBusy] = useState<"inspect" | "import" | "publish" | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Check configuration, then inspect a repository before importing or publishing.",
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTokenConnected(Boolean(window.sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)));
      void fetch("/api/integrations/github", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({})) as GitHubReadinessPayload;
        if (!response.ok) throw new Error(payload.error ?? "GitHub readiness is unavailable.");
        setReadiness(payload);
        setReadinessError(null);
      }).catch((error) => {
        if (controller.signal.aborted) return;
        setReadinessError(actionError(error, "GitHub readiness is unavailable."));
      });
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const credentialsReady = Boolean(readiness?.configured || tokenConnected);
  const repositoryInputReady = Boolean(owner.trim() && repo.trim());
  const canInspect = Boolean(readiness && !readinessError && credentialsReady && repositoryInputReady);
  const externalDisabled = readOnly || Boolean(busy) || !canInspect;

  function requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    const token = window.sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
    if (token) headers["x-github-access-token"] = token;
    return headers;
  }

  async function requestGitHub(
    action: "inspect" | "import" | "publish",
    values: Record<string, unknown>,
  ): Promise<GitHubActionPayload> {
    const response = await fetch("/api/integrations/github", {
      method: "POST",
      credentials: "same-origin",
      headers: requestHeaders(),
      body: JSON.stringify({ action, owner: owner.trim(), repo: repo.trim(), ...values }),
    });
    const payload = await response.json().catch(() => ({})) as GitHubActionPayload;
    if (!response.ok) throw new Error(payload.error ?? `GitHub ${action} failed.`);
    return payload;
  }

  async function runGitHubAction(
    action: "inspect" | "import" | "publish",
    operation: () => Promise<void>,
  ) {
    if (busy) return;
    setBusy(action);
    setStatusMessage(`${action.charAt(0).toUpperCase()}${action.slice(1)} in progress…`);
    try {
      await operation();
    } catch (error) {
      const failure = actionError(error, `GitHub ${action} failed.`);
      setStatusMessage(failure);
      onOperationError?.(error, `github-${action}`);
    } finally {
      setBusy(null);
    }
  }

  function connectToken() {
    const token = tokenDraft.trim();
    if (token.length < 20 || token.length > 512 || /\s/.test(token)) {
      setStatusMessage("Enter a valid GitHub token. It is kept only in this browser session.");
      return;
    }
    window.sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
    setTokenDraft("");
    setTokenConnected(true);
    setStatusMessage("Session-only GitHub token connected. It is not stored in project files.");
  }

  function disconnectToken() {
    window.sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    setTokenDraft("");
    setTokenConnected(false);
    setStatusMessage("Session-only GitHub token removed.");
  }

  const repositoryUrl = safeExternalUrl(repository?.url);
  const commitUrl = safeExternalUrl(publishReceipt?.commitUrl);
  const pullRequestUrl = safeExternalUrl(publishReceipt?.pullRequestUrl);

  return (
    <section className={`${styles.surfaceCard} ${styles.wideCard}`}>
      <div className={styles.surfaceHeading}>
        <div><span>GitHub</span><strong>Import source or open a reviewable pull request</strong></div>
        <GitPullRequest aria-hidden="true" />
      </div>
      <div className={styles.githubLayout}>
        <div className={styles.githubConnection}>
          <div className={styles.githubStatusLine}>
            <StatusBadge
              label={readinessError
                ? "Unavailable"
                : readiness?.configured
                  ? "GitHub App configured"
                  : tokenConnected
                    ? "Session token connected"
                    : readiness
                      ? "Session token required"
                      : "Checking configuration"}
              status={readinessError ? "failed" : credentialsReady ? "ready" : "unavailable"}
            />
            <span>{readiness?.permissions?.join(" · ") ?? "Least-privilege readiness not received"}</span>
          </div>
          {!readiness?.configured ? (
            <div className={styles.githubTokenRow}>
              <label>
                <span>Session-only access token</span>
                <Input
                  aria-label="Session-only GitHub access token"
                  autoComplete="off"
                  disabled={readOnly || Boolean(busy)}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder={tokenConnected ? "Token connected for this tab" : "github_pat_…"}
                  type="password"
                  value={tokenDraft}
                />
              </label>
              <Button disabled={readOnly || Boolean(busy) || !tokenDraft.trim()} onClick={connectToken} size="sm" type="button" variant="outline"><KeyRound aria-hidden="true" />Use for session</Button>
              <Button disabled={readOnly || Boolean(busy) || !tokenConnected} onClick={disconnectToken} size="sm" type="button" variant="ghost">Disconnect</Button>
            </div>
          ) : (
            <p className={styles.githubHelper}>The server-selected GitHub App installation is used. No installation or repository credential is accepted from project source.</p>
          )}
        </div>

        <div className={styles.githubRepositoryForm}>
          <label><span>Owner</span><Input aria-label="GitHub repository owner" disabled={readOnly || Boolean(busy)} onChange={(event) => setOwner(event.target.value)} placeholder="organization" value={owner} /></label>
          <label><span>Repository</span><Input aria-label="GitHub repository name" disabled={readOnly || Boolean(busy)} onChange={(event) => setRepo(event.target.value)} placeholder="crypto-product" value={repo} /></label>
          <label><span>Branch</span><Input aria-label="GitHub base branch" disabled={readOnly || Boolean(busy)} onChange={(event) => setBranch(event.target.value)} placeholder={repository?.defaultBranch ?? "main"} value={branch} /></label>
        </div>

        <div className={styles.githubActions}>
          <Button
            disabled={!canInspect || Boolean(busy) || readOnly}
            onClick={() => void runGitHubAction("inspect", async () => {
              const payload = await requestGitHub("inspect", {});
              if (!payload.repository) throw new Error("GitHub returned no repository receipt.");
              setRepository(payload.repository);
              setBranch((current) => current || payload.repository?.defaultBranch || "main");
              setStatusMessage(`Confirmed ${payload.repository.owner}/${payload.repository.repo} at ${payload.repository.defaultBranch}.`);
            })}
            size="sm"
            type="button"
            variant="outline"
          ><GitBranch aria-hidden="true" />Inspect repository</Button>
          <Button
            disabled={externalDisabled || !repository || !onImportFiles}
            onClick={() => {
              if (!window.confirm("Import this repository into the current project? Matching paths will be replaced; current-only files will be retained in a new revision.")) return;
              void runGitHubAction("import", async () => {
                const payload = await requestGitHub("import", { branch: branch.trim() || undefined, approved: true });
                if (!payload.files?.length) throw new Error("GitHub returned no importable files.");
                await onImportFiles?.(payload.files);
                setStatusMessage(`Imported ${payload.files.length} verified text files into a new project revision.`);
              });
            }}
            size="sm"
            type="button"
            variant="outline"
          >Import files</Button>
          <Button
            disabled={externalDisabled || !repository || releaseReadiness?.status !== "ready"}
            onClick={() => {
              if (!window.confirm("Create a real GitHub branch, commit, and pull request from this verified Project V2 revision?")) return;
              void runGitHubAction("publish", async () => {
                const payload = await requestGitHub("publish", {
                  studioProjectId: project.id,
                  conversationId: `${project.id}-${project.revision}`,
                  title: project.manifest.name,
                  description: "Review this verified Drops Studio Project V2 source before merge.",
                  baseBranch: branch.trim() || undefined,
                  approved: true,
                });
                if (!payload.confirmed || !payload.result) throw new Error("GitHub did not confirm the pull request.");
                setPublishReceipt(payload.result);
                setStatusMessage(`GitHub confirmed pull request #${payload.result.pullRequestNumber}.`);
              });
            }}
            size="sm"
            type="button"
          ><GitPullRequest aria-hidden="true" />Open pull request</Button>
        </div>

        <p aria-live="polite" className={styles.githubMessage}>{readinessError ?? statusMessage}</p>
        {repository ? (
          <div className={styles.githubReceipt}>
            <strong>{repository.owner}/{repository.repo}</strong>
            <span>{repository.private ? "Private" : "Public"} · default {repository.defaultBranch}</span>
            {repositoryUrl ? <a href={repositoryUrl} rel="noreferrer" target="_blank">View repository</a> : null}
          </div>
        ) : null}
        {publishReceipt ? (
          <div className={styles.githubReceipt}>
            <strong>{publishReceipt.branch}</strong>
            <code>{publishReceipt.commitSha.slice(0, 12)}</code>
            {commitUrl ? <a href={commitUrl} rel="noreferrer" target="_blank">View commit</a> : null}
            {pullRequestUrl ? <a href={pullRequestUrl} rel="noreferrer" target="_blank">Open pull request #{publishReceipt.pullRequestNumber}</a> : null}
          </div>
        ) : null}
        {releaseReadiness?.status !== "ready" ? <p className={styles.approvalNote}>Opening a pull request stays disabled until the current revision has verified release-gate evidence.</p> : null}
      </div>
    </section>
  );
}

export function ProjectV2Workspace({
  project,
  selectedPath,
  draftContent,
  activeView,
  previewDevice,
  readOnly = false,
  busyAction = null,
  comparisonFiles,
  comparisonLabel = "Comparison snapshot",
  sandboxState,
  checks = EMPTY_CHECKS,
  logEntries = EMPTY_LOGS,
  browserErrors = EMPTY_BROWSER_ERRORS,
  deploymentHistory = EMPTY_DEPLOYMENTS,
  releaseReadiness,
  agentTrace,
  className,
  onActiveViewChange,
  onPreviewDeviceChange,
  onSelectFile,
  onDraftChange,
  onSaveFile,
  onRevertFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onRunTask,
  onRefreshPreview,
  onStopSandbox,
  onRestoreCheckpoint,
  onRequestDeployment,
  onRequestRollback,
  onImportGitHubFiles,
  onOperationError,
}: ProjectV2WorkspaceProps) {
  const [localView, setLocalView] = useState<ProjectV2WorkspaceView>(activeView ?? "files");
  const [localDevice, setLocalDevice] = useState<ProjectV2PreviewDevice>(previewDevice ?? "desktop");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["app", "components", "lib", "src", "tests"]));
  const [internalAction, setInternalAction] = useState<ProjectV2WorkspaceAction | null>(null);
  const [fileAction, setFileAction] = useState<"create" | "rename" | "delete" | null>(null);
  const [fileActionPath, setFileActionPath] = useState("");
  const [sourceMode, setSourceMode] = useState<"editor" | "diff">("editor");
  const [logFilter, setLogFilter] = useState<"all" | ProjectV2LogEntryView["stream"]>("all");
  const [now, setNow] = useState(() => Date.now());

  const view = activeView ?? localView;
  const device = previewDevice ?? localDevice;
  const pendingAction = busyAction ?? internalAction;
  const selectedFile = selectedPath ? project.files[selectedPath] : undefined;
  const unsaved = Boolean(selectedFile && draftContent !== selectedFile.content);
  const previewUrl = sandboxState?.status === "running"
    ? verifiedProjectV2PreviewUrl(project.preview)
    : null;
  const fileTree = useMemo(
    () => buildProjectV2FileTree(Object.keys(project.files)),
    [project.files],
  );
  const filteredTree = useMemo(
    () => filterProjectV2FileTree(fileTree, deferredSearch),
    [deferredSearch, fileTree],
  );
  const comparisonFile = selectedPath ? comparisonFiles?.[selectedPath] : undefined;
  const diffLines = useMemo(
    () => comparisonFile ? createProjectV2LineDiff(comparisonFile.content, draftContent) : [],
    [comparisonFile, draftContent],
  );
  const visibleLogs = useMemo(
    () => logFilter === "all" ? logEntries : logEntries.filter((entry) => entry.stream === logFilter),
    [logEntries, logFilter],
  );
  const latestRuns = useMemo(
    () => [...project.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 8),
    [project.runs],
  );
  const projectDataIntegration = useMemo(
    () => project.integrations.find((integration) => integration.kind === "project-data"),
    [project.integrations],
  );
  const dataDefinitionFiles = useMemo(
    () => Object.values(project.files).filter((file) =>
      file.role === "config"
      || file.role === "integration"
      || /(?:schema|data|project)\.(?:json|ts|tsx)$/i.test(file.path),
    ),
    [project.files],
  );

  useEffect(() => {
    const active = sandboxState?.status === "running" || sandboxState?.status === "creating";
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [sandboxState?.status]);

  const setView = useCallback((next: ProjectV2WorkspaceView) => {
    setLocalView(next);
    onActiveViewChange?.(next);
  }, [onActiveViewChange]);

  const setDevice = useCallback((next: ProjectV2PreviewDevice) => {
    setLocalDevice(next);
    onPreviewDeviceChange?.(next);
  }, [onPreviewDeviceChange]);

  const runAction = useCallback(async (
    action: ProjectV2WorkspaceAction,
    operation: (() => void | Promise<void>) | undefined,
  ) => {
    if (!operation || pendingAction) return;
    setInternalAction(action);
    try {
      await operation();
    } catch (error) {
      onOperationError?.(error, action);
    } finally {
      setInternalAction(null);
    }
  }, [onOperationError, pendingAction]);

  function toggleDirectory(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function openFileAction(action: "create" | "rename" | "delete") {
    setFileAction(action);
    setFileActionPath(action === "rename" ? selectedPath ?? "" : "");
  }

  async function submitFileAction() {
    const path = fileActionPath.trim();
    if (fileAction === "create" && path) {
      await runAction(`create:${path}`, () => onCreateFile?.(path));
    } else if (fileAction === "rename" && selectedPath && path && path !== selectedPath) {
      await runAction(`rename:${selectedPath}`, () => onRenameFile?.(selectedPath, path));
    } else if (fileAction === "delete" && selectedPath) {
      await runAction(`delete:${selectedPath}`, () => onDeleteFile?.(selectedPath));
    } else {
      return;
    }
    setFileAction(null);
    setFileActionPath("");
  }

  return (
    <section
      aria-label="Project V2 workspace"
      className={`${styles.workspace} ${className ?? ""}`}
      data-read-only={readOnly ? "true" : "false"}
      data-testid="project-v2-workspace"
    >
      <header className={styles.workspaceHeader}>
        <div className={styles.projectIdentity}>
          <span className={styles.projectMark}><Braces aria-hidden="true" /></span>
          <div>
            <strong>{project.manifest.name}</strong>
            <span>Revision {project.revision} · {project.manifest.framework.name} · Node {project.manifest.runtime.version}</span>
          </div>
        </div>
        <div className={styles.headerStatus}>
          {unsaved ? <StatusBadge label="Unsaved changes" status="pending" /> : <StatusBadge label="Saved" status="ready" />}
          {readOnly ? <StatusBadge label="Read-only" status="stopped" /> : null}
        </div>
      </header>

      <nav aria-label="Project workspace sections" className={styles.workspaceNav}>
        {workspaceViews.map(({ id, label, icon: Icon }) => (
          <Button
            aria-current={view === id ? "page" : undefined}
            className={view === id ? styles.navButtonActive : styles.navButton}
            key={id}
            onClick={() => setView(id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </nav>

      {readOnly ? (
        <div className={styles.readOnlyNotice} role="status">
          <ShieldAlert aria-hidden="true" />
          Source is available for inspection. Editing and external actions are disabled in this fallback.
        </div>
      ) : null}

      <div className={styles.workspaceBody}>
        {view === "files" ? (
          <div className={styles.filesLayout}>
            <aside aria-label="Project files" className={styles.filePanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span>Source</span>
                  <strong>{Object.keys(project.files).length} files</strong>
                </div>
                <div className={styles.iconActions}>
                  <Button
                    aria-label="Create file"
                    disabled={readOnly || !onCreateFile || Boolean(pendingAction)}
                    onClick={() => openFileAction("create")}
                    size="icon-sm"
                    title="Create file"
                    type="button"
                    variant="ghost"
                  ><FilePlus2 aria-hidden="true" /></Button>
                  <Button
                    aria-label="Rename selected file"
                    disabled={readOnly || !selectedFile || !onRenameFile || Boolean(pendingAction)}
                    onClick={() => openFileAction("rename")}
                    size="icon-sm"
                    title="Rename selected file"
                    type="button"
                    variant="ghost"
                  ><Pencil aria-hidden="true" /></Button>
                  <Button
                    aria-label="Delete selected file"
                    disabled={readOnly || !selectedFile || !onDeleteFile || Boolean(pendingAction)}
                    onClick={() => openFileAction("delete")}
                    size="icon-sm"
                    title="Delete selected file"
                    type="button"
                    variant="ghost"
                  ><Trash2 aria-hidden="true" /></Button>
                </div>
              </div>
              <label className={styles.searchField}>
                <Search aria-hidden="true" />
                <Input
                  aria-label="Search project file paths"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search file paths"
                  type="search"
                  value={searchQuery}
                />
              </label>
              {fileAction ? (
                <div className={styles.fileActionForm}>
                  <div>
                    <strong>{fileAction === "create" ? "Create file" : fileAction === "rename" ? "Rename file" : "Delete file"}</strong>
                    <Button aria-label="Cancel file action" onClick={() => setFileAction(null)} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" /></Button>
                  </div>
                  {fileAction === "delete" ? (
                    <p>Delete <code>{selectedPath}</code>? The parent must validate protected files and checkpoint policy.</p>
                  ) : (
                    <Input
                      aria-label={fileAction === "create" ? "New file path" : "Renamed file path"}
                      autoFocus
                      onChange={(event) => setFileActionPath(event.target.value)}
                      placeholder="components/example.tsx"
                      value={fileActionPath}
                    />
                  )}
                  <Button
                    disabled={Boolean(pendingAction) || (fileAction !== "delete" && !fileActionPath.trim())}
                    onClick={() => void submitFileAction()}
                    size="sm"
                    type="button"
                    variant={fileAction === "delete" ? "destructive" : "default"}
                  >
                    {pendingAction ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
                    {fileAction === "delete" ? "Confirm delete" : "Apply"}
                  </Button>
                </div>
              ) : null}
              <div className={styles.fileTreeScroll}>
                {filteredTree.length ? (
                  <FileTreeBranch
                    expanded={expanded}
                    nodes={filteredTree}
                    onSelect={onSelectFile}
                    onToggle={toggleDirectory}
                    searchActive={Boolean(deferredSearch.trim())}
                    selectedPath={selectedPath}
                  />
                ) : (
                  <EmptyState icon={Search} title="No matching files">Try another path or clear the search.</EmptyState>
                )}
              </div>
            </aside>

            <div className={styles.editorPanel}>
              {selectedFile ? (
                <>
                  <div className={styles.editorToolbar}>
                    <div className={styles.editorFileMeta}>
                      <strong title={selectedFile.path}>{selectedFile.path}</strong>
                      <span>{selectedFile.language} · {selectedFile.provenance} · {selectedFile.bytes.toLocaleString()} bytes</span>
                    </div>
                    <div className={styles.toolbarActions}>
                      <div className={styles.modeSwitch} aria-label="Source view" role="group">
                        <Button aria-pressed={sourceMode === "editor"} onClick={() => setSourceMode("editor")} size="sm" type="button" variant="ghost"><Code2 aria-hidden="true" />Editor</Button>
                        <Button aria-pressed={sourceMode === "diff"} disabled={!comparisonFile} onClick={() => setSourceMode("diff")} size="sm" type="button" variant="ghost"><FileDiff aria-hidden="true" />Diff</Button>
                      </div>
                      <Button
                        disabled={readOnly || !unsaved || Boolean(pendingAction)}
                        onClick={() => onDraftChange(selectedFile.content)}
                        size="sm"
                        type="button"
                        variant="outline"
                      ><RotateCcw aria-hidden="true" />Discard draft</Button>
                      <Button
                        disabled={readOnly || !comparisonFile || !onRevertFile || Boolean(pendingAction)}
                        onClick={() => void runAction(`revert:${selectedFile.path}`, () => onRevertFile?.(selectedFile.path))}
                        size="sm"
                        type="button"
                        variant="outline"
                      ><ArchiveRestore aria-hidden="true" />Revert file</Button>
                      <Button
                        disabled={readOnly || !selectedFile.editable || !unsaved || !onSaveFile || Boolean(pendingAction)}
                        onClick={() => void runAction(`save:${selectedFile.path}`, () => onSaveFile?.(selectedFile.path, draftContent))}
                        size="sm"
                        type="button"
                      >
                        {pendingAction === `save:${selectedFile.path}` ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Save aria-hidden="true" />}
                        Save
                      </Button>
                    </div>
                  </div>
                  {sourceMode === "diff" && comparisonFile ? (
                    <div className={styles.diffPanel}>
                      <header><strong>{comparisonLabel}</strong><span>− old · + current draft</span></header>
                      <div className={styles.diffCode} role="region" aria-label={`Diff for ${selectedFile.path}`}>
                        {diffLines.map((line, index) => (
                          <div className={styles[`diff_${line.kind}`]} key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}>
                            <span>{line.oldLine ?? ""}</span>
                            <span>{line.newLine ?? ""}</span>
                            <b>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</b>
                            <code>{line.content || " "}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.codeEditorWrap}>
                      <Suspense fallback={<div className={styles.editorLoading}><LoaderCircle aria-hidden="true" className={styles.spin} />Loading code editor…</div>}>
                        <LazyCodeEditor
                          ariaLabel={`Edit ${selectedFile.path}`}
                          language={selectedFile.language}
                          onChange={onDraftChange}
                          readOnly={readOnly || !selectedFile.editable}
                          value={draftContent}
                        />
                      </Suspense>
                    </div>
                  )}
                  <footer className={styles.editorFooter}>
                    <span>{unsaved ? "Draft differs from revision" : "Matches saved revision"}</span>
                    <span>SHA-256 {selectedFile.hash.slice(0, 12)}</span>
                  </footer>
                </>
              ) : (
                <EmptyState icon={Files} title="Select a source file">Choose a file from the tree to inspect or edit its canonical content.</EmptyState>
              )}
            </div>
          </div>
        ) : null}

        {view === "preview" ? (
          <div className={styles.previewView}>
            <div className={styles.previewToolbar}>
              <div className={styles.deviceSwitch} aria-label="Preview device" role="group">
                {([
                  ["desktop", Laptop, "Desktop"],
                  ["tablet", Tablet, "Tablet"],
                  ["mobile", Smartphone, "Mobile"],
                ] as const).map(([id, Icon, label]) => (
                  <Button aria-pressed={device === id} key={id} onClick={() => setDevice(id)} size="sm" type="button" variant="ghost"><Icon aria-hidden="true" />{label}</Button>
                ))}
              </div>
              <div className={styles.previewActions}>
                <Button disabled={!previewUrl || !onRefreshPreview || Boolean(pendingAction)} onClick={() => void runAction("refresh-preview", onRefreshPreview)} size="sm" type="button" variant="outline"><RefreshCw aria-hidden="true" />Refresh</Button>
                <Button
                  disabled={!onStopSandbox || !["creating", "running"].includes(sandboxState?.status ?? "") || Boolean(pendingAction)}
                  onClick={() => void runAction("stop-sandbox", onStopSandbox)}
                  size="sm"
                  type="button"
                  variant="outline"
                ><CircleStop aria-hidden="true" />Stop sandbox</Button>
              </div>
            </div>
            <div className={styles.sandboxStrip}>
              <div><Server aria-hidden="true" /><span><strong>Sandbox</strong>{sandboxState?.sandboxId ?? "No sandbox receipt"}</span></div>
              <StatusBadge status={sandboxState?.status ?? "unavailable"} />
              <div><Clock3 aria-hidden="true" /><span><strong>Active duration</strong>{formatProjectV2Duration(sandboxState?.startedAt, now)}</span></div>
              <div><Clock3 aria-hidden="true" /><span><strong>Idle deadline</strong>{displayTime(sandboxState?.idleDeadlineAt)}</span></div>
            </div>
            {sandboxState?.message ? <p className={styles.providerMessage}>{sandboxState.message}</p> : null}
            <div className={`${styles.previewFrameShell} ${styles[`device_${device}`]}`}>
              {previewUrl ? (
                <iframe
                  allow="clipboard-read; clipboard-write"
                  referrerPolicy="no-referrer"
                  sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                  src={previewUrl}
                  title={`${project.manifest.name} Sandbox preview`}
                />
              ) : (
                <EmptyState icon={Monitor} title="Live preview unavailable">
                  A verified ready Sandbox URL has not been supplied. Start the dev task and wait for provider evidence.
                </EmptyState>
              )}
            </div>
            <footer className={styles.previewFooter}>
              <span>{previewUrl ?? "No provider URL"}</span>
              <span>Revision {project.preview?.projectRevision ?? project.revision}</span>
            </footer>
          </div>
        ) : null}

        {view === "agent" ? <ProjectV2AgentIntelligence trace={agentTrace} /> : null}

        {view === "checks" ? (
          <div className={styles.surfaceGrid}>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Release checks</span><strong>Verified task results only</strong></div><ListChecks aria-hidden="true" /></div>
              {checks.length ? (
                <div className={styles.checkList}>
                  {checks.map((check) => (
                    <article className={styles.checkRow} key={check.id}>
                      <span className={`${styles.checkIcon} ${statusClass(check.status)}`}>
                        {check.status === "passed" ? <Check aria-hidden="true" /> : check.status === "running" ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : check.status === "failed" ? <X aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                      </span>
                      <div><strong>{check.label}</strong><span>{check.message ?? "No result detail was supplied."}</span></div>
                      <div className={styles.checkAside}><StatusBadge status={check.status} /><span>{displayDuration(check.durationMs)}</span></div>
                      {check.taskId && onRunTask ? (
                        <Button disabled={Boolean(pendingAction)} onClick={() => void runAction(`task:${check.taskId}`, () => onRunTask(check.taskId!))} size="sm" type="button" variant="outline"><Play aria-hidden="true" />Run</Button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : <EmptyState icon={ListChecks} title="No check results">Run typecheck, lint, tests, build, and browser smoke inside Sandbox to populate this view.</EmptyState>}
            </section>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Browser diagnostics</span><strong>Page, console, and network errors</strong></div><TriangleAlert aria-hidden="true" /></div>
              {browserErrors.length ? (
                <div className={styles.errorList}>{browserErrors.map((error) => (
                  <article className={styles.errorRow} key={error.id}>
                    <TriangleAlert aria-hidden="true" />
                    <div><strong>{error.kind}</strong><p>{error.message}</p><span>{displayTime(error.timestamp)}{error.url ? ` · ${error.url}` : ""}</span></div>
                  </article>
                ))}</div>
              ) : <EmptyState icon={TriangleAlert} title="No browser diagnostics received">This is not a passing claim. Complete a browser smoke run to establish evidence.</EmptyState>}
            </section>
            <section className={`${styles.surfaceCard} ${styles.wideCard}`}>
              <div className={styles.surfaceHeading}><div><span>Sandbox runs</span><strong>Recent provider-backed task executions</strong></div><Server aria-hidden="true" /></div>
              {latestRuns.length ? <div className={styles.runList}>{latestRuns.map((run) => <RunStatus key={run.id} run={run} />)}</div> : <EmptyState icon={Server} title="No Sandbox runs">Commands appear here only after a runtime adapter records them.</EmptyState>}
            </section>
          </div>
        ) : null}

        {view === "logs" ? (
          <div className={styles.logsView}>
            <div className={styles.logsToolbar}>
              <div><span>Sandbox output</span><strong>{logEntries.length} real entries · {project.logs.length} metadata receipts</strong></div>
              <div className={styles.logFilters} aria-label="Log stream filter" role="group">
                {(["all", "stdout", "stderr", "browser", "audit"] as const).map((stream) => (
                  <Button aria-pressed={logFilter === stream} key={stream} onClick={() => setLogFilter(stream)} size="sm" type="button" variant="ghost">{stream}</Button>
                ))}
              </div>
            </div>
            {visibleLogs.length ? (
              <div className={styles.logEntries}>
                {visibleLogs.map((entry) => (
                  <article className={styles.logEntry} key={entry.id}>
                    <header><span>{displayTime(entry.timestamp)}</span><StatusBadge status={entry.stream === "stderr" ? "failed" : "stopped"} label={entry.stream} /><span>Run {entry.runId}</span>{entry.truncated ? <Badge variant="outline">Output truncated</Badge> : null}</header>
                    <pre>{entry.text}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={Logs} title="No Sandbox output received">
                Log metadata alone is not terminal output. Start a task or select another stream after real stdout, stderr, audit, or browser entries arrive.
              </EmptyState>
            )}
          </div>
        ) : null}

        {view === "integrations" ? (
          <div className={styles.surfaceGrid}>
            <section className={`${styles.surfaceCard} ${styles.wideCard}`}>
              <div className={styles.surfaceHeading}><div><span>Integrations</span><strong>Capability and provider-evidence state</strong></div><PlugZap aria-hidden="true" /></div>
              {project.integrations.length ? <div className={styles.integrationGrid}>{project.integrations.map((integration) => <IntegrationCard integration={integration} key={integration.id} />)}</div> : <EmptyState icon={PlugZap} title="No integrations declared">The project manifest has no integration capabilities.</EmptyState>}
            </section>
            <section className={`${styles.surfaceCard} ${styles.wideCard}`}>
              <div className={styles.surfaceHeading}><div><span>Environment schema</span><strong>Names and scopes only — values are never rendered</strong></div><Settings2 aria-hidden="true" /></div>
              {project.environment.length ? <div className={styles.environmentTable} aria-label="Required environment variables">{project.environment.map((variable) => (
                <div className={styles.environmentRow} key={variable.name}>
                  <code>{variable.name}</code><span>{variable.description}</span><Badge variant="outline">{variable.scope}</Badge><span>{variable.required ? "Required" : "Optional"}{variable.secret ? " · secret" : ""}</span>
                </div>
              ))}</div> : <EmptyState icon={Settings2} title="No environment variables required">This project declares no runtime, build, or deployment variables.</EmptyState>}
            </section>
          </div>
        ) : null}

        {view === "data" ? (
          <div className={styles.surfaceGrid}>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Project data</span><strong>Declared namespace and capability only</strong></div><Database aria-hidden="true" /></div>
              <div className={styles.manifestList}>
                <div><span>Namespace</span><code>{project.id}</code></div>
                <div><span>Capability</span><StatusBadge status={projectDataIntegration?.status ?? "unconfigured"} /></div>
                <div><span>Proxy</span><code>{projectDataIntegration?.proxyPath ?? "No project-data proxy declared"}</code></div>
                <div><span>Evidence</span><strong>{projectDataIntegration?.providerEvidenceRequired ? "Runtime receipt required" : "Manifest declaration"}</strong></div>
              </div>
              <p className={styles.truthfulNote}>
                No collection, event, or record count is claimed here. Generated apps use the scoped project-data capability when configured and must label browser-local demo persistence honestly.
              </p>
              {projectDataIntegration?.capabilities.length ? <div className={styles.capabilityList}>{projectDataIntegration.capabilities.map((capability) => <Badge key={capability} variant="outline">{capability}</Badge>)}</div> : null}
            </section>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Data definitions</span><strong>Canonical source files in this revision</strong></div><Files aria-hidden="true" /></div>
              {dataDefinitionFiles.length ? <div className={styles.definitionList}>{dataDefinitionFiles.map((file) => (
                <article key={file.path}>
                  <div><strong>{file.path}</strong><span>{file.role} · {file.provenance}</span></div>
                  <code>{file.hash.slice(0, 12)}</code>
                  <Button onClick={() => { onSelectFile(file.path); setView("files"); }} size="sm" type="button" variant="ghost">Open</Button>
                </article>
              ))}</div> : <EmptyState icon={Files} title="No data definitions">Add a schema or configuration file before claiming a data model.</EmptyState>}
            </section>
          </div>
        ) : null}

        {view === "logic" ? (
          <div className={styles.surfaceGrid}>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Tasks and scripts</span><strong>Executable manifest declarations</strong></div><Braces aria-hidden="true" /></div>
              {project.tasks.length ? <div className={styles.definitionList}>{project.tasks.map((task) => (
                <article key={task.id}>
                  <div><strong>{task.label}</strong><span>{task.kind} · timeout {displayDuration(task.timeoutMs)}</span></div>
                  <code>{task.command} {task.args.join(" ")}</code>
                  <StatusBadge label={task.approvalRequired ? "Approval required" : "Declared"} status={task.approvalRequired ? "pending" : "stopped"} />
                </article>
              ))}</div> : <EmptyState icon={Braces} title="No tasks declared">Add bounded package scripts before presenting runnable logic.</EmptyState>}
            </section>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Permissions</span><strong>External and destructive action policy</strong></div><ShieldAlert aria-hidden="true" /></div>
              {project.permissions.length ? <div className={styles.definitionList}>{project.permissions.map((permission) => (
                <article key={permission.id}>
                  <div><strong>{permission.capability}</strong><span>{permission.external ? "external" : "project-local"}{permission.destructive ? " · destructive" : ""}</span></div>
                  <StatusBadge status={permission.effect} />
                </article>
              ))}</div> : <EmptyState icon={ShieldAlert} title="No permissions declared">The project does not expose an action permission manifest.</EmptyState>}
            </section>
            <section className={`${styles.surfaceCard} ${styles.wideCard}`}>
              <div className={styles.surfaceHeading}><div><span>Entrypoints</span><strong>Framework routing and package scripts</strong></div><GitBranch aria-hidden="true" /></div>
              <div className={styles.manifestColumns}>
                <div><strong>Entrypoints</strong>{project.manifest.entrypoints.map((path) => <code key={path}>{path}</code>)}</div>
                <div><strong>Scripts</strong>{Object.entries(project.manifest.scripts).map(([name, command]) => <code key={name}>{name}: {command}</code>)}</div>
              </div>
            </section>
          </div>
        ) : null}

        {view === "history" ? (
          <div className={styles.historyView}>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Checkpoints</span><strong>Full canonical project snapshots</strong></div><History aria-hidden="true" /></div>
              {project.checkpoints.length ? <div className={styles.checkpointList}>{[...project.checkpoints].reverse().map((checkpoint) => (
                <article className={styles.checkpointRow} key={checkpoint.id}>
                  <span className={styles.checkpointMark}><History aria-hidden="true" /></span>
                  <div><strong>{checkpoint.label}</strong><span>{checkpoint.source} · {displayTime(checkpoint.createdAt)}</span><code>{checkpoint.snapshotHash.slice(0, 16)}</code></div>
                  <Button
                    disabled={readOnly || !onRestoreCheckpoint || Boolean(pendingAction)}
                    onClick={() => void runAction(`checkpoint:${checkpoint.id}`, () => onRestoreCheckpoint?.(checkpoint.id))}
                    size="sm"
                    type="button"
                    variant="outline"
                  ><ArchiveRestore aria-hidden="true" />Restore</Button>
                </article>
              ))}</div> : <EmptyState icon={History} title="No checkpoints yet">Create a checkpoint after a verified build or meaningful source revision.</EmptyState>}
            </section>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Comparison</span><strong>{comparisonFiles ? comparisonLabel : "No comparison selected"}</strong></div><FileDiff aria-hidden="true" /></div>
              {comparisonFiles ? (
                <div className={styles.historySummary}>
                  <p>Select a file in Files and open Diff to inspect source-level changes against this snapshot.</p>
                  <dl><div><dt>Snapshot files</dt><dd>{Object.keys(comparisonFiles).length}</dd></div><div><dt>Current files</dt><dd>{Object.keys(project.files).length}</dd></div></dl>
                  <Button onClick={() => setView("files")} size="sm" type="button" variant="outline"><FileDiff aria-hidden="true" />Open file diff</Button>
                </div>
              ) : <EmptyState icon={FileDiff} title="Diff unavailable">Supply checkpoint files through comparisonFiles to enable a real source comparison.</EmptyState>}
            </section>
          </div>
        ) : null}

        {view === "deploy" ? (
          <div className={styles.deployView}>
            <section className={styles.releaseCard}>
              <div className={styles.surfaceHeading}><div><span>Release readiness</span><strong>Evidence supplied by release gates</strong></div><CloudUpload aria-hidden="true" /></div>
              {releaseReadiness ? (
                <div className={styles.readinessBody}>
                  <StatusBadge status={releaseReadiness.status} />
                  {releaseReadiness.evidence.length ? <ul>{releaseReadiness.evidence.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul> : null}
                  {releaseReadiness.blockers.length ? <ul className={styles.blockerList}>{releaseReadiness.blockers.map((item) => <li key={item}><TriangleAlert aria-hidden="true" />{item}</li>)}</ul> : null}
                </div>
              ) : <EmptyState icon={ShieldAlert} title="Release readiness unknown">No release-gate evidence was supplied. Deployment remains unavailable.</EmptyState>}
              <Button
                disabled={readOnly || releaseReadiness?.status !== "ready" || !onRequestDeployment || Boolean(pendingAction)}
                onClick={() => void runAction("request-deployment", onRequestDeployment)}
                type="button"
              ><CloudUpload aria-hidden="true" />Review & request deployment</Button>
              <p className={styles.approvalNote}>Deployment is an external action and requires explicit approval in the parent flow.</p>
            </section>
            <section className={styles.surfaceCard}>
              <div className={styles.surfaceHeading}><div><span>Current deployment</span><strong>Confirmed provider state</strong></div><Server aria-hidden="true" /></div>
              {project.deployment && project.deployment.status !== "none" ? <DeploymentCard deployment={{ ...project.deployment, id: project.deployment.deploymentId ?? "current", projectRevision: project.revision }} /> : <EmptyState icon={CloudUpload} title="Not deployed">No Vercel or legacy publish receipt is attached to this project.</EmptyState>}
            </section>
            <section className={`${styles.surfaceCard} ${styles.deploymentHistory}`}>
              <div className={styles.surfaceHeading}><div><span>Deployment history</span><strong>Provider receipts and rollback targets</strong></div><History aria-hidden="true" /></div>
              {deploymentHistory.length ? <div className={styles.deploymentList}>{deploymentHistory.map((deployment) => (
                <div className={styles.deploymentHistoryRow} key={deployment.id}>
                  <DeploymentCard deployment={deployment} />
                  <Button
                    disabled={readOnly || deployment.status !== "ready" || !onRequestRollback || Boolean(pendingAction)}
                    onClick={() => void runAction(`rollback:${deployment.id}`, () => onRequestRollback?.(deployment.id))}
                    size="sm"
                    type="button"
                    variant="outline"
                  ><RotateCcw aria-hidden="true" />Request rollback</Button>
                </div>
              ))}</div> : <EmptyState icon={History} title="No deployment history">Confirmed deployments will appear here after the provider returns receipts.</EmptyState>}
            </section>
            <GitHubIntegrationPanel
              onImportFiles={onImportGitHubFiles}
              onOperationError={onOperationError}
              project={project}
              readOnly={readOnly}
              releaseReadiness={releaseReadiness}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function IntegrationCard({ integration }: { integration: ProjectIntegrationManifestV2 }) {
  const explanation = integration.status === "available"
    ? integration.providerEvidenceRequired
      ? "Capability is available; live use still requires provider evidence."
      : "Capability is available for this project."
    : integration.status === "demo"
      ? "Demo mode is active and must not be presented as live provider data."
      : integration.status === "setup-required"
        ? "Complete the documented external setup before claiming this integration."
        : "No connection or capability configuration is present.";
  return (
    <article className={styles.integrationCard}>
      <header><span><PlugZap aria-hidden="true" /></span><StatusBadge status={integration.status} /></header>
      <strong>{integration.kind}</strong>
      <p>{explanation}</p>
      <div>{integration.capabilities.map((capability) => <Badge key={capability} variant="outline">{capability}</Badge>)}</div>
      {integration.proxyPath ? <code>{integration.proxyPath}</code> : <span className={styles.metaText}>No proxy route declared</span>}
    </article>
  );
}

function DeploymentCard({ deployment }: { deployment: ProjectV2DeploymentReceiptView }) {
  const url = deployment.status === "ready" ? safeExternalUrl(deployment.url ?? deployment.legacyPublishedUrl) : null;
  return (
    <article className={styles.deploymentCard}>
      <div><strong>{deployment.provider}</strong><span>Revision {deployment.projectRevision} · {displayTime(deployment.finishedAt ?? deployment.createdAt)}</span></div>
      <StatusBadge status={deployment.status} />
      {deployment.deploymentId ? <code>{deployment.deploymentId}</code> : <span className={styles.metaText}>No deployment id</span>}
      {url ? <a href={url} rel="noreferrer" target="_blank">Open confirmed deployment</a> : <span className={styles.metaText}>{deployment.error ?? "No confirmed ready URL"}</span>}
    </article>
  );
}
