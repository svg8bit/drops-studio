"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's next/link shim currently duplicates React during browser navigation; plain anchors preserve a working route transition. */

import * as Dialog from "@radix-ui/react-dialog";
import { zipSync, strToU8 } from "fflate";
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
import { createFreeDirectorProposal, DESIGN_DIRECTIONS, type DirectorProposal } from "@/lib/project-director";
import type {
  GeneratedProject,
  GeneratedProjectSpec,
  ProjectChatMessage,
  ProjectCheckpoint,
  ProjectDesignKit,
  ProjectProvider,
} from "@/lib/project-types";
import { PROJECTS_STORAGE_KEY } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import { presets } from "@/lib/presets";

type InspectorTab = "director" | "design" | "data" | "logic" | "brain" | "code" | "history";
type HostingProvider = "vercel" | "cloudflare" | "netlify" | "github";
type DeviceMode = "desktop" | "mobile";

const modelLabels: Record<ProjectProvider, string> = {
  free: "Free Director",
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
  "alpha-channel": ["Make this feel like a premium creator studio", "Spotlight the sourced post composer", "Use an editorial Telegram feed", "Make the growth loop more social"],
  "morning-alpha": ["Make the brief premium and compact", "Use an editorial daily layout", "Spotlight today’s decision card", "Turn catalysts into a timeline"],
  "prediction-impact": ["Make the event-to-token map the hero", "Use a professional impact terminal", "Turn related assets into a graph", "Make reversal actions clearer"],
  "smart-money-copy": ["Use a risk-first strategy monitor", "Spotlight the paper ledger", "Make wallet activity a timeline", "Use a compact terminal design"],
  "crypto-aggregator": ["Use a dense sortable market table", "Make search and filters the hero", "Add a glass market explorer feel", "Spotlight the watchlist workflow"],
  "crypto-game": ["Make it a cartoon game with coin mascots", "Create a neon arcade version", "Set round timer to 12 seconds", "Make the leaderboard spotlight"],
  "personal-companion": ["Make recommendations feel more personal", "Use a friendly discovery feed", "Spotlight the taste graph", "Make explanations more editorial"],
  "portfolio-tamagotchi": ["Make the creature world more playful", "Spotlight portfolio health", "Use a cute mascot design", "Make daily care more social"],
  "crypto-product-hunt": ["Make this a premium launch discovery feed", "Spotlight today’s top launch", "Use community-first social design", "Turn project context into cards"],
  "crypto-radio": ["Make this feel like a real audio studio", "Spotlight the live player", "Use an editorial show rundown", "Make scheduled episodes clearer"],
  "crypto-siri": ["Make the voice orb cinematic", "Use a focused assistant layout", "Spotlight sourced answer cards", "Make alert handoff more obvious"],
};

function nowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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

function readme(spec: GeneratedProjectSpec): string {
  return `# ${spec.name}

This is a standalone crypto product generated by Drops Studio.

## Run locally

Open \`index.html\` directly, or serve this folder with \`npx serve .\`.

## Foundation

- DropsTab is the market data, research and context layer.
- Drops Bot is the alert, Telegram and approved action handoff layer.
- Live requests use the public data adapter in \`project.json\`.
- No AI or product API key is bundled in this export.

## Deploy

The package works on Vercel, Cloudflare Pages, Netlify and GitHub Pages with the included files.
`;
}

function projectArchive(project: GeneratedProject): Uint8Array {
  const slug = project.spec.slug;
  return zipSync({
    "index.html": strToU8(project.html),
    "README.md": strToU8(readme(project.spec)),
    "project.json": strToU8(JSON.stringify(project.spec, null, 2)),
    "vercel.json": strToU8(JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2)),
    "netlify.toml": strToU8(`[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n`),
    "wrangler.toml": strToU8(`name = "${slug}"\ncompatibility_date = "2026-07-28"\n[assets]\ndirectory = "."\n`),
    ".github/workflows/pages.yml": strToU8(`name: Deploy static site to Pages\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\njobs:\n  deploy:\n    environment:\n      name: github-pages\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: .\n      - uses: actions/deploy-pages@v4\n`),
  }, { level: 6 });
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
  const [selectedBlock, setSelectedBlock] = useState<{ id: string; label: string } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [directing, setDirecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [newModule, setNewModule] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = readProjects().find((item) => item.id === params.id) ?? null;
      if (found) {
        const spec = validateProjectSpec(found.spec);
        const checkpoint: ProjectCheckpoint = { id: nowId("checkpoint"), label: "Working baseline", createdAt: new Date().toISOString(), source: "system", spec };
        const migrated: GeneratedProject = {
          ...found,
          spec,
          html: compileProject(spec),
          checkpoints: found.checkpoints?.length ? found.checkpoints.map((item) => ({ ...item, spec: validateProjectSpec(item.spec) })).slice(-12) : [checkpoint],
          conversation: found.conversation?.length ? found.conversation : [assistantWelcome(spec)],
        };
        saveProject(migrated);
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
      if (!event.data || !event.source) return;
      if (event.data.type === "drops-studio-data-request") {
        void fetch("/api/public-data", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((payload) => (event.source as Window).postMessage({ type: "drops-studio-data-response", payload }, "*"))
          .catch(() => (event.source as Window).postMessage({ type: "drops-studio-data-response", payload: { source: "Saved DropsTab-compatible snapshot" } }, "*"));
      }
      if (event.data.type === "drops-studio-block-selected") {
        setSelectedBlock({ id: String(event.data.blockId || "application"), label: String(event.data.label || event.data.blockId || "Application") });
        setTab("design");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "drops-studio-design-mode", enabled: designMode }, "*");
  }, [designMode, project?.updatedAt]);

  const preset = presets.find((item) => item.id === project?.spec.presetId);
  const activeProvider = useMemo(() => {
    if (!project) return "free" as ProjectProvider;
    return (window.sessionStorage?.getItem("drops-studio:active-brain") || project.spec.brain.provider || "free") as ProjectProvider;
  }, [project]);

  const replaceProject = useCallback((next: GeneratedProject) => {
    saveProject(next);
    setProject(next);
    setDirty(true);
  }, []);

  const updateSpecQuiet = useCallback((update: (spec: GeneratedProjectSpec) => GeneratedProjectSpec) => {
    setProject((current) => {
      if (!current) return current;
      const spec = validateProjectSpec(update(current.spec));
      const next = { ...current, spec, html: compileProject(spec), updatedAt: new Date().toISOString() };
      saveProject(next);
      return next;
    });
    setDirty(true);
  }, []);

  function commitSpec(specInput: GeneratedProjectSpec, label: string, source: ProjectCheckpoint["source"] = "manual", conversation?: ProjectChatMessage[]) {
    if (!project) return;
    const spec = validateProjectSpec(specInput);
    const checkpoint: ProjectCheckpoint = { id: nowId("checkpoint"), label, createdAt: new Date().toISOString(), source, spec };
    replaceProject({
      ...project,
      spec,
      html: compileProject(spec),
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
    if (!project || !selectedBlock) return;
    const current = project.spec.blocks[selectedBlock.id] ?? { visible: true, variant: "default" as const };
    commitSpec(validateProjectSpec({ ...project.spec, blocks: { ...project.spec.blocks, [selectedBlock.id]: { ...current, ...update } } }), `Edited ${selectedBlock.label}`, "design");
  }

  function undo() {
    if (!project || (project.checkpoints?.length ?? 0) < 2) {
      setToast("No earlier checkpoint yet");
      return;
    }
    const checkpoints = [...(project.checkpoints ?? [])];
    checkpoints.pop();
    const previous = checkpoints[checkpoints.length - 1];
    const next = { ...project, spec: previous.spec, html: compileProject(previous.spec), updatedAt: new Date().toISOString(), checkpoints };
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
            { role: "system", content: "Return JSON only. You may improve name, tagline, description, theme, design, experience and gameDirection. Preserve the preset and DropsTab/Drops Bot foundations. Never return code, URLs or API keys." },
            { role: "user", content: JSON.stringify({ instruction, product: directorModelContext(project.spec) }) },
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
          gameDirection: project.spec.gameDirection ? { ...project.spec.gameDirection, ...(suggestion.gameDirection ?? {}) } : undefined,
          brain: { provider: "custom", model, enhanced: true },
        });
        proposal = { label: `${model} proposal`, summary: ["Applied the requested direction through your custom model.", "Preserved the validated crypto product contract."], affected: ["Product brief", "Experience", "Design"], spec: customSpec };
      } else if (provider !== "free" && key) {
        const model = window.sessionStorage.getItem(`drops-studio:${provider}:model`) || project.spec.brain.model;
        const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, key, model, prompt: instruction, spec: project.spec }) });
        const payload = await response.json() as { spec?: GeneratedProjectSpec; error?: string };
        if (!response.ok || !payload.spec) throw new Error(payload.error || "Connected Director failed.");
        proposal = { label: `${modelLabels[provider]} proposal`, summary: ["Applied the requested product direction through the connected model.", "Preserved the DropsTab and Drops Bot contracts."], affected: ["Product brief", "Design system"], spec: payload.spec };
      } else {
        proposal = createFreeDirectorProposal(project.spec, instruction, selectedBlock?.id);
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
      const fallback = createFreeDirectorProposal(project.spec, instruction, selectedBlock?.id);
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
      setToast("Working public app published");
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

  function downloadSource(nextHost?: HostingProvider) {
    if (!project) return;
    const bytes = projectArchive(project);
    downloadBlob(`${project.spec.slug}-source.zip`, new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }));
    setToast(nextHost ? `Git-ready deployment package created for ${nextHost}` : "Runnable app + source ZIP downloaded");
    if (nextHost) window.setTimeout(() => window.open(hostLinks[nextHost], "_blank", "noopener,noreferrer"), 450);
  }

  if (!loaded) return <div className="studio-loading"><LoaderCircle className="spin" /> Loading product workspace…</div>;
  if (!project || !preset) return <main className="studio-missing"><span><Rocket /></span><h1>Project not found</h1><p>This local project may belong to another browser.</p><a href="/">Create a working product</a></main>;

  const published = Boolean(project.publishedUrl);
  const checkpoints = project.checkpoints ?? [];
  const nav: Array<{ id: InspectorTab; label: string; icon: typeof Settings2 }> = [
    { id: "director", label: "Director", icon: Sparkles },
    { id: "design", label: "Design", icon: Palette },
    { id: "data", label: "Data", icon: Database },
    { id: "logic", label: "Logic", icon: Blocks },
    { id: "brain", label: "AI", icon: BrainCircuit },
    { id: "code", label: "Code", icon: Code2 },
    { id: "history", label: "Versions", icon: History },
  ];
  const game = project.spec.gameDirection;
  const quickPrompts = categoryPrompts[project.spec.presetId];

  return (
    <main className="project-studio-shell">
      <header className="project-studio-topbar">
        <div className="project-crumbs"><a href="/" aria-label="Back to builder"><ArrowLeft /></a><span className="studio-brand-mark">◒</span><strong>Drops Studio</strong><i>/</i><span>{project.spec.name}</span><b className={published && !dirty ? "running" : "draft"}><i />{published && !dirty ? "Running" : dirty ? "Edits pending" : "Draft"}</b></div>
        <div className="workspace-actions"><button type="button" onClick={undo} disabled={checkpoints.length < 2}><Undo2 /> Undo</button><button type="button" onClick={openRuntime}><Play /> Run app</button><button type="button" onClick={share} disabled={publishing}><Share2 /> Share</button><button className="publish-top" type="button" onClick={() => setPublishOpen(true)}><UploadCloud /> {published && dirty ? "Publish update" : published ? "Published" : "Publish"}<ChevronDown /></button></div>
      </header>

      <div className="project-studio-layout">
        <aside className="studio-rail">
          {nav.map((item) => { const Icon = item.icon; return <button type="button" title={item.label} aria-label={item.label} className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}><Icon /><span>{item.label}</span></button>; })}
          <div className="rail-foundation"><span title="DropsTab attached"><Database /></span><span title="Drops Bot attached"><Bot /></span></div>
        </aside>

        <aside className="studio-inspector">
          {tab === "director" && <section className="inspector-section">
            <div className="inspector-heading"><span><Sparkles /> Product Director</span><b>FREE</b></div>
            <p className="inspector-copy">Turns intent into a category-aware product plan before changes reach the working app.</p>
            <div className="director-pipeline"><span className="done"><i>1</i><b>Brief</b><small>{preset.shortTitle}</small></span><span className="done"><i>2</i><b>Experience</b><small>{game ? game.genre.replace(/-/g, " ") : preset.output}</small></span><span className="done"><i>3</i><b>Foundation</b><small>DropsTab × Drops Bot</small></span><span><i>4</i><b>Ship</b><small>Test and publish</small></span></div>
            <label>Product name<input value={project.spec.name} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, name: event.target.value }))} /></label>
            <label>Product promise<textarea rows={4} value={project.spec.tagline} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, tagline: event.target.value }))} /></label>
            <div className="experience-brief"><span><Layers3 /> Experience brief</span><dl><div><dt>Archetype</dt><dd>{project.spec.experience.archetype.replace(/-/g, " ")}</dd></div><div><dt>Layout</dt><dd>{project.spec.experience.layout}</dd></div><div><dt>Data view</dt><dd>{project.spec.experience.dataView}</dd></div><div><dt>Loop</dt><dd>{project.spec.experience.engagement}</dd></div></dl><p>{project.spec.experience.primaryLoop}</p><div>{project.spec.experience.modules.map((module) => <i key={module}>{module}</i>)}</div></div>
            {game && <div className="game-brief"><span><Gamepad2 /> Game brief</span><dl><div><dt>Genre</dt><dd>{game.genre.replace(/-/g, " ")}</dd></div><div><dt>World</dt><dd>{game.world.replace(/-/g, " ")}</dd></div><div><dt>Art</dt><dd>{game.artStyle}</dd></div><div><dt>Loop</dt><dd>{game.roundSeconds}s · {game.difficulty}</dd></div></dl><p>{game.gameLoop}</p></div>}
            <button className="inspector-primary" type="button" onClick={() => void sendDirectorPrompt(game ? "Make this game feel more visual, playful and shareable" : "Improve the product hierarchy and primary user loop")}><WandSparkles /> Ask Director to improve it</button>
          </section>}

          {tab === "design" && <section className="inspector-section">
            <div className="inspector-heading"><span><Palette /> Design Canvas</span><b className="free-badge">FREE</b></div>
            <button type="button" className={`design-mode-control ${designMode ? "active" : ""}`} onClick={() => setDesignMode((value) => !value)}><MousePointer2 /><span><strong>{designMode ? "Selecting elements" : "Select in preview"}</strong><small>Click any outlined block to edit it</small></span><i>{designMode ? "ON" : "OFF"}</i></button>
            {selectedBlock && <div className="selected-inspector"><div><span>Selected block</span><strong><Layers3 /> {selectedBlock.label}</strong></div><label>Variant<select value={project.spec.blocks[selectedBlock.id]?.variant ?? "default"} onChange={(event) => updateSelectedBlock({ variant: event.target.value as "default" | "compact" | "wide" | "spotlight" })}><option value="default">Default</option><option value="compact">Compact</option><option value="wide">Wide</option><option value="spotlight">Spotlight</option></select></label><label className="toggle-line"><input type="checkbox" checked={project.spec.blocks[selectedBlock.id]?.visible !== false} onChange={(event) => updateSelectedBlock({ visible: event.target.checked })} /> Visible in the app</label></div>}
            <span className="section-label">Design directions</span>
            <div className="design-kits">{DESIGN_DIRECTIONS.map((direction) => <button type="button" className={project.spec.design.kit === direction.id ? "active" : ""} key={direction.id} onClick={() => applyKit(direction.id)}><span className="kit-preview" style={{ background: `linear-gradient(135deg,${direction.palette.join(",")})` }}><i /><i /><i /></span><span><strong>{direction.name}</strong><small>{direction.bestFor}</small></span>{project.spec.design.kit === direction.id && <Check />}</button>)}</div>
            <div className="design-tokens"><label>Accent<div className="color-field"><input type="color" value={project.spec.theme.accent} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, theme: { ...spec.theme, accent: event.target.value } }))} /><input value={project.spec.theme.accent} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, theme: { ...spec.theme, accent: event.target.value } }))} /></div></label><label>Density<select value={project.spec.design.density} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, design: { ...spec.design, density: event.target.value as GeneratedProjectSpec["design"]["density"] } }))}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="cinematic">Cinematic</option></select></label><label>Motion<select value={project.spec.design.motion} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, design: { ...spec.design, motion: event.target.value as GeneratedProjectSpec["design"]["motion"] } }))}><option value="reduced">Reduced</option><option value="smooth">Smooth</option><option value="expressive">Expressive</option></select></label></div>
            <label className="art-upload"><ImageIcon /><span><strong>{game ? "Replace game world artwork" : "Add product hero artwork"}</strong><small>Auto-optimized · included in public app and ZIP</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleArtUpload(event.target.files?.[0])} /></label>
          </section>}

          {tab === "data" && <section className="inspector-section"><div className="inspector-heading"><span><Database /> Data foundation</span><BadgeCheck /></div><p className="inspector-copy">The app uses the public adapter when available and an explicit saved snapshot as fallback.</p><div className="foundation-card"><span><Database /></span><div><strong>DropsTab-compatible market feed</strong><small>Prices · change · market cap · context</small></div><b>LIVE</b></div><div className="asset-list">{project.spec.market.map((coin) => <div key={coin.symbol}><span>{coin.symbol.slice(0, 2)}</span><div><strong>{coin.symbol}</strong><small>{coin.name}</small></div><b className={coin.change >= 0 ? "up" : "down"}>{coin.change >= 0 ? "+" : ""}{coin.change.toFixed(2)}%</b></div>)}</div><div className="safety-note"><ShieldCheck /><span><strong>No secret in the output</strong><small>Connected keys stay session-only and never enter publish or ZIP.</small></span></div><button className="inspector-secondary" type="button" onClick={() => window.open("https://api-docs.dropstab.com/", "_blank", "noopener,noreferrer")}><Database /> DropsTab API docs <ExternalLink /></button></section>}

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
              {game && <><span className="section-label">Game system</span><div className="logic-grid"><label>Difficulty<select value={game.difficulty} onChange={(event) => commitSpec(validateProjectSpec({ ...project.spec, gameDirection: { ...game, difficulty: event.target.value } }), "Changed game difficulty")}><option value="casual">Casual</option><option value="normal">Normal</option><option value="expert">Expert</option></select></label><label>Demo timer<input type="number" min={5} max={120} value={game.roundSeconds} onChange={(event) => updateSpecQuiet((spec) => ({ ...spec, gameDirection: spec.gameDirection ? { ...spec.gameDirection, roundSeconds: Number(event.target.value) } : undefined }))} /></label></div></>}
              <div className="tool-stack"><span>Working capabilities</span>{project.spec.tools.map((tool) => <div key={tool}><Check /> {tool}</div>)}</div>
            </section>
          )}

          {tab === "brain" && <section className="inspector-section"><div className="inspector-heading"><span><BrainCircuit /> AI brain</span><b>{activeProvider === "free" ? "FREE" : "BYO"}</b></div><div className="brain-card"><span><Sparkles /></span><div><strong>{modelLabels[activeProvider]}</strong><small>{activeProvider === "free" ? "Deterministic crypto-aware Director" : "Connected account · session only"}</small></div><b>Ready</b></div><div className="ai-capabilities"><span><Check /> Product planning and bounded patches</span><span><Check /> Category-aware visual direction</span><span><Check /> Free fallback when a provider fails</span><span><Check /> No key compiled into projects</span></div><button className="inspector-primary" type="button" onClick={() => { window.location.href = "/?connections=1"; }}><KeyRound /> Connect or change AI</button><div className="upgrade-card"><strong>Optional professional layer</strong><p>Use your own model for deeper naming and art direction. The working free compiler remains available.</p><span>OpenAI · Claude · OpenRouter · Kimi · Custom</span></div></section>}

          {tab === "code" && <section className="inspector-section"><div className="inspector-heading"><span><Code2 /> Code & Git</span><b>OWNED</b></div><div className="file-tree"><span><Code2 /> index.html <b>generated</b></span><span><Settings2 /> project.json <b>source</b></span><span><GitBranch /> .github/workflows/pages.yml <b>deploy</b></span><span><Cloud /> vercel · netlify · wrangler <b>ready</b></span></div><div className="git-card"><div><GitBranch /><span><strong>Git-ready workspace</strong><small>main · {checkpoints.length} local commits</small></span></div><p>ZIP contains a runnable app and deployment workflows. Two-way GitHub OAuth is intentionally shown as an upgrade until a real GitHub App is connected.</p><button type="button" onClick={() => downloadSource("github")}><GitCommit /> Export & continue to GitHub <ExternalLink /></button></div><button className="inspector-secondary" type="button" onClick={() => setSourceOpen(true)}><Code2 /> Inspect exact generated source</button><button className="inspector-primary" type="button" onClick={() => downloadSource()}><Download /> Download runnable app + source</button></section>}

          {tab === "history" && <section className="inspector-section"><div className="inspector-heading"><span><History /> Checkpoints</span><b>{checkpoints.length}</b></div><p className="inspector-copy">Every applied Director or design direction creates a restore point.</p><div className="checkpoint-list">{[...checkpoints].reverse().map((checkpoint, index) => <button type="button" key={checkpoint.id} disabled={index === 0} onClick={() => commitSpec(checkpoint.spec, `Restored ${checkpoint.label}`, "manual")}><span><i className={checkpoint.source} /><strong>{checkpoint.label}</strong><small>{new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {checkpoint.source}</small></span>{index === 0 ? <b>Current</b> : <Undo2 />}</button>)}</div></section>}
        </aside>

        <section className="runtime-stage">
          <div className="stage-toolbar"><div className="device-switch"><button type="button" className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}><Monitor /> Desktop</button><button type="button" className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}><Smartphone /> Mobile</button></div><div><button type="button" className={designMode ? "active" : ""} onClick={() => setDesignMode((value) => !value)}><MousePointer2 /> Design mode</button><button type="button" onClick={() => setSourceOpen(true)}><Code2 /> Code</button><button type="button" onClick={openRuntime}><ExternalLink /> Fullscreen</button></div></div>
          <div className={`runtime-browser ${device}`}><div className="browser-bar"><span><i /><i /><i /></span><strong>{project.spec.slug}.live</strong><b><i /> Live preview</b></div><iframe ref={iframeRef} key={project.updatedAt} title={`${project.spec.name} live application`} srcDoc={project.html} sandbox="allow-scripts allow-forms allow-popups allow-downloads" onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "drops-studio-design-mode", enabled: designMode }, "*")} /></div>
        </section>

        <aside className="assistant-panel">
          <header><span><span className="director-avatar"><Sparkles /></span><span><strong>Drops Director</strong><small>{modelLabels[activeProvider]} · project context on</small></span></span><button type="button" onClick={() => setTab("brain")}><Settings2 /></button></header>
          {selectedBlock && <div className="chat-context"><MousePointer2 /><span>Editing context: <strong>{selectedBlock.label}</strong></span><button type="button" onClick={() => setSelectedBlock(null)}><X /></button></div>}
          <div className="conversation">{(project.conversation?.length ?? 0) <= 1 && <div className="assistant-guide"><strong>Build with context, not from zero</strong><p>I already know this preset’s user loop, modules, Drops data contract and action boundaries.</p><span><MousePointer2 /><b>Select a block</b><small>then describe a targeted change</small></span><span><Palette /><b>Ask for directions</b><small>cartoon, terminal, editorial, glass</small></span><span><Blocks /><b>Change behavior</b><small>layout, data view, rules and social loop</small></span><span><Undo2 /><b>Experiment safely</b><small>every Apply creates a checkpoint</small></span></div>}{(project.conversation ?? []).map((message) => <article className={message.role} key={message.id}><span>{message.role === "assistant" ? <Sparkles /> : "You"}</span><p>{message.content}</p>{message.proposal && <div className="proposal-card"><header><span><WandSparkles /><strong>{message.proposal.label}</strong></span><b>Preview</b></header><ul>{message.proposal.summary.map((item) => <li key={item}><Check />{item}</li>)}</ul><div><button type="button" onClick={() => dismissProposal(message)}>Dismiss</button><button type="button" onClick={() => applyChatProposal(message)}><Check /> Apply changes</button></div></div>}</article>)}{directing && <article className="assistant thinking"><span><LoaderCircle className="spin" /></span><p>Planning a bounded change set, checking the product category and preserving Drops foundations…</p></article>}<div ref={chatEndRef} /></div>
          <div className="quick-prompts">{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => void sendDirectorPrompt(prompt)}>{prompt}</button>)}</div>
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendDirectorPrompt(); }}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={selectedBlock ? `Tell Director how to change ${selectedBlock.label}…` : "Describe a product, visual or behavior change…"} rows={3} /><footer><span><Sparkles /> {modelLabels[activeProvider]}</span><button type="submit" disabled={!chatInput.trim() || directing} aria-label="Send change request"><Send /></button></footer></form>
          <div className="assistant-foot"><ShieldCheck /> Suggestions never change the app until you press Apply.</div>
        </aside>
      </div>

      <footer className="project-statusbar"><span><Check /> Autosaved <small>{new Date(project.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span><span><Database /> DropsTab adapter <b>Live</b></span><span><Bot /> Drops Bot <strong>Action handoff</strong></span><span><BrainCircuit /> AI <strong>{modelLabels[activeProvider]}</strong></span><span className="operational"><i /> Product running</span></footer>

      <Dialog.Root open={sourceOpen} onOpenChange={setSourceOpen}><Dialog.Portal><Dialog.Overlay className="studio-dialog-overlay" /><Dialog.Content className="source-dialog"><div><div><Dialog.Title>Exact runnable source</Dialog.Title><Dialog.Description>This is the standalone product currently rendered in Preview and included in publish/export.</Dialog.Description></div><Dialog.Close><X /></Dialog.Close></div><pre>{project.html}</pre><footer><button type="button" onClick={() => navigator.clipboard.writeText(project.html).then(() => setToast("Source copied"))}><Copy /> Copy HTML</button><button type="button" onClick={() => downloadSource()}><Download /> Download full ZIP</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}><Dialog.Portal><Dialog.Overlay className="studio-dialog-overlay" /><Dialog.Content className="publish-dialog"><header><div><Dialog.Title>Publish a working product</Dialog.Title><Dialog.Description>Free public app now, professional hosting whenever you need it.</Dialog.Description></div><Dialog.Close><X /></Dialog.Close></header><div className="publish-grid"><section className={`host-card cloud-card ${published && !dirty ? "published" : ""}`}><div className="host-title"><span><Cloud /></span><div><strong>Free Drops Studio Cloud</strong><small>Working app · instant public link</small></div><b>FREE</b></div><ul><li><Check /> Public playable/useable app</li><li><Check /> Global edge delivery + HTTPS</li><li><Check /> No AI key required</li><li><Check /> Republish after edits</li></ul>{published && <div className="public-url"><span>{dirty ? "Last public version" : "Public URL"}</span><button type="button" onClick={() => project.publishedUrl && window.open(project.publishedUrl, "_blank", "noopener,noreferrer")}><strong>{project.publishedUrl}</strong><ExternalLink /></button></div>}<button className="cloud-publish" type="button" onClick={() => void publish()} disabled={publishing}>{publishing ? <><LoaderCircle className="spin" /> Publishing…</> : published && dirty ? <><UploadCloud /> Publish working update</> : published ? <><BadgeCheck /> Open published app</> : <><Rocket /> Publish free now</>}</button>{publishError && <p className="publish-error">{publishError}</p>}</section><section className="pro-hosts"><h3>Professional hosting</h3><p>Export the same working source to your own account and domain.</p><button type="button" onClick={() => downloadSource("vercel")}><Globe2 /><span><strong>Vercel</strong><small>Domains · analytics · teams</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("cloudflare")}><Cloud /><span><strong>Cloudflare Pages</strong><small>Edge hosting · custom routes</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("netlify")}><Cloud /><span><strong>Netlify</strong><small>Static deploy · forms</small></span><ExternalLink /></button><button type="button" onClick={() => downloadSource("github")}><GitBranch /><span><strong>GitHub Pages</strong><small>Repository-owned deployment</small></span><ExternalLink /></button></section></div><footer><button type="button" onClick={() => downloadSource()}><Download /> Download runnable app + source</button><span><ShieldCheck /> Published app and source contain no connected AI keys.</span></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <div className={`project-toast ${toast ? "show" : ""}`} role="status"><Check />{toast}</div>
    </main>
  );
}
