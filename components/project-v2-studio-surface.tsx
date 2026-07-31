"use client";

import {
  CheckCircle2,
  CircleStop,
  CloudCog,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ProjectV2Workspace,
  type ProjectV2BrowserErrorView,
  type ProjectV2CheckView,
  type ProjectV2DeploymentReceiptView,
  type ProjectV2LogEntryView,
  type ProjectV2ReleaseReadiness,
  type ProjectV2SandboxViewState,
  type ProjectV2WorkspaceAction,
  type ProjectV2WorkspaceView,
} from "@/components/project-v2-workspace";
import {
  clearProjectV2Draft,
  resolveProjectV2DraftContent,
  updateProjectV2DraftMap,
  type ProjectV2DraftMap,
} from "@/components/project-v2-workspace-model";
import { Button } from "@/components/ui/button";
import { applyProjectV2FileOperations } from "@/lib/project-v2-files";
import {
  loadProjectV2FromCloud,
  ProjectV2SyncError,
  saveProjectV2ToCloud,
} from "@/lib/project-v2-sync-client";
import type { ProjectProvider } from "@/lib/project-types";
import type { ProjectV2 } from "@/lib/project-v2-types";
import type {
  BuilderAgentResult,
  BuilderReleaseCheck,
  BuilderReleaseGateResult,
  BuilderProviderSelection,
} from "@/lib/builder-agent/types";
import type {
  RuntimeCommandResult,
  RuntimeState,
} from "@/lib/project-runtime-adapter";
import type { AgentRunTrace } from "@/lib/agent/evals/types";

import styles from "./project-v2-studio-surface.module.css";

const AUTO_BUILD_KEY = "drops-studio:v2-auto-build";

interface BuilderApiPayload {
  result?: BuilderAgentResult;
  intelligence?: {
    trace?: AgentRunTrace;
    tracePersistence?: {
      status: "persisted" | "unavailable" | "disabled";
      reason?: string;
    };
  };
  code?: string;
  error?: string;
}

interface RuntimeApiPayload {
  action?: string;
  result?: unknown;
  code?: string;
  error?: string;
}

interface DeploymentApiPayload {
  deployment?: {
    id?: string;
    url?: string | null;
    readyState?: string;
    createdAt?: string;
    readyAt?: string | null;
  };
  logs?: Array<{ type?: string; text?: string; createdAt?: string }>;
  confirmedReady?: boolean;
  code?: string;
  error?: string;
}

interface ProjectV2SnapshotReceipt {
  project: ProjectV2;
  storageRevision: number | null;
  persisted: boolean;
}

type ProjectV2StorageMode = "checking" | "cloud" | "local";

export interface ProjectV2StudioSurfaceProps {
  project: ProjectV2;
  provider: ProjectProvider;
  onProjectChange: (project: ProjectV2, storageRevision?: number) => void;
  onNotify?: (message: string) => void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requestHeaders(provider: ProjectProvider): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (provider === "openrouter") {
    const key = window.sessionStorage.getItem("drops-studio:openrouter");
    if (key) headers["x-openrouter-key"] = key;
  } else if (["openai", "anthropic", "kimi", "custom"].includes(provider)) {
    const key = window.sessionStorage.getItem(`drops-studio:${provider}`);
    if (key) headers["x-provider-key"] = key;
  }
  return headers;
}

function providerSelection(provider: ProjectProvider): BuilderProviderSelection {
  const model = window.sessionStorage.getItem(
    provider === "custom"
      ? "drops-studio:custom-model"
      : `drops-studio:${provider}:model`,
  ) ?? undefined;
  return {
    provider,
    ...(model ? { model } : {}),
    ...(provider === "custom"
      ? {
          baseUrl:
            window.sessionStorage.getItem("drops-studio:custom-endpoint") ??
            undefined,
        }
      : {}),
  };
}

function duration(command: RuntimeCommandResult | undefined): number | undefined {
  if (!command?.finishedAt) return undefined;
  const start = Date.parse(command.startedAt);
  const finish = Date.parse(command.finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish)
    ? Math.max(0, finish - start)
    : undefined;
}

function checkKind(
  name: BuilderReleaseCheck["name"],
): ProjectV2CheckView["kind"] {
  if (name === "tests") return "test";
  if (name === "browser") return "browser";
  if (name === "typecheck") return "typecheck";
  if (name === "lint") return "lint";
  return "build";
}

function checkViews(gate: BuilderReleaseGateResult): ProjectV2CheckView[] {
  return gate.checks.map((check, index) => ({
    id: `${check.name}-${check.command?.commandId ?? index}`,
    label:
      check.name === "tests"
        ? "Tests"
        : check.name.charAt(0).toUpperCase() + check.name.slice(1),
    kind: checkKind(check.name),
    status: check.status === "skipped" ? "unavailable" : check.status,
    message: check.summary,
    durationMs: duration(check.command),
    runId: check.command?.runId,
    taskId:
      check.name === "tests"
        ? "test"
        : check.name === "preview"
          ? "dev"
          : check.name,
  }));
}

function gateLogs(gate: BuilderReleaseGateResult): ProjectV2LogEntryView[] {
  const timestamp = new Date().toISOString();
  return gate.checks.flatMap((check) => {
    const command = check.command;
    if (!command) return [];
    const entries: ProjectV2LogEntryView[] = [];
    if (command.stdout) {
      entries.push({
        id: `${command.commandId}:stdout`,
        runId: command.runId,
        stream: "stdout",
        timestamp: command.finishedAt ?? timestamp,
        text: command.stdout,
        truncated: command.outputTruncated,
      });
    }
    if (command.stderr) {
      entries.push({
        id: `${command.commandId}:stderr`,
        runId: command.runId,
        stream: "stderr",
        timestamp: command.finishedAt ?? timestamp,
        text: command.stderr,
        truncated: command.outputTruncated,
      });
    }
    return entries;
  });
}

function browserErrors(gate: BuilderReleaseGateResult): ProjectV2BrowserErrorView[] {
  const timestamp = new Date().toISOString();
  return gate.checks.flatMap((check) => {
    if (!check.browser) return [];
    return [
      ...check.browser.pageErrors.map((entry, index) => ({
        id: `page-${index}-${entry}`,
        kind: "page" as const,
        message: entry,
        timestamp,
      })),
      ...check.browser.consoleErrors.map((entry, index) => ({
        id: `console-${index}-${entry}`,
        kind: "console" as const,
        message: entry,
        timestamp,
      })),
      ...check.browser.networkErrors.map((entry, index) => ({
        id: `network-${index}-${entry}`,
        kind: "network" as const,
        message: entry,
        timestamp,
      })),
    ];
  });
}

function readiness(gate: BuilderReleaseGateResult): ProjectV2ReleaseReadiness {
  return {
    status: gate.ok ? "ready" : "blocked",
    evidence: gate.checks
      .filter((check) => check.status === "passed")
      .map((check) => `${check.name}: ${check.summary}`),
    blockers: [...gate.blockingErrors],
  };
}

function sandboxView(
  state: RuntimeState | null,
  fallbackError?: string,
): ProjectV2SandboxViewState {
  if (!state || state.status === "unavailable") {
    return {
      status: "unavailable",
      message:
        fallbackError ??
        "No active Vercel Sandbox receipt is available for this project.",
    };
  }
  return {
    status: state.status,
    sandboxId: state.sandboxName ?? undefined,
    startedAt: state.createdAt ?? undefined,
    idleDeadlineAt: state.expiresAt ?? undefined,
    message:
      state.status === "running"
        ? `${state.vcpus ?? 2} vCPU · ${state.memoryMb ?? 4_096} MB · Node 24`
        : undefined,
  };
}

function unverifiedSandboxView(project: ProjectV2): ProjectV2SandboxViewState {
  if (!project.preview?.sandboxId) return { status: "unavailable" };
  return {
    status: "unavailable",
    sandboxId: project.preview.sandboxId,
    startedAt: project.preview.startedAt,
    message: "Checking the persisted Sandbox receipt with Vercel…",
  };
}

function supportsLocalProjectFallback(error: unknown): boolean {
  if (error instanceof ProjectV2SyncError) {
    return error.code === "PROJECT_V2_STORAGE_UNAVAILABLE"
      || error.code === "STUDIO_SESSION_REQUIRED"
      || error.status === 401
      || error.status >= 500;
  }
  return error instanceof TypeError;
}

function defaultFile(path: string): string {
  if (path.endsWith(".json")) return "{}\n";
  if (path.endsWith(".css")) return "/* Project styles */\n";
  if (path.endsWith(".md") || path.endsWith(".mdx")) return `# ${path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "Project note"}\n`;
  if (path.endsWith(".tsx")) return "export function Component() {\n  return <section />;\n}\n";
  return "export {};\n";
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

export function ProjectV2StudioSurface({
  project,
  provider,
  onProjectChange,
  onNotify,
}: ProjectV2StudioSurfaceProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    project.files["app/page.tsx"]
      ? "app/page.tsx"
      : project.manifest.entrypoints[0] ?? Object.keys(project.files)[0] ?? null,
  );
  const [drafts, setDrafts] = useState<ProjectV2DraftMap>({});
  const [activeView, setActiveView] =
    useState<ProjectV2WorkspaceView>(project.preview?.status === "ready" ? "preview" : "files");
  const [comparisonFiles, setComparisonFiles] = useState<ProjectV2["files"] | undefined>();
  const [comparisonLabel, setComparisonLabel] = useState("Before latest change");
  const [storageRevision, setStorageRevision] = useState<number | null>(null);
  const [storageMode, setStorageMode] = useState<ProjectV2StorageMode>("checking");
  const [checks, setChecks] = useState<ProjectV2CheckView[]>([]);
  const [logs, setLogs] = useState<ProjectV2LogEntryView[]>([]);
  const [diagnostics, setDiagnostics] = useState<ProjectV2BrowserErrorView[]>([]);
  const [sandbox, setSandbox] = useState<ProjectV2SandboxViewState>(() =>
    unverifiedSandboxView(project),
  );
  const [release, setRelease] = useState<ProjectV2ReleaseReadiness>({
    status: "unknown",
    evidence: [],
    blockers: [],
  });
  const [deployments, setDeployments] =
    useState<ProjectV2DeploymentReceiptView[]>([]);
  const [busy, setBusy] = useState<ProjectV2WorkspaceAction | null>(null);
  const [agentState, setAgentState] = useState<
    "idle" | "running" | "verified" | "fallback" | "blocked"
  >("idle");
  const [agentSummary, setAgentSummary] = useState(
    project.manifest.framework.name === "legacy-html"
      ? "Legacy HTML Runtime Adapter — V1 remains runnable and editable."
      : "Project V2 source is ready for an isolated build.",
  );
  const [agentTrace, setAgentTrace] = useState<AgentRunTrace | null>(null);
  const mounted = useRef(true);
  const autoStarted = useRef(false);
  const draft = resolveProjectV2DraftContent(drafts, selectedPath, project.files);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (selectedPath && project.files[selectedPath]) return;
    const next = project.manifest.entrypoints[0] ?? Object.keys(project.files)[0] ?? null;
    const timer = window.setTimeout(() => {
      setSelectedPath(next);
      if (selectedPath) {
        setDrafts((current) => clearProjectV2Draft(current, selectedPath));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [project.files, project.manifest.entrypoints, selectedPath]);

  const syncSnapshot = useCallback(async (): Promise<ProjectV2SnapshotReceipt> => {
    try {
      const accessResponse = await fetch("/api/access", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const access = await responseJson<{
        access?: {
          authenticated?: boolean;
          projectSync?: boolean;
          account?: { connected?: boolean; projectSync?: boolean };
        };
      }>(accessResponse);
      const cloudAvailable = Boolean(
        accessResponse.ok &&
          (
            access.access?.projectSync
            ?? access.access?.account?.projectSync
          ),
      );
      if (!cloudAvailable) {
        if (mounted.current) {
          setStorageRevision(null);
          setStorageMode("local");
        }
        return { project, storageRevision: null, persisted: false };
      }
      const remote = await loadProjectV2FromCloud(project.id);
      if (remote) {
        if (
          remote.project.revision < project.revision ||
          (remote.project.revision === project.revision &&
            remote.project.contentHash !== project.contentHash)
        ) {
          const saved = await saveProjectV2ToCloud(project, remote.storageRevision);
          if (mounted.current) {
            setStorageRevision(saved.storageRevision);
            setStorageMode("cloud");
          }
          return { ...saved, persisted: true };
        }
        if (mounted.current) {
          setStorageRevision(remote.storageRevision);
          setStorageMode("cloud");
          if (
            remote.project.revision > project.revision ||
            remote.project.contentHash !== project.contentHash ||
            remote.project.updatedAt !== project.updatedAt
          ) {
            onProjectChange(remote.project, remote.storageRevision);
          }
        }
        return { ...remote, persisted: true };
      }
      const created = await saveProjectV2ToCloud(project, 0);
      if (mounted.current) {
        setStorageRevision(created.storageRevision);
        setStorageMode("cloud");
      }
      return { ...created, persisted: true };
    } catch (error) {
      if (!supportsLocalProjectFallback(error)) throw error;
      if (mounted.current) {
        setStorageRevision(null);
        setStorageMode("local");
      }
      return { project, storageRevision: null, persisted: false };
    }
  }, [onProjectChange, project]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncSnapshot().then((snapshot) => {
        if (!mounted.current || snapshot.persisted) return;
        setAgentState("idle");
        setAgentSummary(
          "Browser-local editing is active. Private project storage is unavailable, so Sandbox builds stay disabled.",
        );
      }).catch((error) => {
        if (!mounted.current) return;
        setAgentState("blocked");
        setAgentSummary(message(error, "Project V2 private storage is unavailable."));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [syncSnapshot]);

  const refreshSandboxStatus = useCallback(async (projectId: string) => {
    const response = await fetch("/api/builder/runtime", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ projectId, action: "status" }),
    });
    const payload = await responseJson<RuntimeApiPayload>(response);
    if (!response.ok) throw new Error(payload.error ?? "Sandbox status is unavailable.");
    const state = payload.result as RuntimeState;
    if (mounted.current) setSandbox(sandboxView(state, project.preview?.error));
    return state;
  }, [project.preview?.error]);

  useEffect(() => {
    const preview = project.preview;
    if (!preview?.sandboxId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSandbox({
        status: "unavailable",
        sandboxId: preview.sandboxId,
        startedAt: preview.startedAt,
        message: "Checking the persisted Sandbox receipt with Vercel…",
      });
      void refreshSandboxStatus(project.id).catch((error) => {
        if (cancelled || !mounted.current) return;
        setSandbox({
          status: "unavailable",
          sandboxId: preview.sandboxId,
          startedAt: preview.startedAt,
          message: message(error, "The persisted Sandbox receipt could not be verified."),
        });
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.id, project.preview, refreshSandboxStatus]);

  const absorbBuilderResult = useCallback(async (
    result: BuilderAgentResult,
    before: ProjectV2["files"],
    trace?: AgentRunTrace,
  ) => {
    const remote = await loadProjectV2FromCloud(project.id).catch((error) => {
      if (supportsLocalProjectFallback(error)) return null;
      throw error;
    });
    const next = remote?.project ?? result.project;
    if (mounted.current) {
      setComparisonFiles(structuredClone(before));
      setComparisonLabel(
        result.providerMode === "deterministic-fallback"
          ? "Before Free Auto verification"
          : "Before AI file changes",
      );
      setChecks(checkViews(result.releaseGate));
      setLogs(gateLogs(result.releaseGate));
      setDiagnostics(browserErrors(result.releaseGate));
      setRelease(readiness(result.releaseGate));
      setAgentSummary(result.summary);
      if (trace) setAgentTrace(trace);
      setAgentState(
        result.status === "fallback"
          ? "fallback"
          : result.releaseGate.ok
            ? "verified"
            : "blocked",
      );
      setActiveView(result.releaseGate.ok ? "preview" : "checks");
      if (remote) setStorageRevision(remote.storageRevision);
      onProjectChange(next, remote?.storageRevision);
    }
    await refreshSandboxStatus(next.id).catch(() => undefined);
  }, [onProjectChange, project.id, refreshSandboxStatus]);

  const runBuilder = useCallback(async (
    mode: "build" | "edit" | "repair",
    prompt: string,
  ) => {
    if (busy) return;
    setBusy("task:build");
    setAgentState("running");
    setAgentSummary(
      mode === "edit"
        ? "AI is inspecting and changing the real project files."
        : "Sandbox is installing, checking, building, and starting the preview.",
    );
    setSandbox((current) => ({ ...current, status: "creating" }));
    try {
      const snapshot = await syncSnapshot();
      if (!snapshot.persisted) {
        throw new Error(
          "Sandbox build requires an actor-owned private Project V2 snapshot. Browser-local files remain editable and safe.",
        );
      }
      const response = await fetch("/api/builder/agent", {
        method: "POST",
        credentials: "same-origin",
        headers: requestHeaders(provider),
        body: JSON.stringify({
          projectId: snapshot.project.id,
          prompt,
          mode,
          provider: providerSelection(provider),
        }),
      });
      const payload = await responseJson<BuilderApiPayload>(response);
      if (!payload.result) {
        throw new Error(payload.error ?? "Builder agent returned no verifiable result.");
      }
      await absorbBuilderResult(payload.result, snapshot.project.files, payload.intelligence?.trace);
      if (!response.ok && payload.result.status !== "blocked") {
        throw new Error(payload.error ?? "Builder request failed.");
      }
      onNotify?.(
        payload.result.releaseGate.ok
          ? payload.result.providerMode === "deterministic-fallback"
            ? "Free Auto fallback verified the real Sandbox build."
            : "AI build verified — preview and diff are ready."
          : payload.result.summary,
      );
    } catch (error) {
      const failure = message(error, "Builder execution failed safely.");
      if (mounted.current) {
        setAgentState("blocked");
        setAgentSummary(failure);
        setRelease({ status: "blocked", evidence: [], blockers: [failure] });
        setSandbox((current) => ({ ...current, status: "failed", message: failure }));
        setActiveView("checks");
      }
      onNotify?.(failure);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [absorbBuilderResult, busy, onNotify, provider, syncSnapshot]);

  useEffect(() => {
    if (
      autoStarted.current ||
      storageMode !== "cloud" ||
      project.manifest.framework.name !== "nextjs" ||
      project.preview?.status === "ready"
    ) {
      return;
    }
    const key = `${AUTO_BUILD_KEY}:${project.id}:${project.revision}`;
    if (window.sessionStorage.getItem(key) === "1") return;
    autoStarted.current = true;
    window.sessionStorage.setItem(key, "1");
    const timer = window.setTimeout(() => {
      void runBuilder(
        "build",
        "Build this Project V2 exactly as planned, verify every declared check, start the real preview, exercise its primary interaction, and create a checkpoint only when the release gate passes.",
      );
    }, 50);
    return () => window.clearTimeout(timer);
  }, [project.id, project.manifest.framework.name, project.preview?.status, project.revision, runBuilder, storageMode]);

  const saveSnapshot = useCallback(async (next: ProjectV2) => {
    if (storageMode === "local") {
      if (mounted.current) onProjectChange(next);
      return next;
    }
    const snapshot = storageRevision === null ? await syncSnapshot() : null;
    if (snapshot && !snapshot.persisted) {
      if (mounted.current) onProjectChange(next);
      return next;
    }
    const currentRevision = storageRevision ?? snapshot?.storageRevision;
    if (currentRevision === null || currentRevision === undefined) {
      if (mounted.current) {
        setStorageMode("local");
        onProjectChange(next);
      }
      return next;
    }
    try {
      const saved = await saveProjectV2ToCloud(next, currentRevision);
      if (mounted.current) {
        setStorageRevision(saved.storageRevision);
        setStorageMode("cloud");
        onProjectChange(saved.project, saved.storageRevision);
      }
      return saved.project;
    } catch (error) {
      if (!supportsLocalProjectFallback(error)) throw error;
      if (mounted.current) {
        setStorageRevision(null);
        setStorageMode("local");
        onProjectChange(next);
      }
      return next;
    }
  }, [onProjectChange, storageMode, storageRevision, syncSnapshot]);

  const mutateFiles = useCallback(async (
    operations: Parameters<typeof applyProjectV2FileOperations>[2],
    label: string,
  ) => {
    const before = structuredClone(project.files);
    const next = await applyProjectV2FileOperations(project, project.revision, operations);
    const saved = await saveSnapshot(next);
    setComparisonFiles(before);
    setComparisonLabel(label);
    setRelease({
      status: "unknown",
      evidence: [],
      blockers: ["Source changed after the last verified release gate."],
    });
    setAgentState("idle");
    setAgentSummary(
      storageMode === "local"
        ? "Source revision saved in this browser. Configure private project storage before running a Sandbox build."
        : "Source revision saved. Rebuild to refresh verified preview evidence.",
    );
    return saved;
  }, [project, saveSnapshot, storageMode]);

  async function importGitHubFiles(files: readonly { path: string; content: string }[]) {
    if (!files.length) throw new Error("GitHub returned no importable files.");
    const before = structuredClone(project.files);
    const ordered = [...files].sort((left, right) => {
      if (left.path === "package.json") return -1;
      if (right.path === "package.json") return 1;
      return left.path.localeCompare(right.path);
    });
    let next = project;
    for (let offset = 0; offset < ordered.length; offset += 64) {
      next = await applyProjectV2FileOperations(
        next,
        next.revision,
        ordered.slice(offset, offset + 64).map((file) => ({
          type: "write" as const,
          path: file.path,
          content: file.content,
          provenance: "manual" as const,
        })),
      );
    }
    const saved = await saveSnapshot(next);
    const importedPaths = new Set(ordered.map((file) => file.path));
    setDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([path]) => !importedPaths.has(path)),
    ));
    setComparisonFiles(before);
    setComparisonLabel("Before GitHub import");
    setRelease({
      status: "unknown",
      evidence: [],
      blockers: ["Imported source must pass a new release gate."],
    });
    setAgentState("idle");
    setAgentSummary(
      storageMode === "local"
        ? "GitHub source imported into browser-local storage. Configure private project storage before building."
        : "GitHub source imported into a new revision. Rebuild before preview or publication.",
    );
    if (!selectedPath || !saved.files[selectedPath]) {
      setSelectedPath(saved.manifest.entrypoints[0] ?? Object.keys(saved.files)[0] ?? null);
    }
    setActiveView("files");
    onNotify?.(`Imported ${ordered.length} GitHub file${ordered.length === 1 ? "" : "s"} into Project V2.`);
  }

  const runRuntimeAction = useCallback(async (
    action: string,
    values: Record<string, unknown> = {},
  ) => {
    const response = await fetch("/api/builder/runtime", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, action, ...values }),
    });
    const payload = await responseJson<RuntimeApiPayload>(response);
    if (!response.ok) throw new Error(payload.error ?? `${action} failed.`);
    return payload.result;
  }, [project.id]);

  async function runTask(taskId: string) {
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("The selected task is not declared by this project.");
    setBusy(`task:${taskId}`);
    try {
      const action =
        task.kind === "test"
          ? "tests"
          : task.kind === "dev"
            ? "preview"
            : ["typecheck", "lint", "build"].includes(task.kind)
              ? task.kind
              : "run";
      const result = await runRuntimeAction(
        action,
        action === "run" ? { taskId } : {},
      );
      const command = result as RuntimeCommandResult;
      if (command?.commandId) {
        const status = command.exitCode === 0 || command.exitCode === null ? "passed" : "failed";
        setChecks((current) => [
          ...current.filter((check) => check.id !== `manual-${taskId}`),
          {
            id: `manual-${taskId}`,
            label: task.label,
            kind: task.kind === "test" ? "test" : task.kind === "custom" || task.kind === "dev" ? "build" : task.kind,
            status,
            message: `${task.label} ${status === "passed" ? "completed" : `exited ${command.exitCode}`}.`,
            durationMs: duration(command),
            runId: command.runId,
            taskId,
          },
        ]);
        setLogs((current) => [...current, ...gateLogs({ ok: status === "passed", blockingErrors: [], previewUrl: null, checks: [{ name: task.kind === "test" ? "tests" : task.kind === "dev" ? "preview" : task.kind === "custom" ? "build" : task.kind, status, summary: task.label, command }] })]);
      }
      if (action === "preview") {
        const remote = await loadProjectV2FromCloud(project.id);
        if (remote) {
          setStorageRevision(remote.storageRevision);
          onProjectChange(remote.project, remote.storageRevision);
          setActiveView("preview");
        }
      }
      await refreshSandboxStatus(project.id).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function stopSandbox() {
    await runRuntimeAction("stop");
    setSandbox((current) => ({ ...current, status: "stopped" }));
    const next: ProjectV2 = {
      ...project,
      preview: project.preview
        ? {
            status: "stopped",
            projectRevision: project.revision,
            stoppedAt: new Date().toISOString(),
          }
        : undefined,
      updatedAt: new Date().toISOString(),
    };
    await saveSnapshot(next);
  }

  async function restoreCheckpoint(checkpointId: string) {
    if (!window.confirm("Restore this full project snapshot? Current files will be replaced by a new reversible revision.")) return;
    setBusy(`checkpoint:${checkpointId}`);
    try {
      await runRuntimeAction("restore", { checkpointId, confirm: true });
      const remote = await loadProjectV2FromCloud(project.id);
      if (!remote) throw new Error("Restored checkpoint could not be reloaded.");
      setComparisonFiles(structuredClone(project.files));
      setComparisonLabel("Before checkpoint restore");
      setStorageRevision(remote.storageRevision);
      onProjectChange(remote.project, remote.storageRevision);
      setActiveView("files");
      setRelease({ status: "unknown", evidence: [], blockers: ["Restored source must be rebuilt."] });
    } finally {
      setBusy(null);
    }
  }

  async function requestDeployment() {
    if (!window.confirm("Create a real Vercel preview deployment from this verified Project V2 revision?")) return;
    setBusy("request-deployment");
    try {
      const token = window.sessionStorage.getItem("drops-studio:vercel-access-token");
      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/json",
      };
      if (token) headers["x-vercel-access-token"] = token;
      const response = await fetch("/api/deployments/vercel", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          action: "deploy",
          studioProjectId: project.id,
          approved: true,
          wait: true,
        }),
      });
      const payload = await responseJson<DeploymentApiPayload>(response);
      if (!response.ok || !payload.deployment) {
        throw new Error(payload.error ?? "Vercel preview deployment failed.");
      }
      const state = payload.deployment.readyState?.toUpperCase();
      const status =
        payload.confirmedReady && state === "READY"
          ? "ready"
          : state === "ERROR"
            ? "failed"
            : state === "BUILDING"
              ? "building"
              : "queued";
      const createdAt = payload.deployment.createdAt ?? new Date().toISOString();
      const receipt: ProjectV2DeploymentReceiptView = {
        id: payload.deployment.id ?? crypto.randomUUID(),
        projectRevision: project.revision,
        provider: "vercel",
        status,
        deploymentId: payload.deployment.id,
        url: payload.confirmedReady ? payload.deployment.url ?? undefined : undefined,
        createdAt,
        finishedAt: payload.deployment.readyAt ?? undefined,
        ...(status === "failed" ? { error: "Vercel reported a failed deployment." } : {}),
      };
      setDeployments((current) => [receipt, ...current].slice(0, 20));
      const next: ProjectV2 = {
        ...project,
        deployment: {
          provider: "vercel",
          status,
          deploymentId: receipt.deploymentId,
          url: receipt.url,
          createdAt,
        },
        updatedAt: new Date().toISOString(),
      };
      await saveSnapshot(next);
      const deploymentLogs = payload.logs ?? [];
      if (deploymentLogs.length) {
        setLogs((current) => [
          ...current,
          ...deploymentLogs.map((entry, index) => ({
            id: `deploy-${receipt.id}-${index}`,
            runId: receipt.id,
            stream: entry.type === "stderr" ? "stderr" as const : "stdout" as const,
            timestamp: entry.createdAt ?? createdAt,
            text: entry.text ?? "",
          })).filter((entry) => entry.text),
        ]);
      }
      setActiveView("deploy");
      onNotify?.(
        status === "ready"
          ? "Vercel confirmed the preview deployment is READY."
          : `Vercel deployment state: ${status}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = useMemo(() => {
    if (agentState === "running") return "Building in Sandbox";
    if (agentState === "verified") return "AI agent verified";
    if (agentState === "fallback") return "Free Auto fallback · verified";
    if (agentState === "blocked") return "Build blocked";
    return provider === "free" ? "Free Auto fallback" : `${provider} agent`;
  }, [agentState, provider]);

  return (
    <section className={styles.surface} data-agent-state={agentState}>
      <header className={styles.agentBar}>
        <div className={styles.agentIdentity}>
          <span>{provider === "free" ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}</span>
          <div>
            <strong>{statusLabel}</strong>
            <p>{agentSummary}</p>
          </div>
        </div>
        <div className={styles.agentActions}>
          <span className={styles.agentReceipt} role="status">
            {agentState === "running" ? <LoaderCircle aria-hidden="true" /> : agentState === "verified" || agentState === "fallback" ? <CheckCircle2 aria-hidden="true" /> : agentState === "blocked" ? <ShieldAlert aria-hidden="true" /> : <CloudCog aria-hidden="true" />}
            {agentState}
          </span>
          <Button
            disabled={Boolean(busy)}
            onClick={() => void runBuilder(
              release.status === "blocked" ? "repair" : "build",
              release.status === "blocked"
                ? "Inspect the verified failures, repair the real project files, rerun every release check, refresh preview, and checkpoint the repaired revision."
                : "Build the current Project V2 revision, run every release check, start the real preview, exercise its primary interaction, and checkpoint only a passing revision.",
            )}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" /> : release.status === "blocked" ? <RefreshCw aria-hidden="true" /> : <Play aria-hidden="true" />}
            {release.status === "blocked" ? "Repair & verify" : "Build & verify"}
          </Button>
          <Button
            disabled={Boolean(busy) || !["creating", "running"].includes(sandbox.status)}
            onClick={() => void stopSandbox().catch((error) => onNotify?.(message(error, "Sandbox stop failed.")))}
            type="button"
            variant="outline"
          >
            <CircleStop aria-hidden="true" />Stop
          </Button>
        </div>
      </header>
      <ProjectV2Workspace
        agentTrace={agentTrace}
        activeView={activeView}
        browserErrors={diagnostics}
        busyAction={busy}
        checks={checks}
        comparisonFiles={comparisonFiles}
        comparisonLabel={comparisonLabel}
        deploymentHistory={deployments}
        draftContent={draft}
        logEntries={logs}
        onActiveViewChange={setActiveView}
        onImportGitHubFiles={importGitHubFiles}
        onCreateFile={(path) => mutateFiles(
          [{ type: "write", path, content: defaultFile(path), provenance: "manual" }],
          `Before creating ${path}`,
        ).then(() => {
          setSelectedPath(path);
          setDrafts((current) => clearProjectV2Draft(current, path));
        })}
        onDeleteFile={(path) => mutateFiles(
          [{ type: "delete", path }],
          `Before deleting ${path}`,
        ).then((next) => {
          const replacement = next.manifest.entrypoints[0] ?? Object.keys(next.files)[0] ?? null;
          setDrafts((current) => clearProjectV2Draft(current, path));
          setSelectedPath(replacement);
        })}
        onDraftChange={(content) => {
          if (!selectedPath) return;
          setDrafts((current) => updateProjectV2DraftMap(
            current,
            selectedPath,
            content,
            project.files[selectedPath]?.content ?? "",
          ));
        }}
        onOperationError={(error) => onNotify?.(message(error, "Project operation failed."))}
        onRefreshPreview={() => runBuilder(
          "repair",
          "Rebuild the current files, repair any verified error, rerun all checks, and refresh the real preview.",
        )}
        onRenameFile={(from, to) => {
          const pendingDraft = Object.hasOwn(drafts, from) ? drafts[from] : undefined;
          return mutateFiles(
            [{ type: "rename", from, to, provenance: "manual" }],
            `Before renaming ${from}`,
          ).then((next) => {
            setDrafts((current) => {
              const cleared = clearProjectV2Draft(current, from);
              return pendingDraft === undefined
                ? cleared
                : updateProjectV2DraftMap(
                    cleared,
                    to,
                    pendingDraft,
                    next.files[to]?.content ?? "",
                  );
            });
            setSelectedPath(to);
          });
        }}
        onRequestDeployment={requestDeployment}
        onRestoreCheckpoint={restoreCheckpoint}
        onRevertFile={async (path) => {
          const comparison = comparisonFiles?.[path];
          if (!comparison) throw new Error("No comparison source is available for this file.");
          await mutateFiles(
            [{ type: "write", path, content: comparison.content, provenance: "manual" }],
            `Before reverting ${path}`,
          );
          setDrafts((current) => clearProjectV2Draft(current, path));
        }}
        onRunTask={runTask}
        onSaveFile={async (path, content) => {
          await mutateFiles(
            [{ type: "write", path, content, provenance: "manual" }],
            `Before editing ${path}`,
          );
          setDrafts((current) => clearProjectV2Draft(current, path));
        }}
        onSelectFile={(path) => {
          setSelectedPath(path);
        }}
        onStopSandbox={stopSandbox}
        project={project}
        releaseReadiness={release}
        sandboxState={sandbox}
        selectedPath={selectedPath}
      />
    </section>
  );
}
