"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's next/link shim currently duplicates React during browser navigation; plain anchors preserve a working route transition. */

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
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
  Copy,
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
  Undo2,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileProject } from "@/lib/project-compiler";
import { TelegramChannelWizard } from "@/components/telegram-channel-wizard";
import { createFreeDirectorProposal, createFreeElementDirectorProposal, DESIGN_DIRECTIONS, type DirectorProposal } from "@/lib/project-director";
import { createProjectArchive } from "@/lib/project-export";
import { applyAgentPlan, type AgentProductPlan } from "@/lib/product-blueprint";
import { evaluateProjectQuality } from "@/lib/project-quality";
import { getProductReality } from "@/lib/product-reality";
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
import { PROJECTS_STORAGE_KEY } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import { presets } from "@/lib/presets";

type InspectorTab = "director" | "design" | "data" | "logic" | "connections" | "quality" | "code" | "history";
type HostingProvider = "vercel" | "cloudflare" | "netlify" | "github";
type DeviceMode = "desktop" | "mobile";
type SourceFile = "index.html" | "project.json" | "quality-report.json";

type SelectedCanvasItem = {
  id: string;
  label: string;
  kind: "block";
} | {
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

const kitTokens: Record<ProjectDesignKit, { accent: string; surface: string; style: GeneratedProjectSpec["theme"]["style"]; font: GeneratedProjectSpec["design"]["font"]; radius: number }> = {
  "drops-precision": { accent: "#316cff", surface: "#071326", style: "precision", font: "inter", radius: 16 },
  "neon-arena": { accent: "#ee4f9b", surface: "#080d26", style: "cosmic", font: "space-grotesk", radius: 22 },
  "mascot-pop": { accent: "#ff5dac", surface: "#11102d", style: "playful", font: "space-grotesk", radius: 26 },
  "glass-signal": { accent: "#31c9ff", surface: "#06162c", style: "cosmic", font: "inter", radius: 20 },
  "editorial-alpha": { accent: "#3877ff", surface: "#11172a", style: "editorial", font: "inter", radius: 14 },
  "terminal-pro": { accent: "#19c98f", surface: "#050b14", style: "precision", font: "ibm-plex", radius: 5 },
};

const categoryPrompts: Record<GeneratedProjectSpec["presetId"], string[]> = {
  "action-engine": ["Turn this into a compact operator cockpit", "Make the trigger graph the spotlight", "Use a risk-first terminal design", "Add stronger decision audit hierarchy"],
  "alpha-channel": ["Make this feel like a premium creator studio", "Spotlight the sourced post composer", "Use an editorial Telegram preview", "Make verified channel setup clearer"],
  "morning-alpha": ["Make the brief premium and compact", "Use an editorial daily layout", "Spotlight today’s decision card", "Turn catalysts into a timeline"],
  "prediction-impact": ["Make the event-to-token map the hero", "Use a professional impact terminal", "Turn related assets into a graph", "Make reversal actions clearer"],
  "smart-money-copy": ["Use a risk-first strategy monitor", "Spotlight the local paper ledger", "Make wallet-feed setup explicit", "Use a compact terminal design"],
  "crypto-aggregator": ["Use a dense sortable market table", "Make search and filters the hero", "Add a glass market explorer feel", "Spotlight the watchlist workflow"],
  "crypto-game": ["Make it a cartoon game with coin mascots", "Create a neon arcade version", "Set round timer to 12 seconds", "Spotlight the local challenge score"],
  "personal-companion": ["Make recommendations feel more personal", "Use a friendly discovery feed", "Spotlight the taste graph", "Make explanations more editorial"],
  "portfolio-tamagotchi": ["Make the creature world more playful", "Spotlight explainable portfolio health", "Use a cute mascot design", "Make holdings input clearer"],
  "crypto-product-hunt": ["Make this a premium private launch board", "Spotlight the add-draft flow", "Show what public mode still requires", "Turn verified project context into cards"],
  "crypto-radio": ["Make this feel like a real browser audio studio", "Spotlight the speech player", "Use an editorial audio rundown", "Make voice support clearer"],
  "crypto-siri": ["Make the voice orb cinematic", "Use a focused assistant layout", "Spotlight sourced answer cards", "Make alert handoff more obvious"],
};

function nowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function colorInputValue(value: string, fallback = "#ffffff"): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const channels = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!channels) return fallback;
  return `#${channels.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, "0")).join("")}`;
}

function normalizeRuntimeSmoke(value: unknown): ProjectRuntimeSmokeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const errors = Array.isArray(input.errors)
    ? input.errors.map((item) => String(item).slice(0, 160)).slice(0, 5)
    : [];
  return {
    executed: input.executed === true,
    runtime: input.runtime === true,
    interactions: input.interactions === true,
    dropstab: input.dropstab === true,
    dropsbot: input.dropsbot === true,
    actions: input.actions === true,
    errors,
    checkedAt: typeof input.checkedAt === "string" ? input.checkedAt.slice(0, 40) : new Date().toISOString(),
  };
}

function readProjects(): GeneratedProject[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECTS_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is GeneratedProject => Boolean(item && typeof item === "object" && "spec" in item && "html" in item)) : [];
  } catch {
    return [];
  }
}

function saveProject(project: GeneratedProject): void {
  const projects = readProjects();
  const next = [project, ...projects.filter((item) => item.id !== project.id)].slice(0, 50);
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Artwork and restore points can approach a browser's localStorage quota.
    // Always preserve the current working project, then keep lightweight recents.
    const compact = {
      ...project,
      checkpoints: project.checkpoints?.slice(-6),
      conversation: project.conversation?.slice(-20),
    };
    const lightweight = projects
      .filter((item) => item.id !== project.id && !item.spec.experience.backgroundImage)
      .slice(0, 8);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([compact, ...lightweight]));
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Artwork could not be read."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Artwork could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

async function prepareArtwork(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8_000_000) {
    throw new Error("Use a PNG, JPG or WebP under 8 MB.");
  }
  let candidate: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bitmap.width, 1000 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.82, 0.68, 0.54]) {
      const optimized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (optimized && optimized.size < candidate.size) candidate = optimized;
      if (candidate.size <= 240_000) break;
    }
  } catch {
    // Keep the original when the browser cannot decode the image locally.
  }
  if (candidate.size > 240_000) throw new Error("This artwork stays too large after optimization. Try a smaller image.");
  return blobAsDataUrl(candidate);
}

function directorModelContext(spec: GeneratedProjectSpec) {
  const experience = { ...spec.experience, backgroundImage: undefined };
  const gameDirection = spec.gameDirection ? { ...spec.gameDirection, backgroundImage: undefined } : undefined;
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
  const quality = project.quality ?? evaluateProjectQuality(project.spec, project.html);
  let gameAsset: Uint8Array | undefined;
  let gameSprite: Uint8Array | undefined;
  if (project.spec.presetId === "crypto-game") {
    const [backgroundResponse, spriteResponse] = await Promise.all([
      fetch("/assets/market-catcher-retro.png"),
      fetch("/assets/market-wolf-catcher.png"),
    ]);
    if (backgroundResponse.ok) gameAsset = new Uint8Array(await backgroundResponse.arrayBuffer());
    if (spriteResponse.ok) gameSprite = new Uint8Array(await spriteResponse.arrayBuffer());
  }
  return createProjectArchive(project, quality, gameAsset, gameSprite);
}

function assistantWelcome(spec: GeneratedProjectSpec): ProjectChatMessage {
  const game = spec.gameDirection;
  return {
    id: nowId("assistant"),
    role: "assistant",
    createdAt: new Date().toISOString(),
    content: game
      ? `I directed this as a ${game.artStyle} ${game.genre.replace(/-/g, " ")} in ${game.world.replace(/-/g, " ")}. Ask me to change the world, mascots, game loop, difficulty, timer or any selected block.`
      : `Your working ${spec.presetId.replace(/-/g, " ")} is ready. Describe a product or design change, or select a block in Design Mode for a targeted edit.`,
  };
}

export function ProjectStudio() {
  const params = useParams<{ id: string }>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<GeneratedProject | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("director");
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [designMode, setDesignMode] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<SelectedCanvasItem | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [directing, setDirecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceFile, setSourceFile] = useState<SourceFile>("index.html");
  const [sourceDraft, setSourceDraft] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [newModule, setNewModule] = useState("");
  const [previewGameAssets, setPreviewGameAssets] = useState({ background: "", sprite: "" });
  const [runtimeSmoke, setRuntimeSmoke] = useState<ProjectRuntimeSmokeResult | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = readProjects().find((item) => item.id === params.id) ?? null;
      if (found) {
        const spec = validateProjectSpec(found.spec);
        const checkpoint: ProjectCheckpoint = { id: nowId("checkpoint"), label: "Working baseline", createdAt: new Date().toISOString(), source: "system", spec };
        const html = compileProject(spec);
        const migrated: GeneratedProject = {
          ...found,
          spec,
          html,
          quality: evaluateProjectQuality(spec, html),
          checkpoints: found.checkpoints?.length ? found.checkpoints.map((item) => ({ ...item, spec: validateProjectSpec(item.spec) })).slice(-12) : [checkpoint],
          conversation: found.conversation?.length ? found.conversation : [assistantWelcome(spec)],
        };
        saveProject(migrated);
        setRuntimeSmoke(null);
        setProject(migrated);
        setDirty(Boolean(migrated.publishedUrl && migrated.publishedAt !== migrated.updatedAt));
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [project?.conversation, directing]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || !event.source || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data.type === "drops-studio-runtime-smoke") {
        const smoke = normalizeRuntimeSmoke(event.data.result);
        if (!smoke) return;
        setRuntimeSmoke(smoke);
        setProject((current) => {
          if (!current || String(event.data.slug || "") !== current.spec.slug) return current;
          const quality = evaluateProjectQuality(current.spec, current.html, smoke);
          const next = { ...current, quality };
          saveProject(next);
          return next;
        });
        return;
      }
      if (event.data.type === "drops-studio-data-request") {
        void fetch("/api/public-data", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((payload) => (event.source as Window).postMessage({ type: "drops-studio-data-response", payload }, "*"))
          .catch(() => (event.source as Window).postMessage({ type: "drops-studio-data-response", payload: { source: "Saved DropsTab-compatible snapshot" } }, "*"));
      }
      if (event.data.type === "drops-studio-block-selected") {
        setSelectedBlock({ id: String(event.data.blockId || "application"), label: String(event.data.label || event.data.blockId || "Application"), kind: "block" });
        setTab("design");
      }
      if (["drops-studio-element-selected", "drops-studio-element-inline-edit"].includes(event.data.type) && event.data.styles) {
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
          overrides: event.data.overrides && typeof event.data.overrides === "object" ? event.data.overrides : {},
        });
        setTab("design");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "drops-studio-design-mode", enabled: designMode }, "*");
  }, [designMode, project?.updatedAt]);

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
        if (!backgroundResponse.ok || !spriteResponse.ok) throw new Error("Game artwork unavailable.");
        const [backgroundBlob, spriteBlob] = await Promise.all([backgroundResponse.blob(), spriteResponse.blob()]);
        const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const [background, sprite] = await Promise.all([toDataUrl(backgroundBlob), toDataUrl(spriteBlob)]);
        if (cancelled) return;
        setPreviewGameAssets({ background, sprite });
      })
      .catch(() => { if (!cancelled) setPreviewGameAssets({ background: "", sprite: "" }); });
    return () => { cancelled = true; };
  }, [project?.spec.presetId]);

  const preset = presets.find((item) => item.id === project?.spec.presetId);
  const runtimeHtml = useMemo(() => {
    if (!project) return "";
    if (project.spec.presetId !== "crypto-game") return project.html;
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    return project.html
      .replaceAll('src="/assets/market-catcher-retro.png"', `src="${previewGameAssets.background || transparentPixel}"`)
      .replaceAll('src="/assets/market-wolf-catcher.png"', `src="${previewGameAssets.sprite || transparentPixel}"`);
  }, [previewGameAssets, project]);
  const qualityReport = useMemo(() => project ? evaluateProjectQuality(project.spec, project.html, runtimeSmoke) : null, [project, runtimeSmoke]);
  const activeProvider = useMemo(() => {
    if (!project) return "free" as ProjectProvider;
    return (window.sessionStorage?.getItem("drops-studio:active-brain") || project.spec.brain.provider || "free") as ProjectProvider;
  }, [project]);

  const replaceProject = useCallback((next: GeneratedProject) => {
    setRuntimeSmoke(null);
    saveProject(next);
    setProject(next);
    setDirty(true);
  }, []);

  const updateSpecQuiet = useCallback((update: (spec: GeneratedProjectSpec) => GeneratedProjectSpec) => {
    setRuntimeSmoke(null);
    setProject((current) => {
      if (!current) return current;
      const spec = validateProjectSpec(update(current.spec));
      const html = compileProject(spec);
      const next = { ...current, spec, html, quality: evaluateProjectQuality(spec, html), updatedAt: new Date().toISOString() };
      saveProject(next);
      return next;
    });
    setDirty(true);
  }, []);

  function commitSpec(specInput: GeneratedProjectSpec, label: string, source: ProjectCheckpoint["source"] = "manual", conversation?: ProjectChatMessage[]) {
    if (!project) return;
    const spec = validateProjectSpec(specInput);
    const html = compileProject(spec);
    const checkpoint: ProjectCheckpoint = { id: nowId("checkpoint"), label, createdAt: new Date().toISOString(), source, spec };
    replaceProject({
      ...project,
      spec,
      html,
      quality: evaluateProjectQuality(spec, html),
      updatedAt: checkpoint.createdAt,
      checkpoints: [...(project.checkpoints ?? []), checkpoint].slice(-12),
      conversation: conversation ?? project.conversation,
    });
  }

  function applyKit(kit: ProjectDesignKit) {
    if (!project) return;
    const token = kitTokens[kit];
    commitSpec(validateProjectSpec({
      ...project.spec,
      theme: { ...project.spec.theme, accent: token.accent, surface: token.surface, style: token.style },
      design: { ...project.spec.design, kit, font: token.font, radius: token.radius, motion: kit === "neon-arena" || kit === "mascot-pop" ? "expressive" : "smooth" },
      gameDirection: project.spec.gameDirection ? {
        ...project.spec.gameDirection,
        artStyle: kit === "mascot-pop" ? "comic" : kit === "neon-arena" ? "3d-toy" : project.spec.gameDirection.artStyle,
      } : undefined,
    }), `Applied ${DESIGN_DIRECTIONS.find((item) => item.id === kit)?.name ?? kit}`, "design");
    setToast("Design direction applied — checkpoint created");
  }

  function updateSelectedBlock(update: { visible?: boolean; variant?: "default" | "compact" | "wide" | "spotlight" }) {
    if (!project || !selectedBlock || selectedBlock.kind !== "block") return;
    const current = project.spec.blocks[selectedBlock.id] ?? { visible: true, variant: "default" as const };
    commitSpec(validateProjectSpec({ ...project.spec, blocks: { ...project.spec.blocks, [selectedBlock.id]: { ...current, ...update } } }), `Edited ${selectedBlock.label}`, "design");
  }

  function previewSelectedElement(update: { text?: string; imageSrc?: string; styles?: Partial<Omit<ProjectElementConfig, "text" | "imageSrc">> }) {
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
    iframeRef.current?.contentWindow?.postMessage({
      type: "drops-studio-element-preview",
      elementId: next.id,
      config: overrides,
    }, "*");
  }

  async function previewElementImage(file?: File) {
    if (!selectedBlock || selectedBlock.kind !== "element" || !selectedBlock.imageEditable || !file) return;
    try {
      setToast("Optimizing the selected image…");
      previewSelectedElement({ imageSrc: await prepareArtwork(file) });
      setToast("Image replaced in preview — save a version when ready");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Image could not be applied.");
    }
  }

  function commitSelectedElement() {
    if (!project || !selectedBlock || selectedBlock.kind !== "element") return;
    commitSpec(validateProjectSpec({
      ...project.spec,
      elements: { ...(project.spec.elements ?? {}), [selectedBlock.id]: selectedBlock.overrides },
    }), `Edited ${selectedBlock.label}`, "design");
    setToast(`${selectedBlock.label} saved as a reversible version`);
  }

  function resetSelectedElement() {
    if (!project || !selectedBlock || selectedBlock.kind !== "element") return;
    const nextElements = { ...(project.spec.elements ?? {}) };
    delete nextElements[selectedBlock.id];
    commitSpec(validateProjectSpec({ ...project.spec, elements: nextElements }), `Reset ${selectedBlock.label}`, "design");
    setSelectedBlock(null);
    setToast("Element reset to the generated design");
  }

  function undo() {
    if (!project || (project.checkpoints?.length ?? 0) < 2) {
      setToast("No earlier checkpoint yet");
      return;
    }
    const checkpoints = [...(project.checkpoints ?? [])];
    checkpoints.pop();
    const previous = checkpoints[checkpoints.length - 1];
    const html = compileProject(previous.spec);
    const next = { ...project, spec: previous.spec, html, quality: evaluateProjectQuality(previous.spec, html), updatedAt: new Date().toISOString(), checkpoints };
    replaceProject(next);
    setToast(`Restored: ${previous.label}`);
  }

  async function sendDirectorPrompt(raw?: string) {
    if (!project || directing) return;
    const instruction = (raw ?? chatInput).trim();
    if (!instruction) return;
    setChatInput("");
    setDirecting(true);
    const userMessage: ProjectChatMessage = { id: nowId("user"), role: "user", content: instruction, createdAt: new Date().toISOString() };
    const baseConversation = [...(project.conversation ?? []), userMessage];
    setProject({ ...project, conversation: baseConversation });
    try {
      let proposal: DirectorProposal;
      const provider = activeProvider;
      const key = provider === "free" ? null : window.sessionStorage.getItem(`drops-studio:${provider}`);
      if (provider === "custom" && key) {
        const endpoint = window.sessionStorage.getItem("drops-studio:custom-endpoint");
        const model = window.sessionStorage.getItem("drops-studio:custom-model");
        if (!endpoint || !model) throw new Error("Custom OpenAI-compatible connection is incomplete.");
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0.2, max_tokens: 900, messages: [
            { role: "system", content: "Return JSON only. You may improve name, tagline, description, theme, design, experience, gameDirection and elements. When selectedCanvas is an element, edit only its exact id inside elements unless the user explicitly asks for a whole-product change. Preserve the preset and DropsTab/Drops Bot foundations. Never return code, URLs or API keys." },
            { role: "user", content: JSON.stringify({ instruction, selectedCanvas: selectedBlock, product: directorModelContext(project.spec) }) },
          ] }),
        });
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || `Custom provider returned ${response.status}.`);
        const text = payload.choices?.[0]?.message?.content || "{}";
        const suggestion = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}") as Partial<GeneratedProjectSpec>;
        const customSpec = validateProjectSpec({
          ...project.spec,
          name: suggestion.name ?? project.spec.name,
          tagline: suggestion.tagline ?? project.spec.tagline,
          description: suggestion.description ?? project.spec.description,
          theme: { ...project.spec.theme, ...(suggestion.theme ?? {}) },
          design: { ...project.spec.design, ...(suggestion.design ?? {}) },
          experience: { ...project.spec.experience, ...(suggestion.experience ?? {}) },
          elements: { ...(project.spec.elements ?? {}), ...(suggestion.elements ?? {}) },
          gameDirection: project.spec.gameDirection ? { ...project.spec.gameDirection, ...(suggestion.gameDirection ?? {}) } : undefined,
          brain: { provider: "custom", model, enhanced: true },
        });
        if (selectedBlock?.kind === "element" && !suggestion.elements?.[selectedBlock.id]) {
          const focused = createFreeElementDirectorProposal(project.spec, instruction, selectedBlock);
          proposal = { ...focused, label: `${model} · focused element guard`, summary: [...focused.summary, "Kept the edit isolated because the connected model returned no valid element override."] };
        } else {
          proposal = { label: `${model} proposal`, summary: ["Applied the requested direction through your custom model.", "Preserved the validated crypto product contract."], affected: ["Product brief", "Experience", "Design"], spec: customSpec };
        }
      } else {
        const model = window.sessionStorage.getItem(`drops-studio:${provider}:model`) || project.spec.brain.model;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (provider === "openrouter" && key) headers["x-openrouter-key"] = key;
        else if (["openai", "anthropic", "kimi"].includes(provider) && key) headers["x-provider-key"] = key;
        const response = await fetch("/api/agent/plan", {
          method: "POST",
          headers,
          body: JSON.stringify({
            provider: provider === "free" || provider === "gateway" ? undefined : provider,
            model,
            guestId: window.sessionStorage.getItem("drops-studio:guest-id"),
            prompt: `Revise the existing product without changing its category (${project.spec.presetId}).\nUser change: ${instruction}\nSelected canvas item: ${JSON.stringify(selectedBlock ?? { kind: "product", label: "whole product" })}.\nIf the selected item kind is element, use its exact id in elementEdit and return only the requested focused style/copy change there while preserving the rest of the product.\nCurrent product: ${JSON.stringify({ name: project.spec.name, tagline: project.spec.tagline, description: project.spec.description, tools: project.spec.tools })}\nCurrent blueprint: ${JSON.stringify(project.spec.blueprint)}\nCurrent design: ${JSON.stringify({ theme: project.spec.theme, design: project.spec.design, experience: project.spec.experience, gameDirection: project.spec.gameDirection, elements: project.spec.elements })}`,
          }),
        });
        const payload = await response.json() as { plan?: AgentProductPlan; error?: string; model?: string; warning?: string };
        if (!response.ok || !payload.plan) throw new Error(payload.error || "AI Director failed.");
        const aiPlan: AgentProductPlan = { ...payload.plan, presetId: project.spec.presetId };
        if (selectedBlock?.kind === "element" && !aiPlan.elementEdit) {
          const focused = createFreeElementDirectorProposal(project.spec, instruction, selectedBlock);
          proposal = {
            ...focused,
            label: `${payload.model || modelLabels[provider]} · focused element edit`,
            summary: [...focused.summary, payload.warning || "The selected element stayed isolated from the rest of the product."],
          };
        } else {
          const revised = validateProjectSpec(applyAgentPlan(project.spec, aiPlan));
          proposal = {
            label: `${payload.model || aiPlan.model || modelLabels[provider]} change set`,
            summary: [
              `Rebuilt ${selectedBlock?.label ?? "the product direction"} from the full instruction.`,
              `${aiPlan.blueprint.screens.length} native screens · ${aiPlan.blueprint.interactions.length} working interactions.`,
              aiPlan.blueprint.revisionNotes?.[0] || payload.warning || "DropsTab evidence and Drops Bot action boundaries remain explicit.",
            ],
            affected: [selectedBlock?.label ?? "Product blueprint", "Runtime", "Design system"],
            spec: revised,
          };
        }
      }
      const assistant: ProjectChatMessage = {
        id: nowId("assistant"),
        role: "assistant",
        content: `I prepared a safe change set for ${proposal.affected.join(", ").toLowerCase()}. Review it before applying.`,
        createdAt: new Date().toISOString(),
        proposal: { label: proposal.label, summary: proposal.summary, spec: proposal.spec },
      };
      const next = { ...project, conversation: [...baseConversation, assistant], updatedAt: new Date().toISOString() };
      saveProject(next);
      setProject(next);
    } catch (error) {
      const fallback = selectedBlock?.kind === "element"
        ? createFreeElementDirectorProposal(project.spec, instruction, selectedBlock)
        : createFreeDirectorProposal(project.spec, instruction, selectedBlock?.id);
      const assistant: ProjectChatMessage = {
        id: nowId("assistant"), role: "assistant", createdAt: new Date().toISOString(),
        content: `${error instanceof Error ? error.message : "The connected model is unavailable."} I prepared the same request with Free Director instead.`,
        proposal: { label: "Free Director fallback", summary: fallback.summary, spec: fallback.spec },
      };
      const next = { ...project, conversation: [...baseConversation, assistant] };
      saveProject(next);
      setProject(next);
    } finally {
      setDirecting(false);
    }
  }

  function applyChatProposal(message: ProjectChatMessage) {
    if (!project || !message.proposal) return;
    const conversation = (project.conversation ?? []).map((item) => item.id === message.id ? { ...item, proposal: undefined, content: `${item.content} Applied as a new checkpoint.` } : item);
    commitSpec(message.proposal.spec, message.proposal.label, "director", conversation);
    setToast("Proposal applied — Undo is available");
  }

  function dismissProposal(message: ProjectChatMessage) {
    if (!project) return;
    const next = { ...project, conversation: (project.conversation ?? []).map((item) => item.id === message.id ? { ...item, proposal: undefined, content: `${item.content} Proposal dismissed.` } : item) };
    saveProject(next);
    setProject(next);
  }

  async function handleArtUpload(file?: File) {
    if (!project || !file) return;
    try {
      setToast("Optimizing artwork for preview and publishing…");
      const image = await prepareArtwork(file);
      const gameDirection = project.spec.gameDirection
        ? { ...project.spec.gameDirection, backgroundImage: undefined, assetSource: "uploaded" as const }
        : undefined;
      commitSpec(validateProjectSpec({
        ...project.spec,
        experience: { ...project.spec.experience, backgroundImage: image, assetSource: "uploaded" },
        ...(gameDirection ? { gameDirection } : {}),
      }), "Uploaded product artwork", "design");
      setToast("Artwork optimized and included in publish/export");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Artwork could not be applied.");
    }
  }

  function updateModule(index: number, value: string) {
    if (!project) return;
    const modules = project.spec.experience.modules.map((module, moduleIndex) => moduleIndex === index ? value : module);
    updateSpecQuiet((spec) => ({ ...spec, experience: { ...spec.experience, modules } }));
  }

  function moveModule(index: number, direction: -1 | 1) {
    if (!project) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= project.spec.experience.modules.length) return;
    const modules = [...project.spec.experience.modules];
    [modules[index], modules[nextIndex]] = [modules[nextIndex], modules[index]];
    commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, modules } }), "Reordered product modules", "manual");
  }

  function removeModule(index: number) {
    if (!project || project.spec.experience.modules.length <= 1) return;
    const modules = project.spec.experience.modules.filter((_, moduleIndex) => moduleIndex !== index);
    commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, modules } }), "Removed a product module", "manual");
  }

  function addModule() {
    if (!project || !newModule.trim() || project.spec.experience.modules.length >= 12) return;
    const modules = [...project.spec.experience.modules, newModule.trim()];
    commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, modules } }), "Added a product module", "manual");
    setNewModule("");
  }

  function openRuntime() {
    if (!project) return;
    if (project.publishedUrl && !dirty) window.open(project.publishedUrl, "_blank", "noopener,noreferrer");
    else {
      const url = URL.createObjectURL(new Blob([project.html], { type: "text/html" }));
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function publish(): Promise<string | null> {
    if (!project || publishing) return null;
    const quality = evaluateProjectQuality(project.spec, project.html, runtimeSmoke);
    if (!quality.readyToPublish) {
      setProject({ ...project, quality });
      setTab("quality");
      setPublishError(`Quality gate blocked publishing at ${quality.score}/100.`);
      setToast("Fix the failed release checks before publishing");
      return null;
    }
    setPublishing(true);
    setPublishError("");
    try {
      const response = await fetch("/api/projects/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: project.spec }) });
      const payload = await response.json() as { url?: string; slug?: string; error?: string };
      if (!response.ok || !payload.url || !payload.slug) throw new Error(payload.error || "Publishing failed.");
      const publishedAt = new Date().toISOString();
      const next = { ...project, publishedUrl: payload.url, publishedSlug: payload.slug, publishedAt, updatedAt: publishedAt };
      saveProject(next);
      setProject(next);
      setDirty(false);
      setToast(quality.externalSetupRequired ? "Setup app published — connect and verify the external destination next" : "Working public app published");
      return payload.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publishing failed.";
      setPublishError(message);
      setToast(message);
      return null;
    } finally {
      setPublishing(false);
    }
  }

  async function share() {
    let url = project?.publishedUrl && !dirty ? project.publishedUrl : null;
    if (!url) url = await publish();
    if (!url) return;
    if (navigator.share) await navigator.share({ title: project?.spec.name, text: project?.spec.tagline, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(url).then(() => setToast("Public link copied"));
  }

  function handleCloudPublish() {
    if (project?.publishedUrl && !dirty) {
      window.open(project.publishedUrl, "_blank", "noopener,noreferrer");
      return;
    }
    void publish();
  }

  async function downloadSource(nextHost?: HostingProvider) {
    if (!project) return;
    const bytes = await projectArchive(project);
    downloadBlob(`${project.spec.slug}-source.zip`, new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }));
    setToast(nextHost ? `Git-ready deployment package created for ${nextHost}` : "Runnable app + source ZIP downloaded");
    if (nextHost) window.setTimeout(() => window.open(hostLinks[nextHost], "_blank", "noopener,noreferrer"), 450);
  }

  function openSource(file: SourceFile = "index.html") {
    if (!project) return;
    setSourceFile(file);
    setSourceDraft(file === "project.json" ? JSON.stringify(project.spec, null, 2) : "");
    setSourceOpen(true);
  }

  function applyProjectJson() {
    if (!project) return;
    try {
      const spec = validateProjectSpec(JSON.parse(sourceDraft));
      commitSpec(spec, "Edited project.json", "manual");
      setSourceDraft(JSON.stringify(spec, null, 2));
      setToast("Validated project.json applied — checkpoint created");
    } catch (error) {
      setToast(error instanceof Error ? `Invalid project.json: ${error.message}` : "Invalid project.json");
    }
  }

  if (!loaded) return <div className="studio-loading"><LoaderCircle className="spin" /> Loading product workspace…</div>;
  if (!project || !preset) return <main className="studio-missing"><span><Rocket /></span><h1>Project not found</h1><p>This local project may belong to another browser.</p><a href="/">Create a working product</a></main>;

  const published = Boolean(project.publishedUrl);
  const quality = qualityReport ?? evaluateProjectQuality(project.spec, project.html);
  const reality = getProductReality(project.spec.presetId);
  const externalSetup = quality.launchStatus === "external-setup-required";
  const researchOnly = quality.launchStatus === "research-only";
  const releaseLabel = externalSetup ? "External setup required" : researchOnly ? "Research app ready" : "Web app ready";
  const checkpoints = project.checkpoints ?? [];
  const nav: Array<{ id: InspectorTab; label: string; icon: typeof Settings2 }> = [
    { id: "director", label: "Director", icon: Sparkles },
    { id: "design", label: "Design", icon: Palette },
    { id: "data", label: "Data", icon: Database },
    { id: "logic", label: "Logic", icon: Blocks },
    { id: "connections", label: "Connect", icon: KeyRound },
    { id: "quality", label: "Tests", icon: ShieldCheck },
    { id: "code", label: "Code", icon: Code2 },
    { id: "history", label: "Versions", icon: History },
  ];
  const game = project.spec.gameDirection;
  const quickPrompts = categoryPrompts[project.spec.presetId];
  const activeSourceContent = sourceFile === "index.html"
    ? project.html
    : sourceFile === "project.json"
      ? sourceDraft || JSON.stringify(project.spec, null, 2)
      : JSON.stringify(quality, null, 2);

  return (
    <main className="project-studio-shell">
      <header className="project-studio-topbar">
        <div className="project-crumbs"><a href="/" aria-label="Back to builder"><ArrowLeft /></a><span className="studio-brand-mark"><Image src="https://dropstab.com/images/dropstab-logo-drop-default.svg" alt="DropsTab" width={20} height={20} unoptimized /></span><strong>Drops Studio</strong><i>/</i><span>{project.spec.name}</span><b className={published && !dirty ? "running" : "draft"}><i />{published && !dirty ? externalSetup ? "Setup app published" : researchOnly ? "Research app published" : "Web app published" : dirty ? "Edits pending" : externalSetup ? "Setup required" : "Draft"}</b></div>
        <div className="workspace-actions"><button type="button" onClick={undo} disabled={checkpoints.length < 2}><Undo2 /> Undo</button><button type="button" onClick={openRuntime}><Play /> Run app</button><button type="button" onClick={() => setTab("connections")}><KeyRound /> Connections</button><button type="button" onClick={share} disabled={publishing}><Share2 /> Share</button><button className="publish-top" type="button" onClick={() => setPublishOpen(true)}><UploadCloud /> {published && dirty ? "Publish update" : published ? "Published" : "Publish"}<ChevronDown /></button></div>
      </header>

      <div className={`project-studio-layout tab-${tab}`}>
        <aside className="studio-rail">
          {nav.map((item) => { const Icon = item.icon; return <button type="button" title={item.label} aria-label={item.label} className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}><Icon /><span>{item.label}</span></button>; })}
          <div className="rail-foundation"><span title="DropsTab attached"><Database /></span><span title="Drops Bot attached"><Bot /></span></div>
        </aside>

        <aside className="studio-inspector">
          {tab === "director" && <section className="inspector-section">
            <div className="inspector-heading"><span><Sparkles /> Product Director</span><b>FREE</b></div>
            <p className="inspector-copy">Turns intent into a category-aware product plan before changes reach the working app.</p>
            <div className="director-pipeline"><span className="done"><i>1</i><b>Brief</b><small>{preset.shortTitle}</small></span><span className="done"><i>2</i><b>Experience</b><small>{game ? game.genre.replace(/-/g, " ") : preset.output}</small></span><span className="done"><i>3</i><b>Foundation</b><small>DropsTab × Drops Bot</small></span><span className={quality.readyToPublish ? "done" : ""}><i>4</i><b>Ship</b><small>{quality.score}/100 quality</small></span></div>
            <label>Product name<input value={project.spec.name} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, name: event.target.value }))} /></label>
            <label>Product promise<textarea rows={4} value={project.spec.tagline} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, tagline: event.target.value }))} /></label>
            <div className="experience-brief"><span><Layers3 /> Experience brief</span><dl><div><dt>Archetype</dt><dd>{project.spec.experience.archetype.replace(/-/g, " ")}</dd></div><div><dt>Layout</dt><dd>{project.spec.experience.layout}</dd></div><div><dt>Data view</dt><dd>{project.spec.experience.dataView}</dd></div><div><dt>Loop</dt><dd>{project.spec.experience.engagement}</dd></div></dl><p>{project.spec.experience.primaryLoop}</p><div>{project.spec.experience.modules.map((module) => <i key={module}>{module}</i>)}</div></div>
            <div className="blueprint-inspector"><span><WandSparkles /> AI product blueprint</span><p>{project.spec.blueprint.visualConcept}</p><dl><div><dt>Native screens</dt><dd>{project.spec.blueprint.screens.join(" · ")}</dd></div><div><dt>Working interactions</dt><dd>{project.spec.blueprint.interactions.join(" · ")}</dd></div><div><dt>DropsTab foundation</dt><dd>{project.spec.blueprint.dropsTabUse.join(" · ")}</dd></div><div><dt>Drops Bot automation</dt><dd>{project.spec.blueprint.dropsBotUse.join(" · ")}</dd></div>{project.spec.blueprint.revisionNotes?.length ? <div><dt>Revision trade-offs</dt><dd>{project.spec.blueprint.revisionNotes.join(" · ")}</dd></div> : null}</dl></div>
            {game && <div className="game-brief"><span><Gamepad2 /> Game brief</span><dl><div><dt>Genre</dt><dd>{game.genre.replace(/-/g, " ")}</dd></div><div><dt>World</dt><dd>{game.world.replace(/-/g, " ")}</dd></div><div><dt>Art</dt><dd>{game.artStyle}</dd></div><div><dt>Loop</dt><dd>{game.roundSeconds}s · {game.difficulty}</dd></div></dl><p>{game.gameLoop}</p></div>}
            <button className="inspector-primary" type="button" onClick={() => void sendDirectorPrompt(game ? "Make this game feel more visual, playful and shareable" : "Improve the product hierarchy and primary user loop")}><WandSparkles /> Ask Director to improve it</button>
          </section>}

          {tab === "design" && <section className="inspector-section">
            <div className="inspector-heading"><span><Palette /> Design Canvas</span><b className="free-badge">FREE</b></div>
            <button type="button" className={`design-mode-control ${designMode ? "active" : ""}`} onClick={() => setDesignMode((value) => !value)}><MousePointer2 /><span><strong>{designMode ? "Selecting elements" : "Select in preview"}</strong><small>{designMode ? "Click to inspect · double-click text to type" : "Choose any text, image, button or block"}</small></span><i>{designMode ? "ON" : "OFF"}</i></button>
            {selectedBlock?.kind === "block" && (
              <div className="selected-inspector">
                <div><span>Selected block</span><strong><Layers3 /> {selectedBlock.label}</strong></div>
                <label>Variant<select value={project.spec.blocks[selectedBlock.id]?.variant ?? "default"} onChange={(event) => updateSelectedBlock({ variant: event.target.value as "default" | "compact" | "wide" | "spotlight" })}><option value="default">Default</option><option value="compact">Compact</option><option value="wide">Wide</option><option value="spotlight">Spotlight</option></select></label>
                <label className="toggle-line"><input type="checkbox" checked={project.spec.blocks[selectedBlock.id]?.visible !== false} onChange={(event) => updateSelectedBlock({ visible: event.target.checked })} /> Visible in the app</label>
              </div>
            )}
            {selectedBlock?.kind === "element" && (
              <div className="selected-inspector element-inspector">
                <div className="element-inspector-head"><span>Selected {selectedBlock.tag}</span><strong><MousePointer2 /> {selectedBlock.label}</strong><button type="button" onClick={resetSelectedElement}>Reset</button></div>
                {selectedBlock.textEditable && <label>Text<textarea rows={3} value={selectedBlock.text} onChange={(event) => previewSelectedElement({ text: event.target.value })} /></label>}
                {selectedBlock.imageEditable && <label className="element-image-upload"><ImageIcon /><span><strong>Replace this image</strong><small>PNG, JPG or WebP · optimized into the published app</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void previewElementImage(event.target.files?.[0])} /></label>}
                <div className="element-control-grid">
                  <label>Font size<input type="number" min="8" max="120" value={selectedBlock.styles.fontSize} onChange={(event) => previewSelectedElement({ styles: { fontSize: Number(event.target.value) } })} /></label>
                  <label>Weight<select value={selectedBlock.styles.fontWeight} onChange={(event) => previewSelectedElement({ styles: { fontWeight: Number(event.target.value) } })}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option></select></label>
                  <label>Text color<span className="element-color"><input type="color" value={colorInputValue(selectedBlock.styles.color)} onChange={(event) => previewSelectedElement({ styles: { color: event.target.value } })} /><b>{selectedBlock.styles.color}</b></span></label>
                  <label>Background<span className="element-color"><input type="color" value={colorInputValue(selectedBlock.styles.backgroundColor)} onChange={(event) => previewSelectedElement({ styles: { backgroundColor: event.target.value } })} /><b>{selectedBlock.styles.backgroundColor === "transparent" ? "No fill" : selectedBlock.styles.backgroundColor}</b><button type="button" aria-label="Remove background fill" onClick={() => previewSelectedElement({ styles: { backgroundColor: "transparent" } })}>×</button></span></label>
                  <label>Alignment<select value={selectedBlock.styles.textAlign} onChange={(event) => previewSelectedElement({ styles: { textAlign: event.target.value as ProjectElementConfig["textAlign"] } })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
                  <label>Width %<input type="number" min="10" max="100" value={selectedBlock.styles.width} onChange={(event) => previewSelectedElement({ styles: { width: Number(event.target.value) } })} /></label>
                  <label>Padding<input type="number" min="0" max="80" value={selectedBlock.styles.padding} onChange={(event) => previewSelectedElement({ styles: { padding: Number(event.target.value) } })} /></label>
                  <label>Corner radius<input type="number" min="0" max="80" value={selectedBlock.styles.borderRadius} onChange={(event) => previewSelectedElement({ styles: { borderRadius: Number(event.target.value) } })} /></label>
                  <label>Move X<input type="number" min="-500" max="500" value={selectedBlock.styles.translateX} onChange={(event) => previewSelectedElement({ styles: { translateX: Number(event.target.value) } })} /></label>
                  <label>Move Y<input type="number" min="-500" max="500" value={selectedBlock.styles.translateY} onChange={(event) => previewSelectedElement({ styles: { translateY: Number(event.target.value) } })} /></label>
                  <label>Opacity<input type="number" min="0" max="1" step="0.05" value={selectedBlock.styles.opacity} onChange={(event) => previewSelectedElement({ styles: { opacity: Number(event.target.value) } })} /></label>
                  <label>Layer<input type="number" min="-10" max="100" value={selectedBlock.styles.zIndex} onChange={(event) => previewSelectedElement({ styles: { zIndex: Number(event.target.value) } })} /></label>
                </div>
                <label className="toggle-line"><input type="checkbox" checked={selectedBlock.styles.visible} onChange={(event) => previewSelectedElement({ styles: { visible: event.target.checked } })} /> Visible in the app</label>
                <div className="element-actions"><button type="button" onClick={commitSelectedElement}><Check /> Save version</button><button type="button" onClick={() => setTab("director")}><Sparkles /> Edit with AI</button></div>
              </div>
            )}
            <span className="section-label">Design directions</span>
            <div className="design-kits">{DESIGN_DIRECTIONS.map((direction) => <button type="button" className={project.spec.design.kit === direction.id ? "active" : ""} key={direction.id} onClick={() => applyKit(direction.id)}><span className="kit-preview" style={{ background: `linear-gradient(135deg,${direction.palette.join(",")})` }}><i /><i /><i /></span><span><strong>{direction.name}</strong><small>{direction.bestFor}</small></span>{project.spec.design.kit === direction.id && <Check />}</button>)}</div>
            <div className="design-tokens"><label>Accent<div className="color-field"><input type="color" value={project.spec.theme.accent} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, theme: { ...spec.theme, accent: event.target.value } }))} /><input value={project.spec.theme.accent} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, theme: { ...spec.theme, accent: event.target.value } }))} /></div></label><label>Density<select value={project.spec.design.density} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, design: { ...spec.design, density: event.target.value as GeneratedProjectSpec["design"]["density"] } }))}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="cinematic">Cinematic</option></select></label><label>Motion<select value={project.spec.design.motion} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, design: { ...spec.design, motion: event.target.value as GeneratedProjectSpec["design"]["motion"] } }))}><option value="reduced">Reduced</option><option value="smooth">Smooth</option><option value="expressive">Expressive</option></select></label></div>
            <label className="art-upload"><ImageIcon /><span><strong>{game ? "Replace game world artwork" : "Add product hero artwork"}</strong><small>Auto-optimized · included in public app and ZIP</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleArtUpload(event.target.files?.[0])} /></label>
          </section>}

          {tab === "data" && <section className="inspector-section"><div className="inspector-heading"><span><Database /> Data foundation</span><BadgeCheck /></div><p className="inspector-copy">DropsTab Public API is the primary production data contract. A clearly labelled public fallback keeps exported demos alive when no platform or user key is available.</p><div className="foundation-card"><span><Database /></span><div><strong>DropsTab Public API adapter</strong><small>Prices · change · market cap · context</small></div><b>API READY</b></div><div className="data-budget"><ShieldCheck /><div><strong>Low-consumption policy</strong><span>15-minute shared platform cache · no generated-app polling · manual BYOK refresh only</span></div><b>≤ 96/day</b></div><div className="asset-list">{project.spec.market.map((coin) => <div key={coin.symbol}><span>{coin.symbol.slice(0, 2)}</span><div><strong>{coin.symbol}</strong><small>{coin.name}</small></div><b className={coin.change === null ? undefined : coin.change >= 0 ? "up" : "down"}>{coin.change === null ? "—" : `${coin.change >= 0 ? "+" : ""}${coin.change.toFixed(2)}%`}</b></div>)}</div><div className="safety-note"><ShieldCheck /><span><strong>No secret in the output</strong><small>Connected keys stay session-only and never enter publish or ZIP.</small></span></div><button className="inspector-secondary" type="button" onClick={() => window.open("https://api-docs.dropstab.com/", "_blank", "noopener,noreferrer")}><Database /> DropsTab API docs <ExternalLink /></button></section>}

          {tab === "logic" && (
            <section className="inspector-section">
              <div className="inspector-heading"><span><Blocks /> Product logic</span><Zap /></div>
              <p className="inspector-copy">Category controls and experience architecture recompile real behavior, not a static preview.</p>
              {preset.fields.map((field) => (
                <label key={field.id}>
                  {field.label}
                  <select value={project.spec.values[field.id] || field.value} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, values: { ...spec.values, [field.id]: event.target.value } }))}>
                    {field.options.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
              ))}
              <span className="section-label">Professional experience</span>
              <div className="logic-grid">
                <label>Layout<select value={project.spec.experience.layout} onChange={(event) => commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, layout: event.target.value } }), "Changed experience layout")}><option value="focus">Focus</option><option value="split">Split workflow</option><option value="dashboard">Dashboard</option><option value="feed">Feed</option><option value="spatial">Spatial</option></select></label>
                <label>Data view<select value={project.spec.experience.dataView} onChange={(event) => commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, dataView: event.target.value } }), "Changed data presentation")}><option value="cards">Cards</option><option value="table">Table</option><option value="timeline">Timeline</option><option value="graph">Graph</option><option value="map">Map</option></select></label>
                <label>Engagement<select value={project.spec.experience.engagement} onChange={(event) => commitSpec(validateProjectSpec({ ...project.spec, experience: { ...project.spec.experience, engagement: event.target.value } }), "Changed engagement model")}><option value="realtime">Real-time</option><option value="scheduled">Scheduled</option><option value="social">Social</option><option value="personal">Personal</option></select></label>
                <label>Audience<input value={project.spec.experience.audience} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, experience: { ...spec.experience, audience: event.target.value } }))} /></label>
              </div>
              <label>Primary user loop<textarea rows={3} value={project.spec.experience.primaryLoop} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, experience: { ...spec.experience, primaryLoop: event.target.value } }))} /></label>
              <span className="section-label">Product modules</span>
              <div className="module-editor">
                {project.spec.experience.modules.map((module, index) => (
                  <div key={`${module}-${index}`}>
                    <Check />
                    <input aria-label={`Module ${index + 1}`} value={module} onChange={(event) => updateModule(index, event.target.value)} />
                    <button type="button" aria-label={`Move ${module} up`} disabled={index === 0} onClick={() => moveModule(index, -1)}><ArrowUp /></button>
                    <button type="button" aria-label={`Move ${module} down`} disabled={index === project.spec.experience.modules.length - 1} onClick={() => moveModule(index, 1)}><ArrowDown /></button>
                    <button type="button" aria-label={`Remove ${module}`} disabled={project.spec.experience.modules.length <= 1} onClick={() => removeModule(index)}><X /></button>
                  </div>
                ))}
                <div className="module-add"><Plus /><input aria-label="New product module" value={newModule} placeholder="Add module…" onChange={(event) => setNewModule(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addModule(); } }} /><button type="button" disabled={!newModule.trim() || project.spec.experience.modules.length >= 12} onClick={addModule}>Add</button></div>
              </div>
              {game && <><span className="section-label">Game system</span><div className="logic-grid"><label>Difficulty<select value={game.difficulty} onChange={(event) => commitSpec(validateProjectSpec({ ...project.spec, gameDirection: { ...game, difficulty: event.target.value } }), "Changed game difficulty")}><option value="casual">Casual</option><option value="normal">Normal</option><option value="expert">Expert</option></select></label><label>Round timer<input type="number" min={5} max={120} value={game.roundSeconds} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, roundSeconds: Number(event.target.value) } : undefined }))} /></label></div><label>Core mechanic<textarea rows={3} value={game.mechanic} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, mechanic: event.target.value } : undefined }))} /></label><label>Character and world<textarea rows={3} value={`${game.protagonist}\n\n${game.scene}`} onChange={(event) => { const [protagonist, ...scene] = event.target.value.split("\n\n"); updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, protagonist, scene: scene.join("\n\n") || spec.gameDirection.scene } : undefined })); }} /></label><label>Art direction<textarea rows={3} value={game.artDirection} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, artDirection: event.target.value } : undefined }))} /></label><label>DropsTab gameplay mapping<textarea rows={3} value={game.dataUse} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, dataUse: event.target.value } : undefined }))} /></label></>}
              <div className="tool-stack"><span>Working capabilities</span>{project.spec.tools.map((tool) => <div key={tool}><Check /> {tool}</div>)}</div>
            </section>
          )}

          {tab === "connections" && <section className="inspector-section connections-inspector"><div className="inspector-heading"><span><KeyRound /> Connections</span><b>SESSION SAFE</b></div><p className="inspector-copy">Your models, data, Telegram accounts and deployment targets in one place. Connected secrets never enter the generated app.</p><div className="connection-summary-grid"><button type="button" onClick={() => { window.location.href = "/?connections=1"; }}><BrainCircuit /><span><strong>AI models</strong><small>{modelLabels[activeProvider]} · OpenAI, Claude, OpenRouter, Kimi or custom</small></span><ChevronRight /></button><button type="button" onClick={() => { window.location.href = "/?connections=1"; }}><Database /><span><strong>DropsTab data</strong><small>Platform cache or your own API key</small></span><ChevronRight /></button><button type="button" onClick={() => setPublishOpen(true)}><Cloud /><span><strong>Hosting and source</strong><small>Free public URL, Vercel, Cloudflare and GitHub export</small></span><ChevronRight /></button></div><TelegramChannelWizard defaultTitle={project.spec.name} defaultAbout={`${project.spec.tagline} Powered by DropsTab and Drops Bot.`} defaultFirstPost={`${project.spec.name}\n\n${project.spec.tagline}\n\nBuilt with Drops Studio on DropsTab × Drops Bot.`} /></section>}

          {tab === "quality" && <section className="inspector-section"><div className="inspector-heading"><span><ShieldCheck /> Release checks</span><b className={quality.readyToPublish ? "quality-pass" : "quality-fail"}>{quality.score}/100</b></div><div className={`quality-hero ${quality.readyToPublish ? "passed" : "failed"}`}><span><ShieldCheck /></span><div><strong>{quality.readyToPublish ? releaseLabel : "Build needs attention"}</strong><small>{externalSetup ? "The web setup app can publish, but the external outcome is not live until it is connected and verified." : "Deterministic checks run on every edit and before every publish."}</small></div></div><div className="experience-brief"><span><Zap /> Reality contract</span><p>{reality.deliverable}</p><dl><div><dt>Works now</dt><dd>{reality.worksNow.join(" · ")}</dd></div><div><dt>Requires</dt><dd>{reality.requires.join(" · ")}</dd></div></dl></div><div className="quality-list">{quality.checks.map((item) => <div className={item.passed ? "passed" : "failed"} key={item.id}><span>{item.passed ? <Check /> : <X />}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{item.critical && <b>GATE</b>}</div>)}</div><button className="inspector-secondary" type="button" onClick={() => openSource("quality-report.json")}><Code2 /> Inspect quality-report.json</button></section>}

          {tab === "code" && <section className="inspector-section"><div className="inspector-heading"><span><Code2 /> Code & Git</span><b>OWNED</b></div><div className="file-tree"><button type="button" onClick={() => openSource("index.html")}><Code2 /> index.html <b>generated</b></button><button type="button" onClick={() => openSource("project.json")}><Settings2 /> project.json <b>editable</b></button><button type="button" onClick={() => openSource("quality-report.json")}><ShieldCheck /> quality-report.json <b>{quality.score}/100</b></button><span><GitBranch /> .github/workflows/pages.yml <b>deploy</b></span><span><Cloud /> vercel · netlify · wrangler <b>ready</b></span></div><div className="git-card"><div><GitBranch /><span><strong>Git-ready workspace</strong><small>main · {checkpoints.length} local commits</small></span></div><p>ZIP contains the runnable app, validated project source, integration manifest, smoke test and deployment workflows. Two-way GitHub OAuth remains an honest infrastructure upgrade.</p><button type="button" onClick={() => downloadSource("github")}><GitCommit /> Export & continue to GitHub <ExternalLink /></button></div><button className="inspector-secondary" type="button" onClick={() => openSource("index.html")}><Code2 /> Open source workspace</button><button className="inspector-primary" type="button" onClick={() => downloadSource()}><Download /> Download runnable app + source</button></section>}

          {tab === "history" && <section className="inspector-section"><div className="inspector-heading"><span><History /> Checkpoints</span><b>{checkpoints.length}</b></div><p className="inspector-copy">Every applied Director or design direction creates a restore point.</p><div className="checkpoint-list">{[...checkpoints].reverse().map((checkpoint, index) => <button type="button" key={checkpoint.id} disabled={index === 0} onClick={() => commitSpec(checkpoint.spec, `Restored ${checkpoint.label}`, "manual")}><span><i className={checkpoint.source} /><strong>{checkpoint.label}</strong><small>{new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {checkpoint.source}</small></span>{index === 0 ? <b>Current</b> : <Undo2 />}</button>)}</div></section>}
        </aside>

        <section className="runtime-stage">
          <div className="stage-toolbar"><div className="device-switch"><button type="button" className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}><Monitor /> Desktop</button><button type="button" className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}><Smartphone /> Mobile</button></div><div><button type="button" className={designMode ? "active" : ""} onClick={() => setDesignMode((value) => !value)}><MousePointer2 /> Design mode</button><button type="button" onClick={() => openSource("index.html")}><Code2 /> Code</button><button type="button" className={quality.readyToPublish ? "quality-ready" : ""} onClick={() => setTab("quality")}><ShieldCheck /> {quality.score}</button><button type="button" onClick={openRuntime}><ExternalLink /> Fullscreen</button></div></div>
          <div className={`runtime-browser ${device}`}><div className="browser-bar"><span><i /><i /><i /></span><strong>{project.spec.slug}.live</strong><b><i /> Live preview</b></div><iframe ref={iframeRef} key={`${project.updatedAt}:${Boolean(previewGameAssets.background)}:${Boolean(previewGameAssets.sprite)}`} title={`${project.spec.name} live application`} srcDoc={runtimeHtml} sandbox="allow-scripts allow-forms allow-popups allow-downloads" onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "drops-studio-design-mode", enabled: designMode }, "*")} /></div>
        </section>

        <aside className="assistant-panel">
          <header><span><span className="director-avatar"><Sparkles /></span><span><strong>Drops Director</strong><small>{modelLabels[activeProvider]} · project context on</small></span></span><button type="button" aria-label="Open connections" onClick={() => setTab("connections")}><Settings2 /></button></header>
          {selectedBlock && <div className="chat-context"><MousePointer2 /><span>Editing context: <strong>{selectedBlock.label}</strong></span><button type="button" onClick={() => setSelectedBlock(null)}><X /></button></div>}
          <div className="conversation">{(project.conversation?.length ?? 0) <= 1 && <div className="assistant-guide"><strong>Build with context, not from zero</strong><p>I already know this preset’s user loop, modules, Drops data contract and action boundaries.</p><span><MousePointer2 /><b>Select a block</b><small>then describe a targeted change</small></span><span><Palette /><b>Ask for directions</b><small>cartoon, terminal, editorial, glass</small></span><span><Blocks /><b>Change behavior</b><small>layout, data view, rules and social loop</small></span><span><Undo2 /><b>Experiment safely</b><small>every Apply creates a checkpoint</small></span></div>}{(project.conversation ?? []).map((message) => <article className={message.role} key={message.id}><span>{message.role === "assistant" ? <Sparkles /> : "You"}</span><p>{message.content}</p>{message.proposal && <div className="proposal-card"><header><span><WandSparkles /><strong>{message.proposal.label}</strong></span><b>Preview</b></header><ul>{message.proposal.summary.map((item) => <li key={item}><Check />{item}</li>)}</ul><div><button type="button" onClick={() => dismissProposal(message)}>Dismiss</button><button type="button" onClick={() => applyChatProposal(message)}><Check /> Apply changes</button></div></div>}</article>)}{directing && <article className="assistant thinking"><span><LoaderCircle className="spin" /></span><p>Planning a bounded change set, checking the product category and preserving Drops foundations…</p></article>}<div ref={chatEndRef} /></div>
          <div className="quick-prompts">{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => void sendDirectorPrompt(prompt)}>{prompt}</button>)}</div>
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendDirectorPrompt(); }}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={selectedBlock ? `Tell Director how to change ${selectedBlock.label}…` : "Describe a product, visual or behavior change…"} rows={3} /><footer><span><Sparkles /> {modelLabels[activeProvider]}</span><button type="submit" disabled={!chatInput.trim() || directing} aria-label="Send change request"><Send /></button></footer></form>
          <div className="assistant-foot"><ShieldCheck /> Suggestions never change the app until you press Apply.</div>
        </aside>
      </div>

      <footer className="project-statusbar"><span><Check /> Autosaved <small>{new Date(project.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span><span><Database /> DropsTab foundation <b>15m cache</b></span><span><Bot /> Drops Bot <strong>{externalSetup ? "Connection pending" : "Action handoff"}</strong></span><span><ShieldCheck /> Quality <strong>{quality.score}/100</strong></span><span className={externalSetup ? "" : "operational"}><i /> {releaseLabel}</span></footer>

      <Dialog.Root open={sourceOpen} onOpenChange={setSourceOpen}><Dialog.Portal><Dialog.Overlay className="studio-dialog-overlay" /><Dialog.Content className="source-dialog"><div><div><Dialog.Title>Owned source workspace</Dialog.Title><Dialog.Description>Inspect the exact runtime, edit validated project.json and export the same files you run.</Dialog.Description></div><Dialog.Close><X /></Dialog.Close></div><nav className="source-tabs" aria-label="Source files">{(["index.html", "project.json", "quality-report.json"] as SourceFile[]).map((file) => <button type="button" className={sourceFile === file ? "active" : ""} key={file} onClick={() => { setSourceFile(file); if (file === "project.json") setSourceDraft(JSON.stringify(project.spec, null, 2)); }}>{file === "index.html" ? <Code2 /> : file === "project.json" ? <Settings2 /> : <ShieldCheck />}{file}</button>)}</nav>{sourceFile === "project.json" ? <textarea className="source-editor" spellCheck={false} value={sourceDraft || JSON.stringify(project.spec, null, 2)} onChange={(event) => setSourceDraft(event.target.value)} aria-label="Editable project JSON" /> : <pre>{activeSourceContent}</pre>}<footer><button type="button" onClick={() => { if (!navigator.clipboard?.writeText) { setToast("Copy is unavailable in this browser"); return; } void navigator.clipboard.writeText(activeSourceContent).then(() => setToast(`${sourceFile} copied`)).catch(() => setToast("Could not copy this file")); }}><Copy /> Copy file</button>{sourceFile === "project.json" && <button type="button" onClick={applyProjectJson}><Check /> Validate & apply</button>}<button type="button" onClick={() => downloadSource()}><Download /> Download full ZIP</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}><Dialog.Portal><Dialog.Overlay className="studio-dialog-overlay" /><Dialog.Content className="publish-dialog"><header><div><Dialog.Title>{externalSetup ? "Publish the real setup app" : researchOnly ? "Publish the research app" : "Publish a working product"}</Dialog.Title><Dialog.Description>{externalSetup ? "The public web app is real; the external destination stays pending until the user connects and verifies it." : "Free public app now, professional hosting whenever you need it."}</Dialog.Description></div><Dialog.Close><X /></Dialog.Close></header><div className="publish-grid"><section className={`host-card cloud-card ${published && !dirty ? "published" : ""}`}><div className="host-title"><span><Cloud /></span><div><strong>Free Drops Studio Cloud</strong><small>{externalSetup ? "Working setup app · instant public link" : "Working app · instant public link"}</small></div><b>FREE</b></div><ul><li><Check /> {externalSetup ? "Public configuration and verification app" : "Public playable/useable app"}</li><li><Check /> Global edge delivery + HTTPS</li><li><Check /> No connected secret included</li><li><Check /> Republish after edits</li></ul>{externalSetup && <div className="safety-note"><ShieldCheck /><span><strong>External setup required</strong><small>{reality.requires.join(" · ")}</small></span></div>}{published && <div className="public-url"><span>{dirty ? "Last public version" : "Public URL"}</span><button type="button" onClick={() => project.publishedUrl && window.open(project.publishedUrl, "_blank", "noopener,noreferrer")}><strong>{project.publishedUrl}</strong><ExternalLink /></button></div>}<button className="cloud-publish" type="button" onClick={handleCloudPublish} disabled={publishing}>{publishing ? <><LoaderCircle className="spin" /> Publishing…</> : published && dirty ? <><UploadCloud /> Publish working update</> : published ? <><BadgeCheck /> Open published app</> : <><Rocket /> Publish free now</>}</button>{publishError && <p className="publish-error">{publishError}</p>}</section><section className="pro-hosts"><h3>Professional hosting</h3><p>Export the same working source to your own account and domain.</p><button type="button" onClick={() => downloadSource("vercel")}><Globe2 /><span><strong>Vercel</strong><small>Domains · analytics · serverless routes</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("cloudflare")}><Cloud /><span><strong>Cloudflare Pages</strong><small>Edge hosting · custom routes</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("netlify")}><Cloud /><span><strong>Netlify</strong><small>Static deploy · functions</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("github")}><GitBranch /><span><strong>GitHub</strong><small>Repository-owned source</small></span><ExternalLink /></button></section></div><footer><button type="button" onClick={() => downloadSource()}><Download /> Download runnable app + source</button><span><ShieldCheck /> Published app and source contain no connected AI or Telegram keys.</span></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <div className={`project-toast ${toast ? "show" : ""}`} role="status"><Check />{toast}</div>
    </main>
  );
}
