"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's next/link shim currently duplicates React during browser navigation; plain anchors preserve a working route transition. */

import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Blocks,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  Download,
  ExternalLink,
  Gamepad2,
  GitBranch,
  GitCommit,
  Globe2,
  History,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  LoaderCircle,
  Monitor,
  Minus,
  MousePointer2,
  Palette,
  Play,
  Plus,
  Rocket,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Redo2,
  Undo2,
  UploadCloud,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileProject } from "@/lib/project-compiler";
import { applyPresetFieldValue } from "@/lib/project-factory";
import {
  commitProjectCheckpoint,
  redoProjectCheckpoint,
  undoProjectCheckpoint,
} from "@/lib/project-history";
import { TelegramChannelWizard } from "@/components/telegram-channel-wizard";
import { DropsBotWebhookConnection } from "@/components/dropsbot-webhook-connection";
import { StudioAccountTeamPanel } from "@/components/studio-account-team-panel";
import { DropsBrand } from "@/components/drops-brand";
import { ProjectV2StudioSurface } from "@/components/project-v2-studio-surface";
import {
  ProjectWorkspaceDialog,
  type WorkspaceAiEvidenceView,
  type WorkspaceAiQuotaView,
  type WorkspaceRunReceiptView,
} from "@/components/project-workspace-dialog";
import {
  createFreeDirectorProposal,
  createFreeElementDirectorProposal,
  DESIGN_DIRECTIONS,
  type DirectorProposal,
} from "@/lib/project-director";
import { createProjectArchive } from "@/lib/project-export";
import {
  createProjectV2ArchiveBlob,
  projectV2ArchiveFilename,
} from "@/lib/project-v2-export";
import type { ProjectV2 } from "@/lib/project-v2-types";
import type { BuilderAgentResult } from "@/lib/builder-agent/types";
import { applyAgentPlan, type AgentProductPlan } from "@/lib/product-blueprint";
import { evaluateProjectQuality } from "@/lib/project-quality";
import {
  mergePublicationState,
  publishMutationForProject,
} from "@/lib/publish-lifecycle";
import { getProductReality } from "@/lib/product-reality";
import { acceptPublishedQuality } from "@/lib/published-quality-evidence";
import { approvedPreviewExternalUrl } from "@/lib/runtime-external-link";
import {
  createIsolatedRuntimeFullscreenDocument,
  secureEditableRuntimeSrcDoc,
} from "@/lib/runtime-srcdoc-security";
import {
  readProjectsFromStore,
  saveProjectSafely,
} from "@/lib/project-store";
import type {
  GeneratedProject,
  GeneratedProjectSpec,
  ProjectChatMessage,
  ProjectCheckpoint,
  ProjectDesignKit,
  ProjectElementConfig,
  ProjectProvider,
  ProjectRuntimeSmokeResult,
} from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import { getProjectPreset } from "@/lib/presets";
import {
  listMemberProjectsFromCloud,
  materializeMemberProject,
  MemberProjectSyncError,
  saveMemberProjectToCloud,
} from "@/lib/member-project-sync-client";
import {
  loadProjectV2FromCloud,
  ProjectV2SyncError,
  saveProjectV2ToCloud,
} from "@/lib/project-v2-sync-client";
import { canonicalProjectV2Json } from "@/lib/project-v2-hash";
import { refreshLegacyProjectV2Migration } from "@/lib/project-v2-migration";
import { refreshGeneratedProjectV2Template } from "@/lib/project-template-materializer";
import { validateEditableRuntimeHtml } from "@/lib/source-workspace";
import {
  addWorkspaceFile,
  compileWorkspaceRuntime,
  deleteWorkspaceFile,
  materializeProjectWorkspace,
  updateWorkspaceFile,
  validateProjectWorkspace,
  type ProjectWorkspace,
  type ProjectWorkspaceTask,
} from "@/lib/project-workspace";
import { createWorkspaceRunDigest } from "@/lib/workspace-run-digest";
import { safeSameOriginReturnPath } from "@/lib/safe-return-to";
import {
  studioAccountDisplayName,
  studioAccountInitial,
} from "@/lib/studio-account-profile";

type InspectorTab =
  | "project"
  | "preview"
  | "director"
  | "design"
  | "data"
  | "logic"
  | "connections"
  | "quality"
  | "code"
  | "history";
type HostingProvider = "vercel" | "cloudflare" | "netlify" | "github";
type DeviceMode = "desktop" | "mobile";
type SourceFile = string;
type ProjectSyncStatus =
  | "loading"
  | "local"
  | "saving"
  | "synced"
  | "conflict"
  | "error";

type SelectedCanvasItem =
  | {
      id: string;
      label: string;
      kind: "block";
    }
  | {
      id: string;
      label: string;
      kind: "element";
      tag: string;
      text: string;
      textEditable: boolean;
      imageEditable: boolean;
      imageSrc: string;
      styles: Required<Omit<ProjectElementConfig, "text" | "imageSrc">>;
      overrides: ProjectElementConfig;
    };

const modelLabels: Record<ProjectProvider, string> = {
  free: "Free Director",
  gateway: "Drops AI Gateway",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  openrouter: "OpenRouter Free",
  kimi: "Kimi",
  custom: "Custom API",
};

const hostLinks: Record<HostingProvider, string> = {
  vercel: "https://vercel.com/new",
  cloudflare: "https://dash.cloudflare.com/",
  netlify: "https://app.netlify.com/drop",
  github: "https://github.com/new",
};

function studioRequestHeaders(): Record<string, string> {
  let session = window.sessionStorage.getItem("drops-studio:guest-id") || "";
  if (!session) {
    session = crypto.randomUUID();
    window.sessionStorage.setItem("drops-studio:guest-id", session);
  }
  return {
    "content-type": "application/json",
    "x-drops-session": session,
  };
}

const kitTokens: Record<
  ProjectDesignKit,
  {
    accent: string;
    surface: string;
    style: GeneratedProjectSpec["theme"]["style"];
    font: GeneratedProjectSpec["design"]["font"];
    radius: number;
  }
> = {
  "drops-precision": {
    accent: "#316cff",
    surface: "#071326",
    style: "precision",
    font: "inter",
    radius: 16,
  },
  "neon-arena": {
    accent: "#ee4f9b",
    surface: "#080d26",
    style: "cosmic",
    font: "space-grotesk",
    radius: 22,
  },
  "mascot-pop": {
    accent: "#ff5dac",
    surface: "#11102d",
    style: "playful",
    font: "space-grotesk",
    radius: 26,
  },
  "glass-signal": {
    accent: "#31c9ff",
    surface: "#06162c",
    style: "cosmic",
    font: "inter",
    radius: 20,
  },
  "editorial-alpha": {
    accent: "#3877ff",
    surface: "#11172a",
    style: "editorial",
    font: "inter",
    radius: 14,
  },
  "terminal-pro": {
    accent: "#19c98f",
    surface: "#050b14",
    style: "precision",
    font: "ibm-plex",
    radius: 5,
  },
};

const categoryPrompts: Record<GeneratedProjectSpec["presetId"], string[]> = {
  "action-engine": [
    "Turn this into a compact operator cockpit",
    "Make the trigger graph the spotlight",
    "Use a risk-first terminal design",
    "Add stronger decision audit hierarchy",
  ],
  "alpha-channel": [
    "Make this feel like a premium creator studio",
    "Spotlight the sourced post composer",
    "Use an editorial Telegram preview",
    "Make verified channel setup clearer",
  ],
  "morning-alpha": [
    "Make the brief premium and compact",
    "Use an editorial daily layout",
    "Spotlight today’s decision card",
    "Turn catalysts into a timeline",
  ],
  "prediction-impact": [
    "Make the event-to-token map the hero",
    "Use a professional impact terminal",
    "Turn related assets into a graph",
    "Make reversal actions clearer",
  ],
  "smart-money-copy": [
    "Use a risk-first strategy monitor",
    "Spotlight the local paper ledger",
    "Make wallet-feed setup explicit",
    "Use a compact terminal design",
  ],
  "crypto-aggregator": [
    "Use a dense sortable market table",
    "Make search and filters the hero",
    "Add a glass market explorer feel",
    "Spotlight the watchlist workflow",
  ],
  "crypto-game": [
    "Make it a cartoon game with coin mascots",
    "Create a neon arcade version",
    "Set round timer to 12 seconds",
    "Spotlight the local challenge score",
  ],
  "personal-companion": [
    "Make recommendations feel more personal",
    "Use a friendly discovery feed",
    "Spotlight the taste graph",
    "Make explanations more editorial",
  ],
  "portfolio-tamagotchi": [
    "Make the creature world more playful",
    "Spotlight explainable portfolio health",
    "Use a cute mascot design",
    "Make holdings input clearer",
  ],
  "crypto-product-hunt": [
    "Make this a premium private launch board",
    "Spotlight the add-draft flow",
    "Show what public mode still requires",
    "Turn verified project context into cards",
  ],
  "crypto-radio": [
    "Make this feel like a real browser audio studio",
    "Spotlight the speech player",
    "Use an editorial audio rundown",
    "Make voice support clearer",
  ],
  "crypto-siri": [
    "Make the voice orb cinematic",
    "Use a focused assistant layout",
    "Spotlight sourced answer cards",
    "Make alert handoff more obvious",
  ],
  "custom-product": [
    "Reorganize this into a clearer modular workspace",
    "Make the primary workflow the visual focus",
    "Add a sourced comparison screen",
    "Make the Drops Bot handoff more explicit",
  ],
};

function nowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function colorInputValue(value: string, fallback = "#ffffff"): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const channels = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!channels) return fallback;
  return `#${channels
    .slice(1, 4)
    .map((channel) =>
      Math.max(0, Math.min(255, Number(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function normalizeRuntimeSmoke(
  value: unknown,
): ProjectRuntimeSmokeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const errors = Array.isArray(input.errors)
    ? input.errors.map((item) => String(item).slice(0, 160)).slice(0, 5)
    : [];
  return {
    // Every value here originates inside editable srcdoc code. Preserve it as
    // browser telemetry only; the iframe cannot mint host/provider evidence.
    mode: "browser",
    dataProvider: "unverified",
    executed: input.executed === true,
    runtime: input.runtime === true,
    interactions: input.interactions === true,
    dropstab: input.dropstab === true,
    dropsbot: input.dropsbot === true,
    actions: input.actions === true,
    errors,
    checkedAt:
      typeof input.checkedAt === "string"
        ? input.checkedAt.slice(0, 40)
        : new Date().toISOString(),
  };
}

function normalizeHostDataProvider(
  value: unknown,
): "dropstab" | "fallback" | "unverified" {
  return value === "dropstab" || value === "fallback"
    ? value
    : "unverified";
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  // Keep the detached download target alive through the next task. Chromium
  // can otherwise cancel larger Blob downloads before it has consumed the URL.
  window.setTimeout(() => anchor.remove(), 0);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Artwork could not be read."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Artwork could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

async function prepareArtwork(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8_000_000
  ) {
    throw new Error("Use a PNG, JPG or WebP under 8 MB.");
  }
  let candidate: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bitmap.width, 1000 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.82, 0.68, 0.54]) {
      const optimized = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (optimized && optimized.size < candidate.size) candidate = optimized;
      if (candidate.size <= 240_000) break;
    }
  } catch {
    // Keep the original when the browser cannot decode the image locally.
  }
  if (candidate.size > 240_000)
    throw new Error(
      "This artwork stays too large after optimization. Try a smaller image.",
    );
  return blobAsDataUrl(candidate);
}

function directorModelContext(spec: GeneratedProjectSpec) {
  const experience = { ...spec.experience, backgroundImage: undefined };
  const gameDirection = spec.gameDirection
    ? { ...spec.gameDirection, backgroundImage: undefined }
    : undefined;
  return {
    presetId: spec.presetId,
    name: spec.name,
    tagline: spec.tagline,
    description: spec.description,
    values: spec.values,
    tools: spec.tools,
    theme: spec.theme,
    design: spec.design,
    blocks: spec.blocks,
    experience,
    gameDirection,
  };
}

async function projectArchive(project: GeneratedProject): Promise<Uint8Array> {
  const quality =
    project.quality ?? evaluateProjectQuality(project.spec, project.html);
  const fetchRequiredAsset = async (assetPath: string) => {
    const response = await fetch(assetPath);
    if (!response.ok) {
      throw new Error(`Could not load required export asset ${assetPath}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  const [dropstabMarkSvg, dropsBotAvatarJpeg] = await Promise.all([
    fetchRequiredAsset("/brand/dropstab-mark.svg"),
    fetchRequiredAsset("/brand/drops-bot-avatar.jpg"),
  ]);
  // The current compiler embeds every category renderer before selecting the active one.
  // Load the known shared runtime assets and let the exporter include only references that
  // actually survive into the portable artifact. This keeps ZIP closure fail-closed.
  const game = await Promise.all([
    fetchRequiredAsset("/assets/market-catcher-retro.png"),
    fetchRequiredAsset("/assets/market-wolf-catcher.png"),
  ]).then(([marketCatcherBackgroundPng, marketWolfSpritePng]) => ({
    marketCatcherBackgroundPng,
    marketWolfSpritePng,
  }));

  return createProjectArchive(project, quality, {
    brand: { dropstabMarkSvg, dropsBotAvatarJpeg },
    game,
  });
}

function assistantWelcome(spec: GeneratedProjectSpec): ProjectChatMessage {
  const game = spec.gameDirection;
  return {
    id: nowId("assistant"),
    role: "assistant",
    createdAt: new Date().toISOString(),
    content: game
      ? `I directed this as a ${game.artStyle} ${game.genre.replace(/-/g, " ")} in ${game.world.replace(/-/g, " ")}. Ask me to change the world, mascots, game loop, difficulty, timer or any selected block.`
      : `I have the ${spec.presetId.replace(/-/g, " ")} brief, screens, data sources and safe actions. I’ll keep the working preview visible while files, checks and repairs run. Tell me what to change, or select a block in Design Mode for a targeted edit.`,
  };
}

const QUIET_SPEC_COMMIT_DELAY_MS = 400;

type PendingSpecCommit = {
  projectId: string;
  spec: GeneratedProjectSpec;
};

const PROJECT_V2_BUILD_TASKS = ["typecheck", "lint", "test", "build"] as const;

function projectV2BuildEvidence(projectV2?: ProjectV2): {
  passed: number;
  total: number;
  verified: boolean;
} {
  if (!projectV2) return { passed: 0, total: 5, verified: false };
  let passed = 0;
  for (const taskId of PROJECT_V2_BUILD_TASKS) {
    let latest: ProjectV2["runs"][number] | undefined;
    for (let index = projectV2.runs.length - 1; index >= 0; index -= 1) {
      const candidate = projectV2.runs[index];
      if (
        candidate.taskId === taskId
        && candidate.projectRevision === projectV2.revision
      ) {
        latest = candidate;
        break;
      }
    }
    if (latest?.status === "succeeded") passed += 1;
  }
  if (
    projectV2.preview?.status === "ready"
    && projectV2.preview.projectRevision === projectV2.revision
    && projectV2.preview.url
  ) {
    passed += 1;
  }
  return { passed, total: 5, verified: passed === 5 };
}

function currentProjectV2PreviewUrl(projectV2?: ProjectV2): string | null {
  if (
    !projectV2?.preview?.url
    || projectV2.preview.status !== "ready"
    || projectV2.preview.projectRevision !== projectV2.revision
  ) {
    return null;
  }
  try {
    const url = new URL(projectV2.preview.url);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function ProjectStudio() {
  const params = useParams<{ id: string }>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sourceReturnFocusRef = useRef<HTMLElement | null>(null);
  const publishReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectRef = useRef<GeneratedProject | null>(null);
  const committedProjectRef = useRef<GeneratedProject | null>(null);
  const pendingSpecRef = useRef<PendingSpecCommit | null>(null);
  const quietCommitTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const cloudSyncAvailableRef = useRef(false);
  const projectV2SyncAvailableRef = useRef(false);
  const cloudRevisionRef = useRef<number | null>(null);
  const projectV2CloudRevisionRef = useRef<number | null>(null);
  const [project, setProject] = useState<GeneratedProject | null>(null);
  const [accountProfile, setAccountProfile] = useState<{
    name: string;
    email?: string;
  } | null>(null);
  const [accountBrain, setAccountBrain] = useState<ProjectProvider | null>(
    null,
  );
  const [runtimeProject, setRuntimeProject] =
    useState<GeneratedProject | null>(null);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("project");
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [designMode, setDesignMode] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<SelectedCanvasItem | null>(
    null,
  );
  const [chatInput, setChatInput] = useState("");
  const [directing, setDirecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceFile, setSourceFile] = useState<SourceFile>("index.html");
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceIssues, setSourceIssues] = useState<string[]>([]);
  const [workspaceRunningTask, setWorkspaceRunningTask] =
    useState<ProjectWorkspaceTask["id"] | null>(null);
  const [workspaceRunReceipt, setWorkspaceRunReceipt] =
    useState<WorkspaceRunReceiptView | null>(null);
  const [workspaceRunDigestEvidence, setWorkspaceRunDigestEvidence] =
    useState<{
      project: GeneratedProject;
      receipt: WorkspaceRunReceiptView;
      digest: string;
    } | null>(null);
  const [workspaceRunError, setWorkspaceRunError] = useState("");
  const [workspaceAiPrompt, setWorkspaceAiPrompt] = useState("");
  const [workspaceAiRunning, setWorkspaceAiRunning] = useState(false);
  const [workspaceAiError, setWorkspaceAiError] = useState("");
  const [workspaceAiEvidence, setWorkspaceAiEvidence] =
    useState<WorkspaceAiEvidenceView | null>(null);
  const [workspaceAiQuota, setWorkspaceAiQuota] =
    useState<WorkspaceAiQuotaView | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [newModule, setNewModule] = useState("");
  const [previewGameAssets, setPreviewGameAssets] = useState({
    background: "",
    sprite: "",
  });
  const [runtimeSmoke, setRuntimeSmoke] =
    useState<ProjectRuntimeSmokeResult | null>(null);
  const [hostDataProvider, setHostDataProvider] =
    useState<"dropstab" | "fallback" | "unverified">("unverified");
  const [projectSyncStatus, setProjectSyncStatus] =
    useState<ProjectSyncStatus>("loading");

  const persistProject = useCallback(
    async (
      next: GeneratedProject,
      expectedUpdatedAt: string | null,
    ): Promise<boolean> => {
      const save = async () => {
        let candidate = next;
        if (
          next.projectV2
          && canonicalProjectV2Json(next.projectV2.productSpec)
            !== canonicalProjectV2Json(next.spec)
        ) {
          try {
            const refreshed = next.projectV2.manifest.framework.name === "legacy-html"
              ? await refreshLegacyProjectV2Migration({
                  project: next.projectV2,
                  generatedProject: next,
                })
              : await refreshGeneratedProjectV2Template({
                  project: next.projectV2,
                  spec: next.spec,
                });
            candidate = { ...next, projectV2: refreshed };
            const current = projectRef.current;
            if (
              current?.id === next.id
              && current.updatedAt === next.updatedAt
              && current.projectV2?.revision === next.projectV2.revision
              && canonicalProjectV2Json(current.spec)
                === canonicalProjectV2Json(next.spec)
            ) {
              projectRef.current = candidate;
              committedProjectRef.current = candidate;
              setProject(candidate);
              setDirty(true);
            }
          } catch {
            setProjectSyncStatus("error");
            setToast(
              "Generated Project V2 files could not be refreshed. Your previous revision is still safe.",
            );
            return false;
          }
        }
        try {
          const result = await saveProjectSafely(candidate, { expectedUpdatedAt });
          if (result.status === "conflict") {
            setProjectSyncStatus("conflict");
            setToast(
              "Another tab saved a newer browser version. Reload before applying this change.",
            );
            return false;
          }
        } catch {
          setProjectSyncStatus("error");
          setToast(
            "This project could not be saved locally. Free browser storage, then retry.",
          );
          return false;
        }

        if (!cloudSyncAvailableRef.current) {
          if (candidate.projectV2 && projectV2SyncAvailableRef.current) {
            try {
              const v2Record = await saveProjectV2ToCloud(
                candidate.projectV2,
                projectV2CloudRevisionRef.current ?? 0,
              );
              projectV2CloudRevisionRef.current = v2Record.storageRevision;
              setProjectSyncStatus("synced");
              return true;
            } catch (error) {
              if (
                error instanceof ProjectV2SyncError
                && error.code === "PROJECT_V2_REVISION_CONFLICT"
              ) {
                if (error.storageRevision !== undefined) {
                  projectV2CloudRevisionRef.current = error.storageRevision;
                }
                setProjectSyncStatus("conflict");
                setToast(
                  "The Project V2 filesystem changed in another session. Reload before writing files.",
                );
                return false;
              }
            }
          }
          setProjectSyncStatus("local");
          return true;
        }

        setProjectSyncStatus("saving");
        try {
          const record = await saveMemberProjectToCloud(
            candidate,
            cloudRevisionRef.current ?? 0,
          );
          cloudRevisionRef.current = record.revision;
          if (candidate.projectV2) {
            const v2Record = await saveProjectV2ToCloud(
              candidate.projectV2,
              projectV2CloudRevisionRef.current ?? 0,
            );
            projectV2CloudRevisionRef.current = v2Record.storageRevision;
          }
          setProjectSyncStatus("synced");
        } catch (error) {
          if (
            error instanceof MemberProjectSyncError &&
            error.code === "PROJECT_REVISION_CONFLICT"
          ) {
            if (error.current) cloudRevisionRef.current = error.current.revision;
            setProjectSyncStatus("conflict");
            setToast(
              "This project changed in another signed-in session. Your browser copy is safe; reload to review the cloud version.",
            );
          } else if (
            error instanceof ProjectV2SyncError &&
            error.code === "PROJECT_V2_REVISION_CONFLICT"
          ) {
            if (error.storageRevision !== undefined) {
              projectV2CloudRevisionRef.current = error.storageRevision;
            }
            setProjectSyncStatus("conflict");
            setToast(
              "The Project V2 filesystem changed in another session. Your browser copy is safe; reload before writing files.",
            );
          } else {
            setProjectSyncStatus("local");
            setToast(
              "Saved in this browser. Cloud sync is temporarily unavailable and will retry after your next edit.",
            );
          }
        }
        return true;
      };

      const queued = saveQueueRef.current.then(save, save);
      saveQueueRef.current = queued.then(
        () => true,
        () => false,
      );
      return queued;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const loadWorkspace = async () => {
      let found =
        readProjectsFromStore().find((item) => item.id === params.id) ?? null;
      try {
        const accessResponse = await fetch("/api/access", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const accessPayload = (await accessResponse.json()) as {
          access?: {
            authenticated?: boolean;
            projectSync?: boolean;
            account?: { connected?: boolean; projectSync?: boolean };
          };
        };
        const cloudAvailable = Boolean(
          accessResponse.ok &&
          accessPayload.access?.authenticated &&
          accessPayload.access.account?.connected &&
          accessPayload.access.account.projectSync,
        );
        const projectV2CloudAvailable = Boolean(
          accessResponse.ok
          && (
            accessPayload.access?.projectSync
            ?? accessPayload.access?.account?.projectSync
          ),
        );
        cloudSyncAvailableRef.current = cloudAvailable;
        projectV2SyncAvailableRef.current = projectV2CloudAvailable;
        if (cloudAvailable) {
          const cloud = await listMemberProjectsFromCloud();
          const record = cloud.projects.find((item) => item.id === params.id);
          if (record) {
            cloudRevisionRef.current = record.revision;
            if (
              !found ||
              Date.parse(record.updatedAt) > Date.parse(found.updatedAt)
            ) {
              const materialized = await materializeMemberProject(record);
              const stored = await saveProjectSafely(materialized, {
                expectedUpdatedAt: found?.updatedAt ?? null,
              });
              if (stored.status === "saved") found = materialized;
            }
            const cloudProjectV2 = await loadProjectV2FromCloud(params.id);
            projectV2CloudRevisionRef.current = cloudProjectV2?.storageRevision ?? 0;
            if (
              cloudProjectV2 &&
              found &&
              (!found.projectV2 ||
                Date.parse(cloudProjectV2.project.updatedAt) >=
                  Date.parse(found.projectV2.updatedAt))
            ) {
              found = { ...found, projectV2: cloudProjectV2.project };
            }
            setProjectSyncStatus("synced");
          } else {
            cloudRevisionRef.current = 0;
            projectV2CloudRevisionRef.current = 0;
            setProjectSyncStatus(found ? "local" : "synced");
          }
        } else if (projectV2CloudAvailable) {
          const cloudProjectV2 = await loadProjectV2FromCloud(params.id);
          projectV2CloudRevisionRef.current = cloudProjectV2?.storageRevision ?? 0;
          if (cloudProjectV2) {
            if (found) {
              found = { ...found, projectV2: cloudProjectV2.project };
            } else {
              const spec = validateProjectSpec(cloudProjectV2.project.productSpec);
              found = {
                id: cloudProjectV2.project.id,
                spec,
                html: compileProject(spec),
                projectV2: cloudProjectV2.project,
                createdAt: cloudProjectV2.project.createdAt,
                updatedAt: cloudProjectV2.project.updatedAt,
              };
            }
            setProjectSyncStatus("synced");
          } else {
            setProjectSyncStatus(found ? "local" : "synced");
          }
        } else {
          projectV2SyncAvailableRef.current = false;
          setProjectSyncStatus("local");
        }
      } catch {
        cloudSyncAvailableRef.current = false;
        projectV2SyncAvailableRef.current = false;
        setProjectSyncStatus("local");
      }
      if (cancelled) return;
      if (found) {
        const spec = validateProjectSpec(found.spec);
        const checkpoint: ProjectCheckpoint = {
          id: nowId("checkpoint"),
          label: "Working baseline",
          createdAt: new Date().toISOString(),
          source: "system",
          spec,
        };
        const compiledHtml = compileProject(spec);
        const storedSourceIsValid = Boolean(
          found.sourceEditedAt &&
            validateEditableRuntimeHtml(spec, found.html).valid,
        );
        const storedHtml = storedSourceIsValid ? found.html : compiledHtml;
        const storedWorkspaceValid = Boolean(
          found.workspace &&
            validateProjectWorkspace(spec, found.workspace).valid,
        );
        const workspace = storedWorkspaceValid
          ? found.workspace!
          : materializeProjectWorkspace({
              ...found,
              spec,
              html: storedHtml,
            });
        const html = compileWorkspaceRuntime(spec, workspace);
        const projectV2Source = {
          ...found,
          spec,
          html,
          workspace,
        };
        let projectV2: import("@/lib/project-v2-types").ProjectV2;
        try {
          projectV2 = found.projectV2
            ? await import("@/lib/project-v2-validator").then(({ validateProjectV2 }) =>
                validateProjectV2(found.projectV2),
              )
            : await import("@/lib/project-v2-migration").then(
                ({ migrateGeneratedProjectToV2 }) =>
                  migrateGeneratedProjectToV2(projectV2Source),
              );
        } catch {
          projectV2 = await import("@/lib/project-v2-migration").then(
            ({ migrateGeneratedProjectToV2 }) =>
              migrateGeneratedProjectToV2(projectV2Source),
          );
        }
        if (
          canonicalProjectV2Json(projectV2.productSpec)
          !== canonicalProjectV2Json(spec)
        ) {
          try {
            projectV2 = projectV2.manifest.framework.name === "legacy-html"
              ? await refreshLegacyProjectV2Migration({
                  project: projectV2,
                  generatedProject: projectV2Source,
                })
              : await refreshGeneratedProjectV2Template({
                  project: projectV2,
                  spec,
                });
          } catch {
            setToast("Project V2 source refresh will retry when you save");
          }
        }
        const migrated: GeneratedProject = {
          ...found,
          spec,
          html,
          workspace,
          projectV2,
          sourceEditedAt: storedSourceIsValid
            ? found.sourceEditedAt
            : undefined,
          quality: evaluateProjectQuality(spec, html),
          checkpoints: found.checkpoints?.length
            ? found.checkpoints
                .map((item) => ({
                  ...item,
                  spec: validateProjectSpec(item.spec),
                }))
                .slice(-12)
            : [checkpoint],
          futureCheckpoints: (found.futureCheckpoints ?? [])
            .map((item) => ({
              ...item,
              spec: validateProjectSpec(item.spec),
            }))
            .slice(0, 12),
          conversation: found.conversation?.length
            ? found.conversation
            : [assistantWelcome(spec)],
        };
        void saveProjectSafely(migrated, {
          expectedUpdatedAt: found.updatedAt,
        }).catch(() => {
          setProjectSyncStatus("error");
          setToast(
            "The migrated browser project could not be saved. Reload before making more changes.",
          );
        });
        projectRef.current = migrated;
        committedProjectRef.current = migrated;
        pendingSpecRef.current = null;
        setRuntimeSmoke(null);
        setProject(migrated);
        setRuntimeProject(migrated);
        const requestedPanel = new URLSearchParams(window.location.search).get(
          "panel",
        );
        if (requestedPanel === "director") {
          setTab("director");
        } else if (projectV2.manifest.framework.name === "nextjs") {
          setTab("code");
        }
        setRuntimeRevision((revision) => revision + 1);
        setDirty(
          Boolean(
            migrated.publishedUrl &&
              migrated.publishedAt !== migrated.updatedAt,
          ),
        );
      }
      if (!found) {
        projectRef.current = null;
        committedProjectRef.current = null;
        pendingSpecRef.current = null;
        setRuntimeProject(null);
      }
      setLoaded(true);
    };
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [params.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const chatEnd = chatEndRef.current;
    const conversation = chatEnd?.closest<HTMLElement>(".conversation");
    if (!chatEnd || !conversation) return;

    if (directing || (project?.conversation?.length ?? 0) > 1) {
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: "smooth",
      });
      return;
    }

    conversation.scrollTop = 0;
  }, [project?.conversation, directing]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        !event.data ||
        !event.source ||
        event.source !== iframeRef.current?.contentWindow
      )
        return;
      if (event.data.type === "drops-studio-runtime-smoke") {
        const smoke = normalizeRuntimeSmoke(event.data.result);
        if (!smoke) return;
        const committed = committedProjectRef.current;
        if (
          !committed ||
          String(event.data.slug || "") !== committed.spec.slug
        )
          return;
        setRuntimeSmoke(smoke);
        return;
      }
      if (event.data.type === "drops-studio-open-external") {
        const committed = committedProjectRef.current;
        if (
          !committed
          || String(event.data.slug || "") !== committed.spec.slug
        ) {
          return;
        }
        const approvedUrl = approvedPreviewExternalUrl(
          event.data.url,
          window.location.origin,
        );
        if (!approvedUrl) {
          setToast(
            "Preview blocked an unapproved external link. Use Fullscreen for standalone navigation.",
          );
          return;
        }
        window.open(approvedUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (event.data.type === "drops-studio-data-request") {
        const source = event.source as Window;
        void fetch("/api/public-data", {
          headers: { accept: "application/json" },
        })
          .then(async (response) => {
            const payload = (await response.json()) as Record<string, unknown>;
            const provider = response.ok
              ? normalizeHostDataProvider(payload.provider)
              : "unverified";
            setHostDataProvider(provider);
            source.postMessage(
              { type: "drops-studio-data-response", payload },
              "*",
            );
          })
          .catch(() => {
            setHostDataProvider("unverified");
            source.postMessage(
              {
                type: "drops-studio-data-response",
                payload: { source: "Saved DropsTab-compatible snapshot" },
              },
              "*",
            );
          });
      }
      if (event.data.type === "drops-studio-product-hunt-request") {
        const source = event.source as Window;
        const requestId = String(event.data.requestId || "");
        const action = String(event.data.action || "");
        const payload =
          event.data.payload && typeof event.data.payload === "object"
            ? event.data.payload
            : {};
        const respond = (ok: boolean, responsePayload: unknown) =>
          source.postMessage(
            {
              type: "drops-studio-product-hunt-response",
              requestId,
              ok,
              payload: responsePayload,
            },
            "*",
          );
        void (async () => {
          if (!requestId || !["list", "submit", "vote"].includes(action)) {
            respond(false, { error: "Invalid community request." });
            return;
          }
          let endpoint = "/api/product-hunt/launches";
          const init: RequestInit = {
            credentials: "same-origin",
            headers: { accept: "application/json" },
          };
          if (action === "list") {
            const sort = payload.sort === "new" ? "new" : "top";
            endpoint += `?sort=${sort}&limit=24`;
          } else if (action === "submit") {
            init.method = "POST";
            init.headers = {
              accept: "application/json",
              "content-type": "application/json",
            };
            init.body = JSON.stringify(payload.submission ?? {});
          } else {
            endpoint += `/${encodeURIComponent(String(payload.id || ""))}/vote`;
            init.method = "POST";
          }
          const response = await fetch(endpoint, init);
          const responsePayload = await response
            .json()
            .catch(() => ({ error: "Community service returned an unreadable response." }));
          respond(response.ok, responsePayload);
        })().catch((error) =>
          respond(false, {
            error:
              error instanceof Error
                ? error.message
                : "Community service is unavailable.",
          }),
        );
        return;
      }
      if (event.data.type === "drops-studio-block-selected") {
        setSelectedBlock({
          id: String(event.data.blockId || "application"),
          label: String(
            event.data.label || event.data.blockId || "Application",
          ),
          kind: "block",
        });
        setTab("design");
      }
      if (
        [
          "drops-studio-element-selected",
          "drops-studio-element-inline-edit",
        ].includes(event.data.type) &&
        event.data.styles
      ) {
        setSelectedBlock({
          id: String(event.data.elementId || "element"),
          label: String(event.data.label || event.data.elementId || "Element"),
          kind: "element",
          tag: String(event.data.tag || "element"),
          text: String(event.data.text || ""),
          textEditable: event.data.textEditable === true,
          imageEditable: event.data.imageEditable === true,
          imageSrc: String(event.data.imageSrc || ""),
          styles: event.data.styles,
          overrides:
            event.data.overrides && typeof event.data.overrides === "object"
              ? event.data.overrides
              : {},
        });
        setTab("design");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [persistProject]);

  useEffect(() => {
    let cancelled = false;
    if (!project || !workspaceRunReceipt) return;
    const workspace = project.workspace ?? materializeProjectWorkspace(project);
    const task = workspace.tasks.find(
      (candidate) => candidate.id === workspaceRunReceipt.task,
    );
    if (!task) return;
    void createWorkspaceRunDigest({
      files: workspace.files,
      task: {
        id: task.id,
        argv: [task.command, ...task.args],
        cwd: task.cwd ?? ".",
        timeoutMs: 15_000,
        previewPort: task.port,
      },
    })
      .then((digest) => {
        if (!cancelled) {
          setWorkspaceRunDigestEvidence({
            project,
            receipt: workspaceRunReceipt,
            digest,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, workspaceRunReceipt]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "drops-studio-design-mode", enabled: designMode },
      "*",
    );
  }, [designMode, runtimeRevision]);

  useEffect(() => {
    let cancelled = false;
    if (project?.spec.presetId !== "crypto-game") {
      return;
    }
    void Promise.all([
      fetch("/assets/market-catcher-retro.png"),
      fetch("/assets/market-wolf-catcher.png"),
    ])
      .then(async ([backgroundResponse, spriteResponse]) => {
        if (!backgroundResponse.ok || !spriteResponse.ok)
          throw new Error("Game artwork unavailable.");
        const [backgroundBlob, spriteBlob] = await Promise.all([
          backgroundResponse.blob(),
          spriteResponse.blob(),
        ]);
        const toDataUrl = (blob: Blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        const [background, sprite] = await Promise.all([
          toDataUrl(backgroundBlob),
          toDataUrl(spriteBlob),
        ]);
        if (cancelled) return;
        setPreviewGameAssets({ background, sprite });
      })
      .catch(() => {
        if (!cancelled) setPreviewGameAssets({ background: "", sprite: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [project?.spec.presetId]);

  const preset = getProjectPreset(project?.spec.presetId ?? "custom-product");
  const runtimeHtml = useMemo(() => {
    if (!runtimeProject) return "";
    if (runtimeProject.spec.presetId !== "crypto-game")
      return runtimeProject.html;
    const transparentPixel =
      "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    return runtimeProject.html
      .replaceAll(
        'src="/assets/market-catcher-retro.png"',
        `src="${previewGameAssets.background || transparentPixel}"`,
      )
      .replaceAll(
        'src="/assets/market-wolf-catcher.png"',
        `src="${previewGameAssets.sprite || transparentPixel}"`,
      );
  }, [previewGameAssets, runtimeProject]);
  const runtimeSrcDoc = useMemo(
    () => secureEditableRuntimeSrcDoc(runtimeHtml),
    [runtimeHtml],
  );
  const runtimePreviewUrl = useMemo(
    () => currentProjectV2PreviewUrl(project?.projectV2),
    [project?.projectV2],
  );
  const trustedRuntimeSmoke =
    (runtimeProject?.quality?.runtimeSmoke?.mode === "server-artifact"
      || runtimeProject?.quality?.runtimeSmoke?.mode === "server-inspection")
      ? runtimeProject.quality.runtimeSmoke
      : null;
  const qualityReport = useMemo(
    () =>
      runtimeProject
        ? evaluateProjectQuality(
            runtimeProject.spec,
            runtimeProject.html,
            trustedRuntimeSmoke ?? runtimeSmoke,
            { dataProvider: hostDataProvider },
          )
        : null,
    [hostDataProvider, runtimeProject, runtimeSmoke, trustedRuntimeSmoke],
  );
  const browserTelemetryReady = Boolean(
    runtimePreviewUrl
    || (
      runtimeSmoke?.mode === "browser"
      && runtimeSmoke.executed
      && runtimeSmoke.runtime
    ),
  );
  useEffect(() => {
    let cancelled = false;
    let sessionBrainTimer: number | null = null;
    const providers: ProjectProvider[] = [
      "openai",
      "anthropic",
      "openrouter",
      "kimi",
      "custom",
    ];
    const current = window.sessionStorage.getItem("drops-studio:active-brain");
    if (current && providers.includes(current as ProjectProvider)) {
      sessionBrainTimer = window.setTimeout(() => {
        if (!cancelled) setAccountBrain(current as ProjectProvider);
      }, 0);
    }
    void fetch("/api/account", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          profile?: { name?: string; email?: string } | null;
          connections?: Array<{
            provider?: string;
            connected?: boolean;
            model?: string;
          }>;
        };
        if (payload.profile?.name) {
          setAccountProfile({
            name: payload.profile.name,
            ...(payload.profile.email ? { email: payload.profile.email } : {}),
          });
        }
        if (current) return;
        const preferred = payload.connections?.find(
          (connection) =>
            connection.connected
            && providers.includes(connection.provider as ProjectProvider),
        );
        if (!preferred?.provider) return;
        const provider = preferred.provider as ProjectProvider;
        window.sessionStorage.setItem("drops-studio:active-brain", provider);
        if (preferred.model) {
          window.sessionStorage.setItem(
            `drops-studio:${provider}:model`,
            preferred.model,
          );
        }
        setAccountBrain(provider);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (sessionBrainTimer !== null) {
        window.clearTimeout(sessionBrainTimer);
      }
    };
  }, []);

  const activeProvider = useMemo(() => {
    if (accountBrain) return accountBrain;
    return project?.spec.brain.provider || "free";
  }, [accountBrain, project]);

  const adoptProject = useCallback((next: GeneratedProject) => {
    if (quietCommitTimerRef.current !== null) {
      window.clearTimeout(quietCommitTimerRef.current);
      quietCommitTimerRef.current = null;
    }
    pendingSpecRef.current = null;
    projectRef.current = next;
    committedProjectRef.current = next;
    setRuntimeSmoke(null);
    setProject(next);
    setRuntimeProject(next);
    setRuntimeRevision((revision) => revision + 1);
    setDirty(true);
  }, []);

  const adoptProjectV2 = useCallback(
    (nextProjectV2: ProjectV2, storageRevision?: number) => {
      const current = projectRef.current;
      if (!current || current.id !== nextProjectV2.id) return;
      if (storageRevision !== undefined) {
        projectV2CloudRevisionRef.current = storageRevision;
      }
      const next: GeneratedProject = {
        ...current,
        projectV2: nextProjectV2,
        updatedAt: nextProjectV2.updatedAt,
      };
      projectRef.current = next;
      committedProjectRef.current = next;
      setProject(next);
      setDirty(true);
      setProjectSyncStatus(storageRevision !== undefined ? "synced" : "local");
      const save = () =>
        saveProjectSafely(next, {
          expectedUpdatedAt: current.updatedAt,
        })
          .then((result) => {
            if (result.status === "conflict") {
              setProjectSyncStatus("conflict");
              setToast(
                "A newer browser revision exists. Reload before continuing Project V2 edits.",
              );
              return false;
            }
            return true;
          })
          .catch(() => {
            setProjectSyncStatus("error");
            setToast(
              storageRevision !== undefined
                ? "Project V2 is safe in private cloud storage, but the browser copy could not be updated."
                : "This Project V2 change could not be saved in this browser. Free storage, then retry.",
            );
            return false;
          });
      const queued = saveQueueRef.current.then(save, save);
      saveQueueRef.current = queued;
    },
    [],
  );

  const recordBuilderAgentEvent = useCallback(
    (event: {
      phase: "snapshot" | "sandbox" | "verification" | "preview";
      status: "active" | "done" | "blocked";
      message: string;
    }) => {
      const current = projectRef.current;
      if (!current) return;
      const eventId = `builder-${current.id}-${event.phase}`;
      const content =
        event.status === "active"
          ? `Working · ${event.message}`
          : event.status === "done"
            ? `Verified · ${event.message}`
            : `Paused · ${event.message}`;
      const existing = current.conversation ?? [];
      if (existing.some((item) => item.id === eventId && item.content === content)) {
        return;
      }
      const conversation = existing.some((item) => item.id === eventId)
        ? existing.map((item) =>
            item.id === eventId
              ? { ...item, content, createdAt: new Date().toISOString() }
              : item,
          )
        : [
            ...existing,
            {
              id: eventId,
              role: "assistant" as const,
              content,
              createdAt: new Date().toISOString(),
            },
          ];
      const next: GeneratedProject = {
        ...current,
        conversation,
        updatedAt: new Date().toISOString(),
      };
      projectRef.current = next;
      setProject(next);
      void persistProject(next, current.updatedAt);
    },
    [persistProject],
  );

  const replaceProject = useCallback(
    (next: GeneratedProject) => {
      const current = projectRef.current;
      adoptProject(next);
      void persistProject(next, current?.updatedAt ?? null);
    },
    [adoptProject, persistProject],
  );

  const applyTeamProject = useCallback(
    async function applyTeamProject(
      sharedProject: GeneratedProject,
    ): Promise<boolean> {
      const appliedAt = new Date().toISOString();
      const localProject: GeneratedProject = {
        ...sharedProject,
        sourceEditedAt: appliedAt,
        updatedAt: appliedAt,
      };
      const existing = readProjectsFromStore().find(
        (item) => item.id === localProject.id,
      );
      try {
        const saved = await saveProjectSafely(localProject, {
          expectedUpdatedAt: existing?.updatedAt ?? null,
        });
        if (saved.status === "conflict") {
          setToast(
            "A newer browser copy of this shared project already exists. Reload before applying the team revision.",
          );
          return false;
        }
        if (localProject.id === params.id) {
          adoptProject(localProject);
          setProjectSyncStatus("local");
          return true;
        }
        window.location.assign(
          `/studio/${encodeURIComponent(localProject.id)}`,
        );
        return true;
      } catch {
        setToast(
          "The shared project could not be saved locally. Free browser storage, then retry.",
        );
        return false;
      }
    },
    [adoptProject, params.id],
  );

  const persistPendingSpec = useCallback(() => {
    if (quietCommitTimerRef.current !== null) {
      window.clearTimeout(quietCommitTimerRef.current);
      quietCommitTimerRef.current = null;
    }
    const pending = pendingSpecRef.current;
    const current = projectRef.current;
    if (!pending || !current || pending.projectId !== current.id) return null;
    pendingSpecRef.current = null;
    const next = commitProjectCheckpoint(current, {
      id: nowId("checkpoint"),
      label: "Edited project settings",
      createdAt: new Date().toISOString(),
      source: "manual",
      spec: validateProjectSpec(pending.spec),
    }).project;
    projectRef.current = next;
    committedProjectRef.current = next;
    void persistProject(next, current.updatedAt);
    return next;
  }, [persistProject]);

  const commitPendingSpec = useCallback(() => {
    const next = persistPendingSpec();
    if (!next) return null;
    setRuntimeSmoke(null);
    setProject(next);
    setRuntimeProject(next);
    setRuntimeRevision((revision) => revision + 1);
    return next;
  }, [persistPendingSpec]);

  const updateSpecQuiet = useCallback(
    (update: (spec: GeneratedProjectSpec) => GeneratedProjectSpec) => {
      const current = projectRef.current;
      if (!current) return;
      const baseSpec =
        pendingSpecRef.current?.projectId === current.id
          ? pendingSpecRef.current.spec
          : current.spec;
      const spec = update(baseSpec);
      const draft = { ...current, spec };
      pendingSpecRef.current = { projectId: current.id, spec };
      projectRef.current = draft;
      setProject(draft);
      setDirty(true);
      if (quietCommitTimerRef.current !== null)
        window.clearTimeout(quietCommitTimerRef.current);
      quietCommitTimerRef.current = window.setTimeout(
        commitPendingSpec,
        QUIET_SPEC_COMMIT_DELAY_MS,
      );
    },
    [commitPendingSpec],
  );

  useEffect(() => {
    const flushBeforeUnload = () => {
      persistPendingSpec();
    };
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      persistPendingSpec();
    };
  }, [persistPendingSpec]);

  function commitSpec(
    specInput: GeneratedProjectSpec,
    label: string,
    source: ProjectCheckpoint["source"] = "manual",
    conversation?: ProjectChatMessage[],
  ) {
    const currentProject = projectRef.current ?? project;
    if (!currentProject) return;
    const checkpoint: ProjectCheckpoint = {
      id: nowId("checkpoint"),
      label,
      createdAt: new Date().toISOString(),
      source,
      spec: validateProjectSpec(specInput),
    };
    const transition = commitProjectCheckpoint(
      {
        ...currentProject,
        conversation: conversation ?? currentProject.conversation,
      },
      checkpoint,
    );
    replaceProject(transition.project);
  }

  function applyKit(kit: ProjectDesignKit) {
    if (!project) return;
    const token = kitTokens[kit];
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        theme: {
          ...project.spec.theme,
          accent: token.accent,
          surface: token.surface,
          style: token.style,
        },
        design: {
          ...project.spec.design,
          kit,
          font: token.font,
          radius: token.radius,
          motion:
            kit === "neon-arena" || kit === "mascot-pop"
              ? "expressive"
              : "smooth",
        },
        gameDirection: project.spec.gameDirection
          ? {
              ...project.spec.gameDirection,
              artStyle:
                kit === "mascot-pop"
                  ? "comic"
                  : kit === "neon-arena"
                    ? "3d-toy"
                    : project.spec.gameDirection.artStyle,
            }
          : undefined,
      }),
      `Applied ${DESIGN_DIRECTIONS.find((item) => item.id === kit)?.name ?? kit}`,
      "design",
    );
    setToast("Design direction applied — checkpoint created");
  }

  function updateSelectedBlock(update: {
    visible?: boolean;
    variant?: "default" | "compact" | "wide" | "spotlight";
  }) {
    if (!project || !selectedBlock || selectedBlock.kind !== "block") return;
    const current = project.spec.blocks[selectedBlock.id] ?? {
      visible: true,
      variant: "default" as const,
    };
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        blocks: {
          ...project.spec.blocks,
          [selectedBlock.id]: { ...current, ...update },
        },
      }),
      `Edited ${selectedBlock.label}`,
      "design",
    );
  }

  function previewSelectedElement(update: {
    text?: string;
    imageSrc?: string;
    styles?: Partial<Omit<ProjectElementConfig, "text" | "imageSrc">>;
  }) {
    if (!selectedBlock || selectedBlock.kind !== "element") return;
    const overrides: ProjectElementConfig = {
      ...selectedBlock.overrides,
      ...(update.styles ?? {}),
      ...(update.text !== undefined ? { text: update.text } : {}),
      ...(update.imageSrc !== undefined ? { imageSrc: update.imageSrc } : {}),
    };
    const next: Extract<SelectedCanvasItem, { kind: "element" }> = {
      ...selectedBlock,
      ...(update.text !== undefined ? { text: update.text } : {}),
      ...(update.imageSrc !== undefined ? { imageSrc: update.imageSrc } : {}),
      styles: { ...selectedBlock.styles, ...(update.styles ?? {}) },
      overrides,
    };
    setSelectedBlock(next);
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "drops-studio-element-preview",
        elementId: next.id,
        config: overrides,
      },
      "*",
    );
  }

  async function previewElementImage(file?: File) {
    if (
      !selectedBlock ||
      selectedBlock.kind !== "element" ||
      !selectedBlock.imageEditable ||
      !file
    )
      return;
    try {
      setToast("Optimizing the selected image…");
      previewSelectedElement({ imageSrc: await prepareArtwork(file) });
      setToast("Image replaced in preview — save a version when ready");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Image could not be applied.",
      );
    }
  }

  function commitSelectedElement() {
    if (!project || !selectedBlock || selectedBlock.kind !== "element") return;
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        elements: {
          ...(project.spec.elements ?? {}),
          [selectedBlock.id]: selectedBlock.overrides,
        },
      }),
      `Edited ${selectedBlock.label}`,
      "design",
    );
    setToast(`${selectedBlock.label} saved as a reversible version`);
  }

  function resetSelectedElement() {
    if (!project || !selectedBlock || selectedBlock.kind !== "element") return;
    const nextElements = { ...(project.spec.elements ?? {}) };
    delete nextElements[selectedBlock.id];
    commitSpec(
      validateProjectSpec({ ...project.spec, elements: nextElements }),
      `Reset ${selectedBlock.label}`,
      "design",
    );
    setSelectedBlock(null);
    setToast("Element reset to the generated design");
  }

  function undo() {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    const transition = undoProjectCheckpoint(
      currentProject,
      new Date().toISOString(),
    );
    if (!transition) {
      setToast("No earlier checkpoint yet");
      return;
    }
    const previous = transition.project.checkpoints?.at(-1);
    replaceProject(transition.project);
    setToast(`Restored: ${previous?.label ?? "earlier checkpoint"}`);
  }

  function redo() {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    const transition = redoProjectCheckpoint(
      currentProject,
      new Date().toISOString(),
    );
    if (!transition) {
      setToast("No later checkpoint yet");
      return;
    }
    const restored = transition.project.checkpoints?.at(-1);
    replaceProject(transition.project);
    setToast(`Redone: ${restored?.label ?? "next checkpoint"}`);
  }

  function restoreCheckpoint(checkpoint: ProjectCheckpoint) {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    const transition = commitProjectCheckpoint(currentProject, {
      id: nowId("checkpoint"),
      label: `Restored ${checkpoint.label}`,
      createdAt: new Date().toISOString(),
      source: "manual",
      spec: checkpoint.spec,
      ...(checkpoint.runtimeHtml
        ? { runtimeHtml: checkpoint.runtimeHtml }
        : {}),
    });
    replaceProject(transition.project);
    setToast(`Restored: ${checkpoint.label}`);
  }

  async function sendDirectorPrompt(raw?: string) {
    const activeProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!activeProject || directing) return;
    const instruction = (raw ?? chatInput).trim();
    if (!instruction) return;
    setChatInput("");
    setDirecting(true);
    const userMessage: ProjectChatMessage = {
      id: nowId("user"),
      role: "user",
      content: instruction,
      createdAt: new Date().toISOString(),
    };
    const baseConversation = [
      ...(activeProject.conversation ?? []),
      userMessage,
    ];
    const conversationDraft = {
      ...activeProject,
      conversation: baseConversation,
    };
    projectRef.current = conversationDraft;
    setProject(conversationDraft);
    if (
      activeProject.projectV2
      && projectV2SyncAvailableRef.current
      && activeProvider !== "free"
    ) {
      try {
        await fetch("/api/access", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        let snapshot = await loadProjectV2FromCloud(activeProject.id);
        if (!snapshot) {
          snapshot = await saveProjectV2ToCloud(activeProject.projectV2, 0);
        }
        projectV2CloudRevisionRef.current = snapshot.storageRevision;
        const provider = activeProvider;
        const headers: Record<string, string> = {
          accept: "application/json",
          "content-type": "application/json",
        };
        const key = provider === "gateway"
          ? null
          : window.sessionStorage.getItem(`drops-studio:${provider}`);
        if (provider === "openrouter" && key) {
          headers["x-openrouter-key"] = key;
        } else if (key) {
          headers["x-provider-key"] = key;
        }
        const model =
          window.sessionStorage.getItem(
            provider === "custom"
              ? "drops-studio:custom-model"
              : `drops-studio:${provider}:model`,
          ) || undefined;
        const response = await fetch("/api/builder/agent", {
          method: "POST",
          credentials: "same-origin",
          headers,
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({
            projectId: activeProject.id,
            prompt: instruction,
            mode: "edit",
            provider: {
              provider,
              ...(model ? { model } : {}),
              ...(provider === "custom"
                ? {
                    baseUrl:
                      window.sessionStorage.getItem(
                        "drops-studio:custom-endpoint",
                      ) || undefined,
                  }
                : {}),
            },
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          result?: BuilderAgentResult;
          error?: string;
        };
        if (!payload.result) {
          throw new Error(payload.error || "The Project V2 agent returned no verified result.");
        }
        const remote = await loadProjectV2FromCloud(activeProject.id);
        const projectV2 = remote?.project ?? payload.result.project;
        if (remote) projectV2CloudRevisionRef.current = remote.storageRevision;
        const changedFiles = Array.from(
          new Set([
            ...Object.keys(snapshot.project.files),
            ...Object.keys(projectV2.files),
          ]),
        ).filter(
          (path) =>
            snapshot.project.files[path]?.hash !== projectV2.files[path]?.hash,
        ).length;
        const assistant: ProjectChatMessage = {
          id: nowId("assistant"),
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: payload.result.releaseGate.ok
            ? `${payload.result.providerMode === "deterministic-fallback" ? "Free Auto fallback" : "AI agent"} changed ${changedFiles} real file${changedFiles === 1 ? "" : "s"}, passed the release gate, refreshed preview and created a checkpoint. Open Builder to inspect the diff and evidence.`
            : `${payload.result.summary} The changed Project V2 files and exact blocking checks are available in Builder; no deployment was claimed.`,
        };
        const next: GeneratedProject = {
          ...conversationDraft,
          projectV2,
          conversation: [...baseConversation, assistant],
          updatedAt: projectV2.updatedAt,
        };
        projectRef.current = next;
        committedProjectRef.current = next;
        setProject(next);
        setProjectSyncStatus(remote ? "synced" : "local");
        const save = () =>
          saveProjectSafely(next, {
            expectedUpdatedAt: activeProject.updatedAt,
          });
        const queued = saveQueueRef.current.then(save, save);
        saveQueueRef.current = queued.then(
          () => true,
          () => false,
        );
        const saved = await queued;
        if (saved.status === "conflict") {
          setProjectSyncStatus("conflict");
          setToast(
            "Another tab saved a newer browser version. Reload before continuing Project V2 edits.",
          );
          return;
        }
        setToast(
          remote
            ? payload.result.releaseGate.ok
              ? "Project V2 files changed and verified in Sandbox"
              : "Project V2 edit saved with blocking check evidence"
            : payload.result.releaseGate.ok
              ? "Sandbox verification passed; the Project V2 update is saved in this browser because private cloud sync could not be confirmed."
              : "Blocking check evidence is saved in this browser because private cloud sync could not be confirmed.",
        );
      } catch (error) {
        void error;
        const assistant: ProjectChatMessage = {
          id: nowId("assistant"),
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: "The connected model could not finish this change, so I kept the last verified revision unchanged. Retry once or switch to Free Auto in Connections; no deployment or external action was performed.",
        };
        const next: GeneratedProject = {
          ...conversationDraft,
          conversation: [...baseConversation, assistant],
        };
        projectRef.current = next;
        setProject(next);
        const save = () =>
          saveProjectSafely(next, {
            expectedUpdatedAt: activeProject.updatedAt,
          });
        const queued = saveQueueRef.current.then(save, save);
        saveQueueRef.current = queued.then(
          () => true,
          () => false,
        );
        try {
          const saved = await queued;
          if (saved.status === "conflict") {
            setProjectSyncStatus("conflict");
            setToast(
              "The agent result could not be added because another tab saved a newer browser version. Reload to continue.",
            );
          }
        } catch {
          setProjectSyncStatus("error");
          setToast(
            "The agent result could not be saved in this browser. Free storage, then retry.",
          );
        }
      } finally {
        setDirecting(false);
      }
      return;
    }
    try {
      let proposal: DirectorProposal;
      const provider = activeProvider;
      const key =
        provider === "free"
          ? null
          : window.sessionStorage.getItem(`drops-studio:${provider}`);
      if (provider === "free") {
        const deterministic = selectedBlock?.kind === "element"
          ? createFreeElementDirectorProposal(
              activeProject.spec,
              instruction,
              selectedBlock,
            )
          : createFreeDirectorProposal(
              activeProject.spec,
              instruction,
              selectedBlock?.id,
            );
        proposal = {
          ...deterministic,
          label: "Free Director deterministic change set",
          summary: [
            ...deterministic.summary,
            "Applying this proposal refreshes the generated Project V2 files; run Builder afterward for a verified Sandbox preview.",
          ],
        };
      } else if (provider === "custom" && key) {
        const endpoint = window.sessionStorage.getItem(
          "drops-studio:custom-endpoint",
        );
        const model = window.sessionStorage.getItem(
          "drops-studio:custom-model",
        );
        if (!endpoint || !model)
          throw new Error("Custom OpenAI-compatible connection is incomplete.");
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 900,
            messages: [
              {
                role: "system",
                content:
                  "Return JSON only. You may improve name, tagline, description, theme, design, experience, gameDirection and elements. When selectedCanvas is an element, edit only its exact id inside elements unless the user explicitly asks for a whole-product change. Preserve the preset and DropsTab/Drops Bot foundations. Never return code, URLs or API keys.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  instruction,
                  selectedCanvas: selectedBlock,
                  product: directorModelContext(activeProject.spec),
                }),
              },
            ],
          }),
        });
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(
            payload.error?.message ||
              `Custom provider returned ${response.status}.`,
          );
        const text = payload.choices?.[0]?.message?.content || "{}";
        const suggestion = JSON.parse(
          text.match(/\{[\s\S]*\}/)?.[0] || "{}",
        ) as Partial<GeneratedProjectSpec>;
        const customSpec = validateProjectSpec({
          ...activeProject.spec,
          name: suggestion.name ?? activeProject.spec.name,
          tagline: suggestion.tagline ?? activeProject.spec.tagline,
          description:
            suggestion.description ?? activeProject.spec.description,
          theme: {
            ...activeProject.spec.theme,
            ...(suggestion.theme ?? {}),
          },
          design: {
            ...activeProject.spec.design,
            ...(suggestion.design ?? {}),
          },
          experience: {
            ...activeProject.spec.experience,
            ...(suggestion.experience ?? {}),
          },
          elements: {
            ...(activeProject.spec.elements ?? {}),
            ...(suggestion.elements ?? {}),
          },
          gameDirection: activeProject.spec.gameDirection
            ? {
                ...activeProject.spec.gameDirection,
                ...(suggestion.gameDirection ?? {}),
              }
            : undefined,
          brain: { provider: "custom", model, enhanced: true },
        });
        if (
          selectedBlock?.kind === "element" &&
          !suggestion.elements?.[selectedBlock.id]
        ) {
          const focused = createFreeElementDirectorProposal(
            activeProject.spec,
            instruction,
            selectedBlock,
          );
          proposal = {
            ...focused,
            label: `${model} · focused element guard`,
            summary: [
              ...focused.summary,
              "Kept the edit isolated because the connected model returned no valid element override.",
            ],
          };
        } else {
          proposal = {
            label: `${model} proposal`,
            summary: [
              "Applied the requested direction through your custom model.",
              "Preserved the validated crypto product contract.",
            ],
            affected: ["Product brief", "Experience", "Design"],
            spec: customSpec,
          };
        }
      } else {
        const model =
          window.sessionStorage.getItem(`drops-studio:${provider}:model`) ||
          activeProject.spec.brain.model;
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (provider === "openrouter" && key) headers["x-openrouter-key"] = key;
        else if (["openai", "anthropic", "kimi"].includes(provider) && key)
          headers["x-provider-key"] = key;
        const response = await fetch("/api/agent/plan", {
          method: "POST",
          headers,
          body: JSON.stringify({
            provider: provider === "gateway" ? undefined : provider,
            model,
            guestId: window.sessionStorage.getItem("drops-studio:guest-id"),
            prompt: `Revise the existing product without changing its category (${activeProject.spec.presetId}).\nUser change: ${instruction}\nSelected canvas item: ${JSON.stringify(selectedBlock ?? { kind: "product", label: "whole product" })}.\nIf the selected item kind is element, use its exact id in elementEdit and return only the requested focused style/copy change there while preserving the rest of the product.\nCurrent product: ${JSON.stringify({ name: activeProject.spec.name, tagline: activeProject.spec.tagline, description: activeProject.spec.description, tools: activeProject.spec.tools })}\nCurrent blueprint: ${JSON.stringify(activeProject.spec.blueprint)}\nCurrent design: ${JSON.stringify({ theme: activeProject.spec.theme, design: activeProject.spec.design, experience: activeProject.spec.experience, gameDirection: activeProject.spec.gameDirection, elements: activeProject.spec.elements })}`,
          }),
        });
        const payload = (await response.json()) as {
          plan?: AgentProductPlan;
          error?: string;
          model?: string;
          warning?: string;
        };
        if (!response.ok || !payload.plan)
          throw new Error(payload.error || "AI Director failed.");
        const aiPlan: AgentProductPlan = {
          ...payload.plan,
          presetId: activeProject.spec.presetId,
        };
        if (selectedBlock?.kind === "element" && !aiPlan.elementEdit) {
          const focused = createFreeElementDirectorProposal(
            activeProject.spec,
            instruction,
            selectedBlock,
          );
          proposal = {
            ...focused,
            label: `${payload.model || modelLabels[provider]} · focused element edit`,
            summary: [
              ...focused.summary,
              payload.warning ||
                "The selected element stayed isolated from the rest of the product.",
            ],
          };
        } else {
          const revised = validateProjectSpec(
            applyAgentPlan(activeProject.spec, aiPlan),
          );
          proposal = {
            label: `${payload.model || aiPlan.model || modelLabels[provider]} change set`,
            summary: [
              `Rebuilt ${selectedBlock?.label ?? "the product direction"} from the full instruction.`,
              `${aiPlan.blueprint.screens.length} native screens · ${aiPlan.blueprint.interactions.length} working interactions.`,
              aiPlan.blueprint.revisionNotes?.[0] ||
                payload.warning ||
                "DropsTab evidence and Drops Bot action boundaries remain explicit.",
            ],
            affected: [
              selectedBlock?.label ?? "Product blueprint",
              "Runtime",
              "Design system",
            ],
            spec: revised,
          };
        }
      }
      const assistant: ProjectChatMessage = {
        id: nowId("assistant"),
        role: "assistant",
        content: `I prepared a safe change set for ${proposal.affected.join(", ").toLowerCase()}. Review it before applying.`,
        createdAt: new Date().toISOString(),
        proposal: {
          label: proposal.label,
          summary: proposal.summary,
          spec: proposal.spec,
        },
      };
      const currentProject = projectRef.current ?? activeProject;
      const next = {
        ...currentProject,
        conversation: [...baseConversation, assistant],
        updatedAt: new Date().toISOString(),
      };
      void persistProject(next, currentProject.updatedAt);
      projectRef.current = next;
      setProject(next);
    } catch (error) {
      const fallback =
        selectedBlock?.kind === "element"
          ? createFreeElementDirectorProposal(
              activeProject.spec,
              instruction,
              selectedBlock,
            )
          : createFreeDirectorProposal(
              activeProject.spec,
              instruction,
              selectedBlock?.id,
            );
      const assistant: ProjectChatMessage = {
        id: nowId("assistant"),
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: `${error instanceof Error ? error.message : "The connected model is unavailable."} I prepared the same request with Free Director instead.`,
        proposal: {
          label: "Free Director fallback",
          summary: fallback.summary,
          spec: fallback.spec,
        },
      };
      const currentProject = projectRef.current ?? activeProject;
      const next = {
        ...currentProject,
        conversation: [...baseConversation, assistant],
      };
      void persistProject(next, currentProject.updatedAt);
      projectRef.current = next;
      setProject(next);
    } finally {
      setDirecting(false);
    }
  }

  function applyChatProposal(message: ProjectChatMessage) {
    if (!project || !message.proposal) return;
    const conversation = (project.conversation ?? []).map((item) =>
      item.id === message.id
        ? {
            ...item,
            proposal: undefined,
            content: `${item.content} Applied as a new checkpoint.`,
          }
        : item,
    );
    commitSpec(
      message.proposal.spec,
      message.proposal.label,
      "director",
      conversation,
    );
    setToast("Proposal applied — Undo is available");
  }

  function dismissProposal(message: ProjectChatMessage) {
    if (!project) return;
    const next = {
      ...project,
      conversation: (project.conversation ?? []).map((item) =>
        item.id === message.id
          ? {
              ...item,
              proposal: undefined,
              content: `${item.content} Proposal dismissed.`,
            }
          : item,
      ),
    };
    void persistProject(next, project.updatedAt);
    projectRef.current = next;
    setProject(next);
  }

  async function handleArtUpload(file?: File) {
    if (!project || !file) return;
    try {
      setToast("Optimizing artwork for preview and publishing…");
      const image = await prepareArtwork(file);
      const gameDirection = project.spec.gameDirection
        ? {
            ...project.spec.gameDirection,
            backgroundImage: undefined,
            assetSource: "uploaded" as const,
          }
        : undefined;
      commitSpec(
        validateProjectSpec({
          ...project.spec,
          experience: {
            ...project.spec.experience,
            backgroundImage: image,
            assetSource: "uploaded",
          },
          ...(gameDirection ? { gameDirection } : {}),
        }),
        "Uploaded product artwork",
        "design",
      );
      setToast("Artwork optimized and included in publish/export");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Artwork could not be applied.",
      );
    }
  }

  function updateModule(index: number, value: string) {
    if (!project) return;
    const modules = project.spec.experience.modules.map(
      (module, moduleIndex) => (moduleIndex === index ? value : module),
    );
    updateSpecQuiet((spec) => ({
      ...spec,
      experience: { ...spec.experience, modules },
    }));
  }

  function moveModule(index: number, direction: -1 | 1) {
    if (!project) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= project.spec.experience.modules.length)
      return;
    const modules = [...project.spec.experience.modules];
    [modules[index], modules[nextIndex]] = [modules[nextIndex], modules[index]];
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        experience: { ...project.spec.experience, modules },
      }),
      "Reordered product modules",
      "manual",
    );
  }

  function removeModule(index: number) {
    if (!project || project.spec.experience.modules.length <= 1) return;
    const modules = project.spec.experience.modules.filter(
      (_, moduleIndex) => moduleIndex !== index,
    );
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        experience: { ...project.spec.experience, modules },
      }),
      "Removed a product module",
      "manual",
    );
  }

  function addModule() {
    if (
      !project ||
      !newModule.trim() ||
      project.spec.experience.modules.length >= 12
    )
      return;
    const modules = [...project.spec.experience.modules, newModule.trim()];
    commitSpec(
      validateProjectSpec({
        ...project.spec,
        experience: { ...project.spec.experience, modules },
      }),
      "Added a product module",
      "manual",
    );
    setNewModule("");
  }

  function openRuntime() {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    const sandboxPreviewUrl = currentProjectV2PreviewUrl(
      currentProject.projectV2,
    );
    if (sandboxPreviewUrl) {
      window.open(sandboxPreviewUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (currentProject.publishedUrl && !dirty)
      window.open(
        currentProject.publishedUrl,
        "_blank",
        "noopener,noreferrer",
      );
    else {
      const url = URL.createObjectURL(
        new Blob([createIsolatedRuntimeFullscreenDocument(currentProject.html)], {
          type: "text/html",
        }),
      );
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function persistPublicationState(
    currentProject: GeneratedProject,
    desiredProject: GeneratedProject,
  ): Promise<{ project: GeneratedProject; conflicted: boolean } | null> {
    let candidate = desiredProject;
    let expectedUpdatedAt = currentProject.updatedAt;
    let conflicted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await saveProjectSafely(candidate, {
          expectedUpdatedAt,
        });
        if (result.status === "saved") return { project: candidate, conflicted };
        if (!result.current) {
          setPublishError(
            "The local project changed before publication metadata could be saved. Reload before publishing again.",
          );
          setToast("Reload this project before publishing again");
          return null;
        }
        conflicted = true;
        candidate = mergePublicationState(result.current, candidate);
        expectedUpdatedAt = result.current.updatedAt;
      } catch {
        setPublishError(
          "Publication changed, but its browser management data could not be saved locally. Free browser storage before continuing.",
        );
        setToast("Publication management data could not be saved locally");
        return null;
      }
    }
    setPublishError(
      "Another tab keeps changing this project. Close the other editor and reload before publishing again.",
    );
    setToast("Another tab is still editing this project");
    return null;
  }

  async function publish(): Promise<string | null> {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject || publishing || unpublishing) return null;
    const trustedPublishSmoke =
      (currentProject.quality?.runtimeSmoke?.mode === "server-artifact"
        || currentProject.quality?.runtimeSmoke?.mode === "server-inspection")
        ? currentProject.quality.runtimeSmoke
        : null;
    const quality = evaluateProjectQuality(
      currentProject.spec,
      currentProject.html,
      trustedPublishSmoke,
      { dataProvider: hostDataProvider },
    );
    // Browser postMessage telemetry is never an authorization gate. When an
    // edited workspace has no bound server inspection yet, the publish API is
    // still reached and performs the authoritative release inspection.
    if (trustedPublishSmoke && !quality.readyToPublish) {
      const next = { ...currentProject, quality };
      projectRef.current = next;
      setProject(next);
      setTab("quality");
      setPublishError(
        `Quality gate blocked publishing at ${quality.score}/100.`,
      );
      setToast("Fix the failed release checks before publishing");
      return null;
    }
    setPublishing(true);
    setPublishError("");
    try {
      const publishMutation = publishMutationForProject(currentProject);
      const response = await fetch("/api/projects/publish", {
        method: publishMutation === "update" ? "PUT" : "POST",
        headers: {
          ...studioRequestHeaders(),
          ...(publishMutation === "update"
            ? {
                authorization: `Bearer ${currentProject.publishCapability}`,
              }
            : {}),
        },
        body: JSON.stringify({
          spec: currentProject.spec,
          ...(currentProject.sourceEditedAt
            ? { html: currentProject.html }
            : {}),
          ...(publishMutation === "update"
            ? { slug: currentProject.publishedSlug }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        url?: string;
        slug?: string;
        capability?: string;
        quality?: unknown;
        code?: string;
        error?: string;
      };
      if (!response.ok || !payload.url || !payload.slug) {
        if (
          response.status === 403 &&
          payload.code === "PUBLISH_CAPABILITY_INVALID" &&
          publishMutation === "update"
        ) {
          const readOnly = {
            ...currentProject,
            publishCapability: undefined,
          };
          const persisted = await persistPublicationState(
            currentProject,
            readOnly,
          );
          if (persisted) {
            projectRef.current = persisted.project;
            committedProjectRef.current = persisted.project;
            setRuntimeProject(persisted.project);
            setProject(persisted.project);
          }
        }
        throw new Error(payload.error || "Publishing failed.");
      }
      if (publishMutation === "create" && !payload.capability) {
        throw new Error(
          "The public app was created without a browser management capability. Reload before publishing again.",
        );
      }
      const publishedQuality = acceptPublishedQuality(
        payload.quality,
        currentProject.spec.presetId,
      );
      if (!publishedQuality) {
        throw new Error(
          "The publish service did not return valid server inspection evidence for this product.",
        );
      }
      const publishedAt = new Date().toISOString();
      const next = {
        ...currentProject,
        quality: publishedQuality,
        publishedUrl: payload.url,
        publishedSlug: payload.slug,
        publishedAt,
        publishCapability:
          publishMutation === "create"
            ? payload.capability
            : currentProject.publishCapability,
        updatedAt: publishedAt,
      };
      const persisted = await persistPublicationState(currentProject, next);
      if (!persisted) return null;
      projectRef.current = persisted.project;
      committedProjectRef.current = persisted.project;
      setRuntimeProject(persisted.project);
      setProject(persisted.project);
      if (persisted.conflicted) {
        setRuntimeRevision((revision) => revision + 1);
        setDirty(true);
        const conflictMessage =
          "A newer local edit was kept. The public link is managed, but publish again to sync that edit.";
        setPublishError(conflictMessage);
        setToast(conflictMessage);
        return null;
      }
      setDirty(false);
      setToast(
        publishMutation === "update"
          ? "Public app updated at the same URL"
          : publishedQuality.externalSetupRequired
          ? "Setup app published — connect and verify the external destination next"
          : "Working public app published",
      );
      return payload.url;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Publishing failed.";
      setPublishError(message);
      setToast(message);
      return null;
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    const currentProject = projectRef.current ?? project;
    if (
      !currentProject?.publishedSlug ||
      !currentProject.publishCapability ||
      publishing ||
      unpublishing
    ) {
      return;
    }
    if (
      !window.confirm(
        "Unpublish this public app? Its current link will stop working, while your local project stays in this browser.",
      )
    ) {
      return;
    }
    setUnpublishing(true);
    setPublishError("");
    try {
      const response = await fetch("/api/projects/publish", {
        method: "DELETE",
        headers: {
          ...studioRequestHeaders(),
          authorization: `Bearer ${currentProject.publishCapability}`,
        },
        body: JSON.stringify({ slug: currentProject.publishedSlug }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        if (
          response.status === 403 &&
          payload?.code === "PUBLISH_CAPABILITY_INVALID"
        ) {
          const readOnly = {
            ...currentProject,
            publishCapability: undefined,
          };
          const persisted = await persistPublicationState(
            currentProject,
            readOnly,
          );
          if (persisted) {
            projectRef.current = persisted.project;
            committedProjectRef.current = persisted.project;
            setRuntimeProject(persisted.project);
            setProject(persisted.project);
          }
        }
        throw new Error(payload?.error || "Unpublishing failed.");
      }
      const next: GeneratedProject = {
        ...currentProject,
        publishedUrl: undefined,
        publishedSlug: undefined,
        publishedAt: undefined,
        publishCapability: undefined,
      };
      const persisted = await persistPublicationState(currentProject, next);
      if (!persisted) return;
      projectRef.current = persisted.project;
      committedProjectRef.current = persisted.project;
      setRuntimeProject(persisted.project);
      setProject(persisted.project);
      setDirty(false);
      if (persisted.conflicted) {
        setRuntimeRevision((revision) => revision + 1);
        const conflictMessage =
          "A newer local edit was kept while the public link was removed. Review it before publishing again.";
        setPublishError(conflictMessage);
        setToast(conflictMessage);
        return;
      }
      setPublishOpen(false);
      setToast("Public app unpublished; local project kept");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unpublishing failed.";
      setPublishError(message);
      setToast(message);
    } finally {
      setUnpublishing(false);
    }
  }

  async function share() {
    const currentProject = projectRef.current ?? project;
    let url =
      currentProject?.publishedUrl && !dirty
        ? currentProject.publishedUrl
        : null;
    if (!url) url = await publish();
    if (!url) return;
    if (navigator.share)
      await navigator
        .share({
          title: currentProject?.spec.name,
          text: currentProject?.spec.tagline,
          url,
        })
        .catch(() => undefined);
    else
      await navigator.clipboard
        .writeText(url)
        .then(() => setToast("Public link copied"));
  }

  function handleCloudPublish() {
    const currentProject = projectRef.current ?? project;
    if (currentProject?.publishedUrl && !dirty) {
      window.open(
        currentProject.publishedUrl,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    void publish();
  }

  async function downloadSource(nextHost?: HostingProvider) {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    if (
      currentProject.projectV2 &&
      currentProject.projectV2.manifest.framework.name !== "legacy-html"
    ) {
      downloadBlob(
        projectV2ArchiveFilename(currentProject.projectV2),
        await createProjectV2ArchiveBlob(currentProject.projectV2),
      );
    } else {
      const bytes = await projectArchive(currentProject);
      downloadBlob(
        `${currentProject.spec.slug}-source.zip`,
        new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }),
      );
    }
    setToast(
      nextHost
        ? `Git-ready deployment package created for ${nextHost}`
        : "Runnable app + source ZIP downloaded",
    );
    if (nextHost)
      window.setTimeout(
        () => window.open(hostLinks[nextHost], "_blank", "noopener,noreferrer"),
        450,
      );
  }

  function openSource(file: SourceFile = "index.html") {
    const currentProject =
      commitPendingSpec() ?? projectRef.current ?? project;
    if (!currentProject) return;
    const workspace =
      currentProject.workspace ?? materializeProjectWorkspace(currentProject);
    const selectedFile =
      file === "quality-report.json"
        ? file
        : workspace.files.some((item) => item.path === file)
          ? file
          : "index.html";
    sourceReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!currentProject.workspace) {
      const next = { ...currentProject, workspace };
      projectRef.current = next;
      committedProjectRef.current = next;
      setProject(next);
      setRuntimeProject(next);
      void persistProject(next, currentProject.updatedAt);
    }
    setSourceFile(selectedFile);
    setSourceDraft(
      workspace.files.find((item) => item.path === selectedFile)?.content ?? "",
    );
    setSourceIssues([]);
    setWorkspaceRunError("");
    setSourceOpen(true);
  }

  function openPublish() {
    commitPendingSpec();
    publishReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPublishOpen(true);
  }

  function applyProjectJson() {
    const currentProject = projectRef.current ?? project;
    if (!currentProject) return;
    try {
      const spec = validateProjectSpec(JSON.parse(sourceDraft));
      const baseWorkspace =
        currentProject.workspace ?? materializeProjectWorkspace(currentProject);
      const normalized = JSON.stringify(spec, null, 2);
      const workspace = updateWorkspaceFile(
        spec,
        baseWorkspace,
        "project.json",
        normalized,
      );
      const transition = commitProjectCheckpoint(currentProject, {
        id: nowId("checkpoint"),
        label: "Edited project.json",
        createdAt: new Date().toISOString(),
        source: "manual",
        spec,
        workspace,
      });
      replaceProject(transition.project);
      setSourceDraft(normalized);
      setSourceIssues([]);
      setToast("Validated project.json applied — checkpoint created");
    } catch (error) {
      const issue =
        error instanceof Error
          ? `Invalid project.json: ${error.message}`
          : "Invalid project.json";
      setSourceIssues([issue]);
      setToast(issue);
    }
  }

  function applyRuntimeHtml() {
    const currentProject = projectRef.current ?? project;
    if (!currentProject) return;
    try {
      const baseWorkspace =
        currentProject.workspace ?? materializeProjectWorkspace(currentProject);
      const workspace = updateWorkspaceFile(
        currentProject.spec,
        baseWorkspace,
        sourceFile,
        sourceDraft,
      );
      const transition = commitProjectCheckpoint(currentProject, {
        id: nowId("checkpoint"),
        label: `Edited ${sourceFile}`,
        createdAt: new Date().toISOString(),
        source: "manual",
        spec: currentProject.spec,
        workspace,
      });
      replaceProject(transition.project);
      setSourceIssues([]);
      setToast(
        sourceFile === "index.html"
          ? "Validated index.html applied — preview updated and checkpoint created"
          : `Validated ${sourceFile} applied — preview and revision updated`,
      );
    } catch (error) {
      const issue =
        error instanceof Error ? error.message : `${sourceFile} is invalid`;
      setSourceIssues([issue]);
      setToast(issue);
    }
  }

  async function runWorkspaceTask(task: ProjectWorkspaceTask) {
    const currentProject = projectRef.current ?? project;
    if (!currentProject || workspaceRunningTask) return;
    const workspace =
      currentProject.workspace ?? materializeProjectWorkspace(currentProject);
    setWorkspaceRunningTask(task.id);
    setWorkspaceRunError("");
    try {
      const submittedArgv = [task.command, ...task.args];
      const submittedDigest = await createWorkspaceRunDigest({
        files: workspace.files,
        task: {
          id: task.id,
          argv: submittedArgv,
          cwd: task.cwd ?? ".",
          timeoutMs: 15_000,
          previewPort: task.port,
        },
      });
      const response = await fetch("/api/workspace/run", {
        method: "POST",
        credentials: "same-origin",
        headers: studioRequestHeaders(),
        body: JSON.stringify({
          workspaceId: currentProject.id,
          workspace,
          taskId: task.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        receipt?: WorkspaceRunReceiptView;
        error?: string;
      } & Partial<WorkspaceRunReceiptView>;
      if (!response.ok) {
        throw new Error(payload.error || "The isolated workspace task failed.");
      }
      const receipt = payload.receipt ??
        (payload.providerRunId ? (payload as WorkspaceRunReceiptView) : null);
      if (
        !receipt ||
        receipt.provider !== "vercel-sandbox" ||
        receipt.workspaceId !== currentProject.id ||
        receipt.workspaceRevision !== workspace.revision ||
        receipt.workspaceDigest !== submittedDigest ||
        receipt.task !== task.id ||
        !Array.isArray(receipt.argv) ||
        receipt.argv.length !== submittedArgv.length ||
        receipt.argv.some((value, index) => value !== submittedArgv[index])
      ) {
        throw new Error(
          "The sandbox did not return a verifiable receipt for the submitted workspace revision.",
        );
      }
      setWorkspaceRunReceipt(receipt);
      setToast(
        receipt.exitCode === 0 || receipt.exitCode === null
          ? `${task.label} completed in the isolated workspace`
          : `${task.label} exited with code ${receipt.exitCode}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Workspace task failed.";
      setWorkspaceRunError(message);
      setToast(message);
    } finally {
      setWorkspaceRunningTask(null);
    }
  }

  async function generateWorkspacePatch() {
    const currentProject = projectRef.current ?? project;
    const prompt = workspaceAiPrompt.trim();
    if (!currentProject || workspaceAiRunning || prompt.length < 3) return;
    const workspace =
      currentProject.workspace ?? materializeProjectWorkspace(currentProject);
    const selectedProvider = activeProvider;
    const provider = ["openrouter", "openai", "anthropic", "kimi"].includes(
      selectedProvider,
    )
      ? (selectedProvider as "openrouter" | "openai" | "anthropic" | "kimi")
      : "platform";
    const model =
      provider === "platform"
        ? undefined
        : window.sessionStorage.getItem(
            `drops-studio:${selectedProvider}:model`,
          ) || currentProject.spec.brain.model;
    const headers = studioRequestHeaders();
    if (provider === "openrouter") {
      const key = window.sessionStorage.getItem("drops-studio:openrouter");
      if (key) headers["x-openrouter-key"] = key;
    } else if (["openai", "anthropic", "kimi"].includes(provider)) {
      const key = window.sessionStorage.getItem(`drops-studio:${provider}`);
      if (key) headers["x-provider-key"] = key;
    }

    setWorkspaceAiRunning(true);
    setWorkspaceAiError("");
    try {
      const response = await fetch("/api/workspace/patch", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          prompt,
          baseRevision: workspace.revision,
          workspace,
          provider,
          ...(model ? { model } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        workspace?: ProjectWorkspace;
        spec?: unknown;
        change?: {
          revision?: number;
          summary?: string;
          created?: number;
          updated?: number;
          deleted?: number;
        };
        providerEvidence?: WorkspaceAiEvidenceView;
        quota?: WorkspaceAiQuotaView | null;
        error?: string;
      };
      if (!response.ok || !payload.workspace) {
        throw new Error(
          payload.error ||
            "The AI provider could not create a valid source revision.",
        );
      }
      const projectFile = payload.workspace.files.find(
        (file) => file.path === "project.json",
      );
      const nextSpec = validateProjectSpec(
        payload.spec ?? JSON.parse(projectFile?.content ?? "null"),
      );
      if (nextSpec.presetId !== currentProject.spec.presetId) {
        throw new Error(
          "AI source changes cannot switch this project's product category.",
        );
      }
      const validation = validateProjectWorkspace(nextSpec, payload.workspace);
      if (!validation.valid) {
        throw new Error(
          validation.issues[0] || "The returned workspace revision is invalid.",
        );
      }
      compileWorkspaceRuntime(nextSpec, payload.workspace);
      const transition = commitProjectCheckpoint(currentProject, {
        id: nowId("checkpoint"),
        label: payload.change?.summary || "AI source revision",
        createdAt: new Date().toISOString(),
        source: "director",
        spec: nextSpec,
        workspace: payload.workspace,
      });
      replaceProject(transition.project);
      setSourceFile("index.html");
      setSourceDraft(
        payload.workspace.files.find((file) => file.path === "index.html")
          ?.content ?? "",
      );
      setSourceIssues([]);
      setWorkspaceRunError("");
      setWorkspaceAiEvidence(payload.providerEvidence ?? null);
      setWorkspaceAiQuota(payload.quota ?? null);
      setWorkspaceAiPrompt("");
      const operations = [
        payload.change?.created ? `${payload.change.created} created` : "",
        payload.change?.updated ? `${payload.change.updated} updated` : "",
        payload.change?.deleted ? `${payload.change.deleted} deleted` : "",
      ].filter(Boolean);
      setToast(
        `AI workspace revision ${payload.workspace.revision} applied${
          operations.length ? ` · ${operations.join(", ")}` : ""
        }`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI workspace generation failed safely.";
      setWorkspaceAiError(message);
      setToast(message);
    } finally {
      setWorkspaceAiRunning(false);
    }
  }

  function createWorkspaceFile(path: string) {
    const currentProject = projectRef.current ?? project;
    if (!currentProject) return;
    try {
      const workspace = addWorkspaceFile(
        currentProject.spec,
        currentProject.workspace ?? materializeProjectWorkspace(currentProject),
        {
          path,
          content: path.endsWith(".json")
            ? "{}\n"
            : path.endsWith(".css")
              ? "/* Workspace styles */\n"
              : path.endsWith(".md")
                ? "# Workspace note\n"
                : "export {};\n",
          language: path.endsWith(".json")
            ? "json"
            : path.endsWith(".css")
              ? "css"
              : path.endsWith(".md")
                ? "markdown"
                : "javascript",
          role: path.startsWith("tests/") ? "test" : "client",
        },
      );
      const transition = commitProjectCheckpoint(currentProject, {
        id: nowId("checkpoint"),
        label: `Created ${path}`,
        createdAt: new Date().toISOString(),
        source: "manual",
        spec: currentProject.spec,
        workspace,
      });
      replaceProject(transition.project);
      setSourceFile(path);
      setSourceDraft(
        workspace.files.find((file) => file.path === path)?.content ?? "",
      );
      setSourceIssues([]);
      setToast(`${path} created in workspace revision ${workspace.revision}`);
    } catch (error) {
      const issue = error instanceof Error ? error.message : "Could not create file.";
      setSourceIssues([issue]);
      setToast(issue);
    }
  }

  function removeWorkspaceFile(path: string) {
    const currentProject = projectRef.current ?? project;
    if (!currentProject) return;
    try {
      const workspace = deleteWorkspaceFile(
        currentProject.spec,
        currentProject.workspace ?? materializeProjectWorkspace(currentProject),
        path,
      );
      const transition = commitProjectCheckpoint(currentProject, {
        id: nowId("checkpoint"),
        label: `Deleted ${path}`,
        createdAt: new Date().toISOString(),
        source: "manual",
        spec: currentProject.spec,
        workspace,
      });
      replaceProject(transition.project);
      setSourceFile("index.html");
      setSourceDraft(
        workspace.files.find((file) => file.path === "index.html")?.content ??
          "",
      );
      setSourceIssues([]);
      setToast(`${path} removed from workspace`);
    } catch (error) {
      const issue = error instanceof Error ? error.message : "Could not delete file.";
      setSourceIssues([issue]);
      setToast(issue);
    }
  }

  if (!loaded)
    return (
      <div className="studio-loading">
        <LoaderCircle className="spin" /> Loading product workspace…
      </div>
    );
  if (!project || !preset)
    return (
      <main className="studio-missing">
        <span>
          <Rocket />
        </span>
        <h1>Project not found</h1>
        <p>This local project may belong to another browser.</p>
        <a href="/">Create a working product</a>
      </main>
    );

  const published = Boolean(project.publishedUrl);
  const managedPublication =
    published && publishMutationForProject(project) === "update";
  const legacyPublication = published && !managedPublication;
  const quality =
    qualityReport ?? evaluateProjectQuality(project.spec, project.html);
  const builderEvidence = projectV2BuildEvidence(project.projectV2);
  const hasProjectV2 = Boolean(project.projectV2);
  const releaseEvidenceReady = hasProjectV2
    ? builderEvidence.verified
    : quality.readyToPublish;
  const reality = getProductReality(project.spec.presetId);
  const externalSetup = quality.launchStatus === "external-setup-required";
  const researchOnly = quality.launchStatus === "research-only";
  const releaseLabel = externalSetup
    ? "External setup required"
    : researchOnly
      ? "Research app ready"
      : "Web app ready";
  const checkpoints = project.checkpoints ?? [];
  const futureCheckpoints = project.futureCheckpoints ?? [];
  const nav: Array<{
    id: InspectorTab;
    label: string;
    icon: typeof Settings2;
    mobileOnly?: boolean;
  }> = [
    { id: "project", label: "Project", icon: Settings2 },
    { id: "preview", label: "Preview", icon: Monitor, mobileOnly: true },
    { id: "director", label: "Director", icon: Sparkles },
    { id: "design", label: "Design", icon: Palette },
    { id: "data", label: "Data", icon: Database },
    { id: "logic", label: "Logic", icon: Blocks },
    { id: "connections", label: "Connect", icon: KeyRound },
    { id: "quality", label: "Tests", icon: ShieldCheck },
    {
      id: "code",
      label:
        project.projectV2?.manifest.framework.name === "nextjs"
          ? "Builder"
          : "Code",
      icon: Code2,
    },
    { id: "history", label: "Versions", icon: History },
  ];
  const game = project.spec.gameDirection;
  const quickPrompts = categoryPrompts[project.spec.presetId];
  const activeWorkspace =
    project.workspace ?? materializeProjectWorkspace(project);

  const openInspectorTab = (nextTab: InspectorTab) => {
    setTab(nextTab);
    if (nextTab === "director") {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.focus();
      });
    }
  };

  const openConnectionsHub = (provider?: string) => {
    const returnTo = safeSameOriginReturnPath(
      `${window.location.pathname}${window.location.search}`,
      window.location.origin,
    );
    const search = new URLSearchParams({
      connections: "1",
      returnTo,
    });
    if (provider) search.set("provider", provider);
    window.location.assign(`/?${search.toString()}`);
  };

  return (
    <main
      className="project-studio-shell"
      onBlurCapture={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement
        )
          commitPendingSpec();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          event.target.type !== "file"
        )
          commitPendingSpec();
      }}
    >
      <header className="project-studio-topbar">
        <div className="project-crumbs">
          <a href="/" aria-label="Back to builder">
            <ArrowLeft />
          </a>
          <DropsBrand compact showPartners={false} />
          <i>/</i>
          <span>{project.spec.name}</span>
          <b className={published && !dirty ? "running" : "draft"}>
            <i />
            {published && !dirty
              ? externalSetup
                ? "Setup app published"
                : researchOnly
                  ? "Research app published"
                  : "Web app published"
                : dirty
                  ? builderEvidence.verified
                    ? "Verified draft"
                    : hasProjectV2
                      ? "Build pending"
                      : "Edits pending"
                  : externalSetup
                  ? "Needs connection"
                  : hasProjectV2
                    ? builderEvidence.verified
                      ? "Verified draft"
                      : "Build pending"
                    : "Draft"}
          </b>
        </div>
        <div className="workspace-actions">
          <button
            className="workspace-icon-action"
            type="button"
            aria-label="Undo"
            onClick={undo}
            disabled={checkpoints.length < 2}
          >
            <Undo2 /> <span>Undo</span>
          </button>
          <button
            className="workspace-icon-action"
            type="button"
            aria-label="Redo"
            onClick={redo}
            disabled={futureCheckpoints.length === 0}
          >
            <Redo2 /> <span>Redo</span>
          </button>
          <button
            className="workspace-run-action"
            type="button"
            aria-label={
              project.projectV2?.manifest.framework.name === "nextjs"
                ? "Open Builder to run this app"
                : "Run app"
            }
            onClick={() =>
              project.projectV2?.manifest.framework.name === "nextjs"
                ? setTab("code")
                : openRuntime()
            }
          >
            <Play />{" "}
            <span>
              {project.projectV2?.manifest.framework.name === "nextjs"
                ? "Open Builder"
                : "Run app"}
            </span>
          </button>
          <button
            className="workspace-connections-action"
            type="button"
            aria-label="Connections"
            onClick={() => setTab("connections")}
          >
            <KeyRound /> <span>Connections</span>
          </button>
          <button
            className="workspace-account-action"
            type="button"
            aria-label={accountProfile
              ? `Open Connections Hub for ${studioAccountDisplayName(accountProfile.name)}`
              : "Sign in to Drops Studio"}
            title={accountProfile?.email ?? "Sign in with Google"}
            onClick={() => openConnectionsHub()}
          >
            <span className="workspace-account-avatar">
              {accountProfile
                ? studioAccountInitial(accountProfile.name)
                : <UserRound />}
            </span>
            <span>{accountProfile
              ? studioAccountDisplayName(accountProfile.name)
              : "Sign in"}</span>
          </button>
          <button
            className="workspace-icon-action"
            type="button"
            aria-label="Share"
            onClick={share}
            disabled={publishing || unpublishing}
          >
            <Share2 /> <span>Share</span>
          </button>
          <button
            className="publish-top"
            type="button"
            onClick={openPublish}
            disabled={publishing || unpublishing}
          >
            <UploadCloud />{" "}
            <span>
              {published && dirty
                ? managedPublication
                  ? "Publish update"
                  : "Publish new version"
                : published
                  ? legacyPublication
                    ? "Published read-only"
                    : "Published"
                  : "Publish"}
            </span>
            <ChevronDown />
          </button>
        </div>
      </header>

      <div
        className={`project-studio-layout tab-${tab}${
          tab === "code" && project.projectV2?.manifest.framework.name === "nextjs"
            ? " v2-builder-active"
            : ""
        }`}
      >
        <aside className="studio-rail">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                className={`${tab === item.id ? "active" : ""}${item.mobileOnly ? " mobile-preview-tab" : ""}`.trim()}
                key={item.id}
                onClick={() => openInspectorTab(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="rail-foundation">
            <span title="DropsTab attached">
              <Database />
            </span>
            <span title="Drops Bot setup available">
              <Bot />
            </span>
          </div>
        </aside>

        {project.projectV2?.manifest.framework.name === "nextjs" ? (
          <section
            className="project-v2-studio-host"
            hidden={tab !== "code"}
          >
            <ProjectV2StudioSurface
              key={project.projectV2.id}
              onAgentEvent={recordBuilderAgentEvent}
              onNotify={setToast}
              onProjectChange={adoptProjectV2}
              project={project.projectV2}
              provider={activeProvider}
            />
          </section>
        ) : null}

        <aside className="studio-inspector">
          {tab === "project" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <Sparkles /> Drops Director
                </span>
                <b>FREE</b>
              </div>
              <p className="inspector-copy">
                Shapes your brief into a category-aware plan before changes
                reach the working app.
              </p>
              <div className="director-pipeline">
                <span className="done">
                  <i>1</i>
                  <b>Brief</b>
                  <small>{preset.shortTitle}</small>
                </span>
                <span className="done">
                  <i>2</i>
                  <b>Experience</b>
                  <small>
                    {game ? game.genre.replace(/-/g, " ") : preset.output}
                  </small>
                </span>
                <span className="done">
                  <i>3</i>
                  <b>Foundation</b>
                  <small>DropsTab × guided Drops Bot setup</small>
                </span>
                <span
                  className={
                    releaseEvidenceReady
                      ? "done"
                      : ""
                  }
                >
                  <i>4</i>
                  <b>Ship</b>
                  <small>
                    {builderEvidence.verified
                      ? `${builderEvidence.passed}/${builderEvidence.total} builder checks`
                      : hasProjectV2
                        ? `${builderEvidence.passed}/${builderEvidence.total} checks · run Builder`
                        : `${quality.score}/100 legacy publish quality`}
                  </small>
                </span>
              </div>
              <label>
                Product name
                <input
                  value={project.spec.name}
                  onChange={(event) =>
                    updateSpecQuiet((spec) => ({
                      ...spec,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Product promise
                <textarea
                  rows={4}
                  value={project.spec.tagline}
                  onChange={(event) =>
                    updateSpecQuiet((spec) => ({
                      ...spec,
                      tagline: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="experience-brief">
                <span>
                  <Layers3 /> Experience brief
                </span>
                <dl>
                  <div>
                    <dt>Archetype</dt>
                    <dd>
                      {project.spec.experience.archetype.replace(/-/g, " ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Layout</dt>
                    <dd>{project.spec.experience.layout}</dd>
                  </div>
                  <div>
                    <dt>Data view</dt>
                    <dd>{project.spec.experience.dataView}</dd>
                  </div>
                  <div>
                    <dt>Loop</dt>
                    <dd>{project.spec.experience.engagement}</dd>
                  </div>
                </dl>
                <p>{project.spec.experience.primaryLoop}</p>
                <div>
                  {project.spec.experience.modules.map((module) => (
                    <i key={module}>{module}</i>
                  ))}
                </div>
              </div>
              <div className="blueprint-inspector">
                <span>
                  <WandSparkles /> AI product blueprint
                </span>
                <p>{project.spec.blueprint.visualConcept}</p>
                <dl>
                  <div>
                    <dt>Native screens</dt>
                    <dd>{project.spec.blueprint.screens.join(" · ")}</dd>
                  </div>
                  <div>
                    <dt>Working interactions</dt>
                    <dd>{project.spec.blueprint.interactions.join(" · ")}</dd>
                  </div>
                  <div>
                    <dt>DropsTab foundation</dt>
                    <dd>{project.spec.blueprint.dropsTabUse.join(" · ")}</dd>
                  </div>
                  <div>
                    <dt>Drops Bot setup recipe</dt>
                    <dd>{project.spec.blueprint.dropsBotUse.join(" · ")}</dd>
                  </div>
                  {project.spec.blueprint.revisionNotes?.length ? (
                    <div>
                      <dt>Revision trade-offs</dt>
                      <dd>
                        {project.spec.blueprint.revisionNotes.join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              {game && (
                <div className="game-brief">
                  <span>
                    <Gamepad2 /> Game brief
                  </span>
                  <dl>
                    <div>
                      <dt>Genre</dt>
                      <dd>{game.genre.replace(/-/g, " ")}</dd>
                    </div>
                    <div>
                      <dt>World</dt>
                      <dd>{game.world.replace(/-/g, " ")}</dd>
                    </div>
                    <div>
                      <dt>Art</dt>
                      <dd>{game.artStyle}</dd>
                    </div>
                    <div>
                      <dt>Loop</dt>
                      <dd>
                        {game.roundSeconds}s · {game.difficulty}
                      </dd>
                    </div>
                  </dl>
                  <p>{game.gameLoop}</p>
                </div>
              )}
              <button
                className="inspector-primary"
                type="button"
                onClick={() =>
                  void sendDirectorPrompt(
                    game
                      ? "Make this game feel more visual, playful and shareable"
                      : "Improve the product hierarchy and primary user loop",
                  )
                }
              >
                <WandSparkles /> Ask Director to improve it
              </button>
            </section>
          )}

          {tab === "design" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <Palette /> Design Canvas
                </span>
                <b className="free-badge">FREE</b>
              </div>
              <button
                type="button"
                className={`design-mode-control ${designMode ? "active" : ""}`}
                onClick={() => setDesignMode((value) => !value)}
              >
                <MousePointer2 />
                <span>
                  <strong>
                    {designMode ? "Selecting elements" : "Select in preview"}
                  </strong>
                  <small>
                    {designMode
                      ? "Click to inspect · double-click text to type"
                      : "Choose any text, image, button or block"}
                  </small>
                </span>
                <i>{designMode ? "ON" : "OFF"}</i>
              </button>
              {selectedBlock?.kind === "block" && (
                <div className="selected-inspector">
                  <div>
                    <span>Selected block</span>
                    <strong>
                      <Layers3 /> {selectedBlock.label}
                    </strong>
                  </div>
                  <label>
                    Variant
                    <select
                      value={
                        project.spec.blocks[selectedBlock.id]?.variant ??
                        "default"
                      }
                      onChange={(event) =>
                        updateSelectedBlock({
                          variant: event.target.value as
                            | "default"
                            | "compact"
                            | "wide"
                            | "spotlight",
                        })
                      }
                    >
                      <option value="default">Default</option>
                      <option value="compact">Compact</option>
                      <option value="wide">Wide</option>
                      <option value="spotlight">Spotlight</option>
                    </select>
                  </label>
                  <label className="toggle-line">
                    <input
                      type="checkbox"
                      checked={
                        project.spec.blocks[selectedBlock.id]?.visible !== false
                      }
                      onChange={(event) =>
                        updateSelectedBlock({ visible: event.target.checked })
                      }
                    />{" "}
                    Visible in the app
                  </label>
                </div>
              )}
              {selectedBlock?.kind === "element" && (
                <div className="selected-inspector element-inspector">
                  <div className="element-inspector-head">
                    <span>Selected {selectedBlock.tag}</span>
                    <strong>
                      <MousePointer2 /> {selectedBlock.label}
                    </strong>
                    <button type="button" onClick={resetSelectedElement}>
                      Reset
                    </button>
                  </div>
                  {selectedBlock.textEditable && (
                    <label>
                      Text
                      <textarea
                        rows={3}
                        value={selectedBlock.text}
                        onChange={(event) =>
                          previewSelectedElement({ text: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {selectedBlock.imageEditable && (
                    <label className="element-image-upload">
                      <ImageIcon />
                      <span>
                        <strong>Replace this image</strong>
                        <small>
                          PNG, JPG or WebP · optimized into the published app
                        </small>
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void previewElementImage(event.target.files?.[0])
                        }
                      />
                    </label>
                  )}
                  <div className="element-control-grid">
                    <label>
                      Font size
                      <input
                        type="number"
                        min="12"
                        max="120"
                        value={selectedBlock.styles.fontSize}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { fontSize: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Weight
                      <select
                        value={selectedBlock.styles.fontWeight}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { fontWeight: Number(event.target.value) },
                          })
                        }
                      >
                        <option value="400">Regular</option>
                        <option value="500">Medium</option>
                        <option value="600">Semibold</option>
                        <option value="700">Bold</option>
                        <option value="800">Extra bold</option>
                        <option value="900">Black</option>
                      </select>
                    </label>
                    <label>
                      Text color
                      <span className="element-color">
                        <input
                          type="color"
                          value={colorInputValue(selectedBlock.styles.color)}
                          onChange={(event) =>
                            previewSelectedElement({
                              styles: { color: event.target.value },
                            })
                          }
                        />
                        <b>{selectedBlock.styles.color}</b>
                      </span>
                    </label>
                    <label>
                      Background
                      <span className="element-color">
                        <input
                          type="color"
                          value={colorInputValue(
                            selectedBlock.styles.backgroundColor,
                          )}
                          onChange={(event) =>
                            previewSelectedElement({
                              styles: { backgroundColor: event.target.value },
                            })
                          }
                        />
                        <b>
                          {selectedBlock.styles.backgroundColor ===
                          "transparent"
                            ? "No fill"
                            : selectedBlock.styles.backgroundColor}
                        </b>
                        <button
                          type="button"
                          aria-label="Remove background fill"
                          onClick={() =>
                            previewSelectedElement({
                              styles: { backgroundColor: "transparent" },
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    </label>
                    <label>
                      Alignment
                      <select
                        value={selectedBlock.styles.textAlign}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: {
                              textAlign: event.target
                                .value as ProjectElementConfig["textAlign"],
                            },
                          })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      Width %
                      <input
                        type="number"
                        min="10"
                        max="100"
                        value={selectedBlock.styles.width}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { width: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Padding
                      <input
                        type="number"
                        min="0"
                        max="80"
                        value={selectedBlock.styles.padding}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { padding: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Corner radius
                      <input
                        type="number"
                        min="0"
                        max="80"
                        value={selectedBlock.styles.borderRadius}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: {
                              borderRadius: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Move X
                      <input
                        type="number"
                        min="-500"
                        max="500"
                        value={selectedBlock.styles.translateX}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { translateX: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Move Y
                      <input
                        type="number"
                        min="-500"
                        max="500"
                        value={selectedBlock.styles.translateY}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { translateY: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Opacity
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={selectedBlock.styles.opacity}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { opacity: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      Layer
                      <input
                        type="number"
                        min="-10"
                        max="100"
                        value={selectedBlock.styles.zIndex}
                        onChange={(event) =>
                          previewSelectedElement({
                            styles: { zIndex: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="toggle-line">
                    <input
                      type="checkbox"
                      checked={selectedBlock.styles.visible}
                      onChange={(event) =>
                        previewSelectedElement({
                          styles: { visible: event.target.checked },
                        })
                      }
                    />{" "}
                    Visible in the app
                  </label>
                  <div className="element-actions">
                    <button type="button" onClick={commitSelectedElement}>
                      <Check /> Save version
                    </button>
                    <button type="button" onClick={() => openInspectorTab("director")}>
                      <Sparkles /> Edit with AI
                    </button>
                  </div>
                </div>
              )}
              <span className="section-label">Design directions</span>
              <div className="design-kits">
                {DESIGN_DIRECTIONS.map((direction) => (
                  <button
                    type="button"
                    className={
                      project.spec.design.kit === direction.id ? "active" : ""
                    }
                    key={direction.id}
                    onClick={() => applyKit(direction.id)}
                  >
                    <span
                      className="kit-preview"
                      style={{
                        background: `linear-gradient(135deg,${direction.palette.join(",")})`,
                      }}
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      <strong>{direction.name}</strong>
                      <small>{direction.bestFor}</small>
                    </span>
                    {project.spec.design.kit === direction.id && <Check />}
                  </button>
                ))}
              </div>
              <div className="design-tokens">
                <label>
                  Accent
                  <div className="color-field">
                    <input
                      type="color"
                      value={project.spec.theme.accent}
                      onChange={(event) =>
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          theme: { ...spec.theme, accent: event.target.value },
                        }))
                      }
                    />
                    <input
                      value={project.spec.theme.accent}
                      onChange={(event) =>
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          theme: { ...spec.theme, accent: event.target.value },
                        }))
                      }
                    />
                  </div>
                </label>
                <label>
                  Density
                  <select
                    value={project.spec.design.density}
                    onChange={(event) =>
                      updateSpecQuiet((spec) => ({
                        ...spec,
                        design: {
                          ...spec.design,
                          density: event.target
                            .value as GeneratedProjectSpec["design"]["density"],
                        },
                      }))
                    }
                  >
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                    <option value="cinematic">Cinematic</option>
                  </select>
                </label>
                <label>
                  Motion
                  <select
                    value={project.spec.design.motion}
                    onChange={(event) =>
                      updateSpecQuiet((spec) => ({
                        ...spec,
                        design: {
                          ...spec.design,
                          motion: event.target
                            .value as GeneratedProjectSpec["design"]["motion"],
                        },
                      }))
                    }
                  >
                    <option value="reduced">Reduced</option>
                    <option value="smooth">Smooth</option>
                    <option value="expressive">Expressive</option>
                  </select>
                </label>
              </div>
              <label className="art-upload">
                <ImageIcon />
                <span>
                  <strong>
                    {game
                      ? "Replace game world artwork"
                      : "Add product hero artwork"}
                  </strong>
                  <small>Auto-optimized · included in public app and ZIP</small>
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    void handleArtUpload(event.target.files?.[0])
                  }
                />
              </label>
            </section>
          )}

          {tab === "data" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <Database /> Data foundation
                </span>
                <BadgeCheck />
              </div>
              <p className="inspector-copy">
                DropsTab Public API is the primary production data contract. A
                clearly labelled public fallback keeps exported demos alive when
                no platform or user key is available.
              </p>
              <div className="foundation-card">
                <span>
                  <Database />
                </span>
                <div>
                  <strong>DropsTab Public API adapter</strong>
                  <small>Prices · change · market cap · context</small>
                </div>
                <b>API READY</b>
              </div>
              <div className="data-budget">
                <ShieldCheck />
                <div>
                  <strong>Low-consumption policy</strong>
                  <span>
                    15-minute shared platform cache · no generated-app polling ·
                    manual BYOK refresh only
                  </span>
                </div>
                <b>≤ 96/day</b>
              </div>
              <div className="asset-list">
                {project.spec.market.map((coin) => (
                  <div key={coin.symbol}>
                    <span>{coin.symbol.slice(0, 2)}</span>
                    <div>
                      <strong>{coin.symbol}</strong>
                      <small>{coin.name}</small>
                    </div>
                    <b
                      className={
                        coin.change === null
                          ? undefined
                          : coin.change >= 0
                            ? "up"
                            : "down"
                      }
                    >
                      {coin.change === null
                        ? "—"
                        : `${coin.change >= 0 ? "+" : ""}${coin.change.toFixed(2)}%`}
                    </b>
                  </div>
                ))}
              </div>
              <div className="safety-note">
                <ShieldCheck />
                <span>
                  <strong>No secret in the output</strong>
                  <small>
                    Connected keys stay session-only and never enter publish or
                    ZIP.
                  </small>
                </span>
              </div>
              <button
                className="inspector-secondary"
                type="button"
                onClick={() =>
                  window.open(
                    "https://api-docs.dropstab.com/",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <Database /> DropsTab API docs <ExternalLink />
              </button>
            </section>
          )}

          {tab === "logic" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <Blocks /> Product logic
                </span>
                <Zap />
              </div>
              <p className="inspector-copy">
                Category controls and experience architecture recompile real
                behavior, not a static preview.
              </p>
              {preset.fields.map((field) => (
                <label key={field.id}>
                  {field.label}
                  <select
                    value={project.spec.values[field.id] || field.value}
                    onChange={(event) =>
                      updateSpecQuiet((spec) =>
                        applyPresetFieldValue(
                          spec,
                          field.id,
                          event.target.value,
                        ),
                      )
                    }
                  >
                    {field.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              ))}
              <span className="section-label">Professional experience</span>
              <div className="logic-grid">
                <label>
                  Layout
                  <select
                    value={project.spec.experience.layout}
                    onChange={(event) =>
                      commitSpec(
                        validateProjectSpec({
                          ...project.spec,
                          experience: {
                            ...project.spec.experience,
                            layout: event.target.value,
                          },
                        }),
                        "Changed experience layout",
                      )
                    }
                  >
                    <option value="focus">Focus</option>
                    <option value="split">Split workflow</option>
                    <option value="dashboard">Dashboard</option>
                    <option value="feed">Feed</option>
                    <option value="spatial">Spatial</option>
                  </select>
                </label>
                <label>
                  Data view
                  <select
                    value={project.spec.experience.dataView}
                    onChange={(event) =>
                      commitSpec(
                        validateProjectSpec({
                          ...project.spec,
                          experience: {
                            ...project.spec.experience,
                            dataView: event.target.value,
                          },
                        }),
                        "Changed data presentation",
                      )
                    }
                  >
                    <option value="cards">Cards</option>
                    <option value="table">Table</option>
                    <option value="timeline">Timeline</option>
                    <option value="graph">Graph</option>
                    <option value="map">Map</option>
                  </select>
                </label>
                <label>
                  Engagement
                  <select
                    value={project.spec.experience.engagement}
                    onChange={(event) =>
                      commitSpec(
                        validateProjectSpec({
                          ...project.spec,
                          experience: {
                            ...project.spec.experience,
                            engagement: event.target.value,
                          },
                        }),
                        "Changed engagement model",
                      )
                    }
                  >
                    <option value="realtime">Real-time</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="social">Social</option>
                    <option value="personal">Personal</option>
                  </select>
                </label>
                <label>
                  Audience
                  <input
                    value={project.spec.experience.audience}
                    onChange={(event) =>
                      updateSpecQuiet((spec) => ({
                        ...spec,
                        experience: {
                          ...spec.experience,
                          audience: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                Primary user loop
                <textarea
                  rows={3}
                  value={project.spec.experience.primaryLoop}
                  onChange={(event) =>
                    updateSpecQuiet((spec) => ({
                      ...spec,
                      experience: {
                        ...spec.experience,
                        primaryLoop: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <span className="section-label">Product modules</span>
              <div className="module-editor">
                {project.spec.experience.modules.map((module, index) => (
                  <div key={`${module}-${index}`}>
                    <Check />
                    <input
                      aria-label={`Module ${index + 1}`}
                      value={module}
                      onChange={(event) =>
                        updateModule(index, event.target.value)
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Move ${module} up`}
                      disabled={index === 0}
                      onClick={() => moveModule(index, -1)}
                    >
                      <ArrowUp />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${module} down`}
                      disabled={
                        index === project.spec.experience.modules.length - 1
                      }
                      onClick={() => moveModule(index, 1)}
                    >
                      <ArrowDown />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${module}`}
                      disabled={project.spec.experience.modules.length <= 1}
                      onClick={() => removeModule(index)}
                    >
                      <X />
                    </button>
                  </div>
                ))}
                <div className="module-add">
                  <Plus />
                  <input
                    aria-label="New product module"
                    value={newModule}
                    placeholder="Add module…"
                    onChange={(event) => setNewModule(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addModule();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      !newModule.trim() ||
                      project.spec.experience.modules.length >= 12
                    }
                    onClick={addModule}
                  >
                    Add
                  </button>
                </div>
              </div>
              {game && (
                <>
                  <span className="section-label">Game system</span>
                  <div className="logic-grid">
                    <label>
                      Difficulty
                      <select
                        value={game.difficulty}
                        onChange={(event) =>
                          commitSpec(
                            validateProjectSpec({
                              ...project.spec,
                              gameDirection: {
                                ...game,
                                difficulty: event.target.value,
                              },
                            }),
                            "Changed game difficulty",
                          )
                        }
                      >
                        <option value="casual">Casual</option>
                        <option value="normal">Normal</option>
                        <option value="expert">Expert</option>
                      </select>
                    </label>
                    <label>
                      Round timer
                      <input
                        type="number"
                        min={5}
                        max={120}
                        value={game.roundSeconds}
                        onChange={(event) =>
                          updateSpecQuiet((spec) => ({
                            ...spec,
                            gameDirection: spec.gameDirection
                              ? {
                                  ...spec.gameDirection,
                                  roundSeconds: Number(event.target.value),
                                }
                              : undefined,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Core mechanic
                    <textarea
                      rows={3}
                      value={game.mechanic}
                      onChange={(event) =>
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          gameDirection: spec.gameDirection
                            ? {
                                ...spec.gameDirection,
                                mechanic: event.target.value,
                              }
                            : undefined,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Character and world
                    <textarea
                      rows={3}
                      value={`${game.protagonist}\n\n${game.scene}`}
                      onChange={(event) => {
                        const [protagonist, ...scene] =
                          event.target.value.split("\n\n");
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          gameDirection: spec.gameDirection
                            ? {
                                ...spec.gameDirection,
                                protagonist,
                                scene:
                                  scene.join("\n\n") ||
                                  spec.gameDirection.scene,
                              }
                            : undefined,
                        }));
                      }}
                    />
                  </label>
                  <label>
                    Art direction
                    <textarea
                      rows={3}
                      value={game.artDirection}
                      onChange={(event) =>
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          gameDirection: spec.gameDirection
                            ? {
                                ...spec.gameDirection,
                                artDirection: event.target.value,
                              }
                            : undefined,
                        }))
                      }
                    />
                  </label>
                  <label>
                    DropsTab gameplay mapping
                    <textarea
                      rows={3}
                      value={game.dataUse}
                      onChange={(event) =>
                        updateSpecQuiet((spec) => ({
                          ...spec,
                          gameDirection: spec.gameDirection
                            ? {
                                ...spec.gameDirection,
                                dataUse: event.target.value,
                              }
                            : undefined,
                        }))
                      }
                    />
                  </label>
                </>
              )}
              <div className="tool-stack">
                <span>Working capabilities</span>
                {project.spec.tools.map((tool) => (
                  <div key={tool}>
                    <Check /> {tool}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "connections" && (
            <section className="inspector-section connections-inspector">
              <div className="inspector-heading">
                <span>
                  <KeyRound /> Connections
                </span>
                <b>SESSION SAFE</b>
              </div>
              <p className="inspector-copy">
                Your models, data, Telegram accounts and deployment targets in
                one place. Connected secrets never enter the generated app.
              </p>
              <div className="connection-summary-grid">
                <button
                  type="button"
                  onClick={() => openConnectionsHub()}
                >
                  <BrainCircuit />
                  <span>
                    <strong>AI models</strong>
                    <small>
                      {modelLabels[activeProvider]} · OpenAI, Claude,
                      OpenRouter, Kimi or custom
                    </small>
                  </span>
                  <ChevronRight />
                </button>
                <button
                  type="button"
                  onClick={() => openConnectionsHub("dropstab")}
                >
                  <Database />
                  <span>
                    <strong>DropsTab data</strong>
                    <small>Platform cache or your own API key</small>
                  </span>
                  <ChevronRight />
                </button>
                <button type="button" onClick={openPublish}>
                  <Cloud />
                  <span>
                    <strong>Hosting and source</strong>
                    <small>
                      Free public URL, Vercel, Cloudflare and GitHub export
                    </small>
                  </span>
                  <ChevronRight />
                </button>
              </div>
              <StudioAccountTeamPanel
                project={project}
                onApplyProject={applyTeamProject}
                onToast={setToast}
              />
              <DropsBotWebhookConnection
                projectId={project.id}
                onToast={setToast}
              />
              <TelegramChannelWizard
                defaultTitle={project.spec.name}
                defaultAbout={`${project.spec.tagline} Prepared with Drops Studio and DropsTab context.`}
                defaultFirstPost={`${project.spec.name}\n\n${project.spec.tagline}\n\nTelegram delivery by the selected bot. Official Drops Bot Profiles require separate setup.`}
              />
            </section>
          )}

          {tab === "quality" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <ShieldCheck /> Release checks
                </span>
                <b
                  className={
                    releaseEvidenceReady
                      ? "quality-pass"
                      : "quality-fail"
                  }
                >
                  {hasProjectV2
                    ? `${builderEvidence.passed}/${builderEvidence.total}`
                    : `${quality.score}/100`}
                </b>
              </div>
              <div
                className={`quality-hero ${releaseEvidenceReady ? "passed" : "failed"}`}
              >
                <span>
                  <ShieldCheck />
                </span>
                <div>
                  <strong>
                    {builderEvidence.verified
                      ? "Project V2 build verified"
                      : hasProjectV2
                      ? "Project V2 build pending"
                      : quality.readyToPublish
                      ? releaseLabel
                      : "Build needs attention"}
                  </strong>
                  <small>
                    {builderEvidence.verified
                      ? "Typecheck, lint, tests, production build and live Sandbox preview passed for this file revision. The legacy score below applies only to standalone /p publishing."
                      : hasProjectV2
                      ? `${builderEvidence.passed}/${builderEvidence.total} current-revision checks have verified evidence. Open Builder to run the remaining checks and start the live preview.`
                      : externalSetup
                      ? "The web setup app can publish, but the external outcome is not live until it is connected and verified."
                      : "Deterministic checks run on every edit and before every publish."}
                  </small>
                </div>
              </div>
              <div className="experience-brief">
                <span>
                  <Zap /> Reality contract
                </span>
                <p>{reality.deliverable}</p>
                <dl>
                  <div>
                    <dt>Works now</dt>
                    <dd>{reality.worksNow.join(" · ")}</dd>
                  </div>
                  <div>
                    <dt>Requires</dt>
                    <dd>{reality.requires.join(" · ")}</dd>
                  </div>
                </dl>
              </div>
              <div className="quality-list">
                {quality.checks.map((item) => (
                  <div
                    className={item.passed ? "passed" : "failed"}
                    key={item.id}
                  >
                    <span>{item.passed ? <Check /> : <X />}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                    {item.critical && <b>GATE</b>}
                  </div>
                ))}
              </div>
              <button
                className="inspector-secondary"
                type="button"
                onClick={() => openSource("quality-report.json")}
              >
                <Code2 /> Inspect quality-report.json
              </button>
            </section>
          )}

          {tab === "code" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <Code2 /> Code & Git
                </span>
                <b>OWNED</b>
              </div>
              <div className="file-tree">
                <button type="button" onClick={() => openSource("index.html")}>
                  <Code2 /> index.html <b>editable</b>
                </button>
                <button
                  type="button"
                  onClick={() => openSource("project.json")}
                >
                  <Settings2 /> project.json <b>editable</b>
                </button>
                <button
                  type="button"
                  onClick={() => openSource("quality-report.json")}
                >
                  <ShieldCheck /> quality-report.json <b>{quality.score}/100</b>
                </button>
                <span>
                  <GitBranch /> .github/workflows/pages.yml <b>deploy</b>
                </span>
                <span>
                  <Cloud /> vercel · netlify · wrangler <b>ready</b>
                </span>
              </div>
              <div className="git-card">
                <div>
                  <GitBranch />
                  <span>
                    <strong>Git-ready workspace</strong>
                    <small>{checkpoints.length} local checkpoints · not Git commits</small>
                  </span>
                </div>
                <p>
                  ZIP contains the runnable app, validated project source,
                  integration manifest, smoke test and deployment workflows.
                  Two-way GitHub OAuth remains an honest infrastructure upgrade.
                </p>
                <button type="button" onClick={() => downloadSource("github")}>
                  <GitCommit /> Export & continue to GitHub <ExternalLink />
                </button>
              </div>
              <button
                className="inspector-secondary"
                type="button"
                onClick={() => openSource("index.html")}
              >
                <Code2 /> Open source workspace
              </button>
              <button
                className="inspector-primary"
                type="button"
                onClick={() => downloadSource()}
              >
                <Download /> Download runnable app + source
              </button>
            </section>
          )}

          {tab === "history" && (
            <section className="inspector-section">
              <div className="inspector-heading">
                <span>
                  <History /> Checkpoints
                </span>
                <b>
                  {checkpoints.length} active · {futureCheckpoints.length} redo
                </b>
              </div>
              <p className="inspector-copy">
                Undo keeps later versions in a persistent redo lane. A new edit
                after Undo creates a branch and replaces that redo lane.
              </p>
              <div className="checkpoint-list">
                {[...checkpoints].reverse().map((checkpoint, index) => (
                  <button
                    type="button"
                    key={checkpoint.id}
                    disabled={index === 0}
                    onClick={() => restoreCheckpoint(checkpoint)}
                  >
                    <span>
                      <i className={checkpoint.source} />
                      <strong>{checkpoint.label}</strong>
                      <small>
                        {new Date(checkpoint.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {checkpoint.source}
                        {checkpoint.branch
                          ? ` · branch replaced ${checkpoint.branch.replacedCheckpointCount} redo version${checkpoint.branch.replacedCheckpointCount === 1 ? "" : "s"}`
                          : ""}
                      </small>
                    </span>
                    {index === 0 ? <b>Current</b> : <Undo2 />}
                  </button>
                ))}
                {futureCheckpoints.map((checkpoint, index) => (
                  <button
                    type="button"
                    key={`future-${checkpoint.id}`}
                    disabled={index !== 0}
                    onClick={redo}
                  >
                    <span>
                      <i className={checkpoint.source} />
                      <strong>{checkpoint.label}</strong>
                      <small>
                        Redo lane ·{" "}
                        {index === 0 ? "next" : `${index + 1} steps ahead`}
                      </small>
                    </span>
                    {index === 0 ? <Redo2 /> : <b>Future</b>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <section className="runtime-stage">
          <div className="stage-toolbar">
            <div className="device-switch">
              <button
                type="button"
                className={device === "desktop" ? "active" : ""}
                onClick={() => setDevice("desktop")}
              >
                <Monitor /> Desktop
              </button>
              <button
                type="button"
                className={device === "mobile" ? "active" : ""}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone /> Mobile
              </button>
            </div>
            <div>
              <span className="canvas-zoom-controls" role="group" aria-label="Preview zoom">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setCanvasZoom((value) => Math.max(60, value - 10))}
                >
                  <Minus />
                </button>
                <button
                  type="button"
                  aria-label="Reset preview zoom"
                  onClick={() => setCanvasZoom(100)}
                >
                  {canvasZoom}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setCanvasZoom((value) => Math.min(160, value + 10))}
                >
                  <Plus />
                </button>
              </span>
              <button
                type="button"
                className={designMode ? "active" : ""}
                onClick={() => setDesignMode((value) => !value)}
              >
                <MousePointer2 /> Design mode
              </button>
              <button type="button" onClick={() => openSource("index.html")}>
                <Code2 /> Code
              </button>
              <button
                type="button"
                className={
                  releaseEvidenceReady
                    ? "quality-ready"
                    : ""
                }
                onClick={() => setTab("quality")}
              >
                <ShieldCheck />
                {builderEvidence.verified
                  ? "Build verified"
                  : hasProjectV2
                    ? `Build pending ${builderEvidence.passed}/${builderEvidence.total}`
                    : `Legacy quality ${quality.score}`}
              </button>
              <button type="button" onClick={openRuntime}>
                <ExternalLink /> Fullscreen
              </button>
            </div>
          </div>
          <div className="runtime-canvas-scroll" tabIndex={0} aria-label="Scrollable and zoomable live application preview">
            <div
              className="runtime-canvas-viewport"
              style={{ zoom: canvasZoom / 100 } as React.CSSProperties}
            >
              <div
                className={`runtime-browser ${device}`}
                role="region"
                tabIndex={0}
                aria-label="Live application browser viewport"
              >
                <div className="browser-bar">
              <span>
                <i />
                <i />
                <i />
              </span>
              <strong>{project.spec.slug}.live</strong>
              <b
                role="status"
                aria-live="polite"
                data-runtime-ready={browserTelemetryReady ? "true" : "false"}
              >
                <i />
                <span className="runtime-preview-label">Live preview</span>
                <span className="runtime-ready-label">
                  {browserTelemetryReady
                    ? "Browser telemetry"
                    : "Loading preview"}
                </span>
              </b>
                </div>
                <iframe
                  ref={iframeRef}
                  key={`${runtimeRevision}:${runtimePreviewUrl ?? "local"}:${Boolean(previewGameAssets.background)}:${Boolean(previewGameAssets.sprite)}`}
                  title={`${project.spec.name} live application`}
                  src={runtimePreviewUrl ?? undefined}
                  srcDoc={runtimePreviewUrl ? undefined : runtimeSrcDoc}
                  sandbox={runtimePreviewUrl ? "allow-scripts allow-forms allow-downloads allow-same-origin" : "allow-scripts allow-forms allow-downloads"}
                  onLoad={() => {
                    if (!runtimePreviewUrl) {
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: "drops-studio-design-mode", enabled: designMode },
                        "*",
                      );
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="assistant-panel">
          <header>
            <span>
              <span className="director-avatar">
                <Sparkles />
              </span>
              <span>
                <strong>Drops Director</strong>
                <small>
                  {modelLabels[activeProvider]} · project context ready
                </small>
              </span>
            </span>
            <button
              type="button"
              aria-label="Open connections"
              onClick={() => setTab("connections")}
            >
              <Settings2 />
            </button>
          </header>
          {selectedBlock && (
            <div className="chat-context">
              <MousePointer2 />
              <span>
                Editing context: <strong>{selectedBlock.label}</strong>
              </span>
              <button type="button" onClick={() => setSelectedBlock(null)}>
                <X />
              </button>
            </div>
          )}
          <div className="conversation" role="log" aria-label="Drops Director conversation" tabIndex={0}>
            {(project.conversation?.length ?? 0) <= 1 && (
              <div className="assistant-guide">
                <strong>Build with context, not from zero</strong>
                <p>
                  I already know this preset’s user flow, modules, data sources
                  and safe actions.
                </p>
                <span>
                  <MousePointer2 />
                  <b>Select a block</b>
                  <small>then describe a targeted change</small>
                </span>
                <span>
                  <Palette />
                  <b>Ask for directions</b>
                  <small>cartoon, terminal, editorial, glass</small>
                </span>
                <span>
                  <Blocks />
                  <b>Change behavior</b>
                  <small>layout, data view, rules and social loop</small>
                </span>
                <span>
                  <Undo2 />
                  <b>Experiment safely</b>
                  <small>every Apply creates a checkpoint</small>
                </span>
              </div>
            )}
            {(project.conversation ?? []).map((message) => (
              <article
                className={`${message.role}${message.id.startsWith("builder-") ? " build-event" : ""}`}
                key={message.id}
              >
                <span>
                  {message.role === "assistant" ? <Sparkles /> : "You"}
                </span>
                <p>{message.content}</p>
                {message.proposal && (
                  <div className="proposal-card">
                    <header>
                      <span>
                        <WandSparkles />
                        <strong>{message.proposal.label}</strong>
                      </span>
                      <b>Preview</b>
                    </header>
                    <ul>
                      {message.proposal.summary.map((item) => (
                        <li key={item}>
                          <Check />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <div>
                      <button
                        type="button"
                        onClick={() => dismissProposal(message)}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => applyChatProposal(message)}
                      >
                        <Check /> Apply changes
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
            {directing && (
              <article className="assistant thinking">
                <span>
                  <LoaderCircle className="spin" />
                </span>
                <p>
                  Planning a bounded change set, checking the product category
                  and preserving Drops foundations…
                </p>
              </article>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="quick-prompts">
            {quickPrompts.map((prompt) => (
              <button
                type="button"
                key={prompt}
                onClick={() => void sendDirectorPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendDirectorPrompt();
            }}
          >
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={
                selectedBlock
                  ? `Tell Director how to change ${selectedBlock.label}…`
                  : "Describe a product, visual or behavior change…"
              }
              rows={3}
            />
            <footer>
              <span>
                <Sparkles /> {modelLabels[activeProvider]}
              </span>
              <button
                type="submit"
                disabled={!chatInput.trim() || directing}
                aria-label="Send change request"
              >
                <Send />
              </button>
            </footer>
          </form>
          <div className="assistant-foot">
            <ShieldCheck /> Suggestions never change the app until you press
            Apply.
          </div>
        </aside>
      </div>

      <footer
        className="project-statusbar"
        role="region"
        aria-label="Project status"
        tabIndex={0}
      >
        <span data-sync-status={projectSyncStatus}>
          {projectSyncStatus === "saving" ? (
            <LoaderCircle className="spin" />
          ) : projectSyncStatus === "synced" ? (
            <Cloud />
          ) : projectSyncStatus === "conflict" ||
            projectSyncStatus === "error" ? (
            <X />
          ) : (
            <Check />
          )}{" "}
          {projectSyncStatus === "saving"
            ? "Saving…"
            : projectSyncStatus === "synced"
              ? "Saved to cloud"
              : projectSyncStatus === "conflict"
                ? "Sync conflict"
                : projectSyncStatus === "error"
                  ? "Save failed"
                  : "Saved in browser"}{" "}
          <small>
            {new Date(project.updatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        </span>
        <span>
          <Database /> DropsTab data <b>15 min</b>
        </span>
        <span>
          <Bot /> Drops Bot <strong>{externalSetup ? "Needs setup" : "Guided handoff"}</strong>
        </span>
        <span>
          <ShieldCheck />
          {hasProjectV2 ? "Builder" : "Legacy quality"}{" "}
          <strong>
            {hasProjectV2
              ? `${builderEvidence.passed}/${builderEvidence.total}`
              : `${quality.score}/100`}
          </strong>
        </span>
        <span className={externalSetup ? "" : "operational"}>
          <i /> {releaseLabel}
        </span>
      </footer>

      <ProjectWorkspaceDialog
        open={sourceOpen}
        workspaceId={project.id}
        workspace={activeWorkspace}
        activePath={sourceFile}
        draft={sourceDraft}
        qualityReport={JSON.stringify(quality, null, 2)}
        issues={sourceIssues}
        runningTask={workspaceRunningTask}
        receipt={workspaceRunReceipt}
        currentWorkspaceDigest={
          workspaceRunDigestEvidence?.project === project
            && workspaceRunDigestEvidence.receipt === workspaceRunReceipt
            ? workspaceRunDigestEvidence.digest
            : null
        }
        runError={workspaceRunError}
        aiPrompt={workspaceAiPrompt}
        aiRunning={workspaceAiRunning}
        aiError={workspaceAiError}
        aiEvidence={workspaceAiEvidence}
        aiQuota={workspaceAiQuota}
        onOpenChange={(open) => {
          setSourceOpen(open);
          if (!open) {
            window.requestAnimationFrame(() =>
              sourceReturnFocusRef.current?.focus(),
            );
          }
        }}
        onSelectPath={(path) => {
          setSourceFile(path);
          setSourceIssues([]);
          setSourceDraft(
            activeWorkspace.files.find((file) => file.path === path)?.content ??
              "",
          );
        }}
        onDraftChange={(value) => {
          setSourceDraft(value);
          setSourceIssues([]);
        }}
        onApply={
          sourceFile === "project.json" ? applyProjectJson : applyRuntimeHtml
        }
        onCreateFile={createWorkspaceFile}
        onDeleteFile={removeWorkspaceFile}
        onRunTask={(task) => void runWorkspaceTask(task)}
        onAiPromptChange={setWorkspaceAiPrompt}
        onGenerateAiPatch={() => void generateWorkspacePatch()}
        onDownload={() => void downloadSource()}
        onToast={setToast}
      />

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="studio-dialog-overlay" />
          <Dialog.Content
            className="publish-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              publishReturnFocusRef.current?.focus();
            }}
          >
            <header>
              <div>
                <Dialog.Title>
                  {externalSetup
                    ? "Publish the real setup app"
                    : researchOnly
                      ? "Publish the research app"
                      : "Publish a working product"}
                </Dialog.Title>
                <Dialog.Description>
                  {externalSetup
                    ? "The public web app is real; the external destination stays pending until the user connects and verifies it."
                    : "Free public app now, professional hosting whenever you need it."}
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close publish dialog">
                <X />
              </Dialog.Close>
            </header>
            <div className="publish-grid">
              <section
                className={`host-card cloud-card ${published && !dirty ? "published" : ""}`}
              >
                <div className="host-title">
                  <span>
                    <Cloud />
                  </span>
                  <div>
                    <strong>Free Drops Studio Cloud</strong>
                    <small>
                      {externalSetup
                        ? "Working setup app · instant public link"
                        : "Working app · instant public link"}
                    </small>
                  </div>
                  <b>FREE</b>
                </div>
                <ul>
                  <li>
                    <Check />{" "}
                    {externalSetup
                      ? "Public configuration and verification app"
                      : "Public playable/useable app"}
                  </li>
                  <li>
                    <Check /> Global edge delivery + HTTPS
                  </li>
                  <li>
                    <Check /> No connected secret included
                  </li>
                  <li>
                    <Check />{" "}
                    {managedPublication
                      ? "Update or unpublish from this browser"
                      : legacyPublication
                        ? "Read-only legacy link"
                        : "Browser-managed updates after first publish"}
                  </li>
                </ul>
                {externalSetup && (
                  <div className="safety-note">
                    <ShieldCheck />
                    <span>
                      <strong>Connect to finish launch</strong>
                      <small>{reality.requires.join(" · ")}</small>
                    </span>
                  </div>
                )}
                {legacyPublication && (
                  <div className="safety-note">
                    <ShieldCheck />
                    <span>
                      <strong>Read-only legacy link</strong>
                      <small>
                        Edits publish to a new managed URL. This browser cannot
                        change or remove the previous link.
                      </small>
                    </span>
                  </div>
                )}
                {published && (
                  <div className="public-url">
                    <span>
                      {legacyPublication
                        ? "Read-only legacy link"
                        : dirty
                          ? "Last public version"
                          : "Public URL"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        project.publishedUrl &&
                        window.open(
                          project.publishedUrl,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <strong>{project.publishedUrl}</strong>
                      <ExternalLink />
                    </button>
                    {managedPublication && (
                      <button
                        type="button"
                        onClick={() => void unpublish()}
                        disabled={publishing || unpublishing}
                      >
                        <strong>
                          {unpublishing
                            ? "Unpublishing…"
                            : "Unpublish public app"}
                        </strong>
                        <X />
                      </button>
                    )}
                  </div>
                )}
                <button
                  className="cloud-publish"
                  type="button"
                  onClick={handleCloudPublish}
                  disabled={publishing || unpublishing}
                >
                  {publishing ? (
                    <>
                      <LoaderCircle className="spin" /> Publishing…
                    </>
                  ) : unpublishing ? (
                    <>
                      <LoaderCircle className="spin" /> Unpublishing…
                    </>
                  ) : published && dirty ? (
                    <>
                      <UploadCloud />{" "}
                      {managedPublication
                        ? "Publish working update"
                        : "Publish new version"}
                    </>
                  ) : published ? (
                    <>
                      <BadgeCheck /> Open published app
                    </>
                  ) : (
                    <>
                      <Rocket /> Publish free now
                    </>
                  )}
                </button>
                {publishError && (
                  <p className="publish-error">{publishError}</p>
                )}
              </section>
              <section className="pro-hosts">
                <h3>Professional hosting</h3>
                <p>
                  Export the runnable static product to your own account and
                  domain. Vercel additionally supports the bundled server
                  adapters.
                </p>
                <button type="button" onClick={() => downloadSource("vercel")}>
                  <Globe2 />
                  <span>
                    <strong>Vercel</strong>
                    <small>Domains · analytics · serverless routes</small>
                  </span>
                  <ExternalLink />
                </button>
                <button
                  type="button"
                  onClick={() => downloadSource("cloudflare")}
                >
                  <Cloud />
                  <span>
                    <strong>Cloudflare Pages</strong>
                    <small>Static hosting · custom domain</small>
                  </span>
                  <ExternalLink />
                </button>
                <button type="button" onClick={() => downloadSource("netlify")}>
                  <Cloud />
                  <span>
                    <strong>Netlify</strong>
                    <small>Static hosting · custom domain</small>
                  </span>
                  <ExternalLink />
                </button>
                <button type="button" onClick={() => downloadSource("github")}>
                  <GitBranch />
                  <span>
                    <strong>GitHub</strong>
                    <small>Repository-owned source</small>
                  </span>
                  <ExternalLink />
                </button>
              </section>
            </div>
            <footer>
              <button type="button" onClick={() => downloadSource()}>
                <Download /> Download runnable app + source
              </button>
              <span>
                <ShieldCheck /> Published app and source contain no connected AI
                or Telegram keys.
              </span>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className={`project-toast ${toast ? "show" : ""}`} role="status">
        <Check />
        {toast}
      </div>
    </main>
  );
}
