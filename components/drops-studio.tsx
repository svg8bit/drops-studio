"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  Bot,
  BrainCircuit,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Database,
  ExternalLink,
  Gamepad2,
  HeartPulse,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Megaphone,
  Menu,
  Plus,
  Radio,
  Rocket,
  Save,
  Send,
  Sparkles,
  Sun,
  TableProperties,
  UsersRound,
  WalletCards,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PreviewCanvas, type MarketCoin, type PredictionEvent } from "@/components/preview-canvas";
import { compileProject } from "@/lib/project-compiler";
import { createProjectSpec } from "@/lib/project-factory";
import { applyAgentPlan, fallbackAgentPlan, type AgentProductPlan } from "@/lib/product-blueprint";
import type { GeneratedProject, GeneratedProjectSpec, ProjectProvider } from "@/lib/project-types";
import { PROJECTS_STORAGE_KEY } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import { defaultPresetId, presets, type PresetId } from "@/lib/presets";

type ProviderId = "free" | "dropstab" | "dropsbot" | "openai" | "anthropic" | "openrouter" | "kimi" | "custom";

interface Provider {
  id: ProviderId;
  name: string;
  eyebrow: string;
  description: string;
  keyLabel?: string;
  docs?: string;
  endpoint?: boolean;
}

const providerList: Provider[] = [
  { id: "free", name: "Free Auto", eyebrow: "No key", description: "Local planner plus the best available free workflow. Nothing to connect." },
  { id: "dropstab", name: "DropsTab API", eyebrow: "Live data", description: "Use your DropsTab API key for live prices, rankings, FDV, unlocks and research data.", keyLabel: "DropsTab API key", docs: "https://api-docs.dropstab.com/" },
  { id: "dropsbot", name: "Drops Bot", eyebrow: "Telegram", description: "Continue in the official bot to create profiles, wallet alerts, price alerts and channel delivery.", docs: "https://t.me/Drops" },
  { id: "openai", name: "OpenAI", eyebrow: "Bring your key", description: "Use your own OpenAI API project as the reasoning layer and choose any model available to that key.", keyLabel: "OpenAI API key", docs: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic", eyebrow: "Bring your key", description: "Connect Claude for long-form research, editorial voice and strategy explanations.", keyLabel: "Anthropic API key", docs: "https://console.anthropic.com/settings/keys" },
  { id: "openrouter", name: "OpenRouter Free", eyebrow: "Free + paid models", description: "Start with OpenRouter's free-model router, or enter any paid model ID available to your account.", keyLabel: "OpenRouter API key", docs: "https://openrouter.ai/keys" },
  { id: "kimi", name: "Kimi", eyebrow: "Long context", description: "Connect Moonshot Kimi models for research-heavy crypto workflows.", keyLabel: "Moonshot API key", docs: "https://platform.moonshot.ai/console/api-keys" },
  { id: "custom", name: "Custom API", eyebrow: "OpenAI compatible", description: "Connect any public HTTPS OpenAI-compatible chat-completions endpoint you control.", keyLabel: "Bearer token", endpoint: true },
];

const defaultModels: Partial<Record<ProviderId, string>> = {
  openai: "gpt-5.2",
  anthropic: "claude-haiku-4-5-20251001",
  openrouter: "openrouter/free",
  kimi: "kimi-k2.5",
};

const sampleMarket: MarketCoin[] = [
  { symbol: "BTC", name: "Bitcoin", price: "$118,420", change: 4.21, marketCap: "$2.35T" },
  { symbol: "ETH", name: "Ethereum", price: "$3,842", change: 2.84, marketCap: "$463B" },
  { symbol: "SOL", name: "Solana", price: "$192.40", change: 7.18, marketCap: "$91.7B" },
];

const defaultPrediction: PredictionEvent = {
  title: "Solana ETF approved in 2026?",
  probability: 68,
  change: 26,
};

const iconMap = {
  Zap,
  Megaphone,
  Sun,
  ChartNoAxesCombined,
  UsersRound,
  TableProperties,
  Gamepad2,
  Sparkles,
  HeartPulse,
  Rocket,
  Radio,
  AudioLines,
} as const;

const customTools = [
  { id: "prices", label: "Prices + markets", icon: Database },
  { id: "unlocks", label: "Unlocks + funding", icon: TableProperties },
  { id: "wallets", label: "Wallet triggers", icon: WalletCards },
  { id: "polymarket", label: "Polymarket events", icon: ChartNoAxesCombined },
  { id: "telegram", label: "Telegram delivery", icon: Send },
  { id: "voice", label: "Voice interface", icon: AudioLines },
];

function initialValues() {
  return Object.fromEntries(
    presets.map((preset) => [preset.id, Object.fromEntries(preset.fields.map((field) => [field.id, field.value]))]),
  ) as Record<PresetId, Record<string, string>>;
}

function SelectControl({ value, options, onChange, ariaLabel }: { value: string; options: string[]; onChange: (value: string) => void; ariaLabel: string }) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="field-select" aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon><ChevronDown size={15} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content" position="popper" sideOffset={6}>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item className="select-item" key={option} value={option}>
                <Select.ItemText>{option}</Select.ItemText>
                <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function Brand() {
  return (
    <div className="brand-lockup" aria-label="Drops Studio by DropsTab and Drops Bot">
      <div className="brand-mark"><Image src="https://dropstab.com/images/dropstab-logo-drop-default.svg" alt="" width={27} height={27} unoptimized /></div>
      <div><strong>Drops Studio</strong><span>by <b>DropsTab</b><i>×</i><b>Drops Bot</b></span></div>
    </div>
  );
}

export function DropsStudio() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<PresetId>(defaultPresetId);
  const [valuesByPreset, setValuesByPreset] = useState(initialValues);
  const [prompt, setPrompt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [selectedTools, setSelectedTools] = useState(["prices", "unlocks", "telegram"]);
  const [market, setMarket] = useState(sampleMarket);
  const [dataMode, setDataMode] = useState<"sample" | "live">("sample");
  const [prediction, setPrediction] = useState(defaultPrediction);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toast, setToast] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>("free");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connections, setConnections] = useState<Record<ProviderId, boolean>>({ free: true, dropstab: false, dropsbot: false, openai: false, anthropic: false, openrouter: false, kimi: false, custom: false });
  const [activeBrain, setActiveBrain] = useState<ProviderId>("free");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [building, setBuilding] = useState(false);
  const [draftSpec, setDraftSpec] = useState<GeneratedProjectSpec | null>(null);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(3);
  const [planLabel, setPlanLabel] = useState("Free AI ready");
  const [menuOpen, setMenuOpen] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const guestIdRef = useRef("");

  const selectedPreset = useMemo(() => presets.find((preset) => preset.id === selectedId) ?? presets[0], [selectedId]);
  const values = valuesByPreset[selectedId];
  const provider = providerList.find((item) => item.id === providerId) ?? providerList[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let savedProjects: GeneratedProject[] = [];
      try {
        const parsed = JSON.parse(window.localStorage.getItem(PROJECTS_STORAGE_KEY) || "[]") as unknown;
        if (Array.isArray(parsed)) savedProjects = parsed.filter((item): item is GeneratedProject => Boolean(item && typeof item === "object" && "spec" in item && "html" in item));
      } catch { /* Ignore invalid local projects. */ }

      try {
        const legacy = JSON.parse(window.localStorage.getItem("drops-studio-projects") || "[]") as Array<{ id?: string; presetId?: PresetId; title?: string; createdAt?: string }>;
        for (const draft of Array.isArray(legacy) ? legacy : []) {
          if (!draft.id || !draft.presetId || savedProjects.some((item) => item.id === draft.id) || !presets.some((item) => item.id === draft.presetId)) continue;
          const legacyPreset = presets.find((item) => item.id === draft.presetId) ?? presets[0];
          const spec = createProjectSpec({
            presetId: legacyPreset.id,
            values: Object.fromEntries(legacyPreset.fields.map((field) => [field.id, field.value])),
            prompt: draft.title && draft.title !== legacyPreset.title ? draft.title : "",
            tools: legacyPreset.tools,
            provider: "free",
            model: "Free Auto",
            market: sampleMarket,
            prediction: defaultPrediction,
            origin: window.location.origin,
          });
          savedProjects.push({ id: draft.id, spec, html: compileProject(spec), createdAt: draft.createdAt || spec.createdAt, updatedAt: new Date().toISOString() });
        }
        if (savedProjects.length) window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(savedProjects));
      } catch { /* Legacy drafts are optional. */ }
      setProjects(savedProjects);
      setConnections((current) => {
        const connected = { ...current };
        providerList.forEach((item) => {
          if (item.id !== "free" && window.sessionStorage.getItem(`drops-studio:${item.id}`)) connected[item.id] = true;
        });
        return connected;
      });
      const rememberedBrain = window.sessionStorage.getItem("drops-studio:active-brain") as ProviderId | null;
      if (rememberedBrain && providerList.some((item) => item.id === rememberedBrain)) setActiveBrain(rememberedBrain);
      guestIdRef.current = window.sessionStorage.getItem("drops-studio:guest-id") || crypto.randomUUID();
      window.sessionStorage.setItem("drops-studio:guest-id", guestIdRef.current);
      const params = new URLSearchParams(window.location.search);
      if (params.get("connections") === "1") setConnectionOpen(true);
      if (params.get("openrouter") === "connected") {
        setConnections((current) => ({ ...current, openrouter: true }));
        setActiveBrain("openrouter");
        setProviderId("openrouter");
        setToast("OpenRouter connected. Your account is now the active AI brain.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (selectedId !== "prediction-impact") return;
    fetch("/api/polymarket")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unavailable")))
      .then((payload: { events?: PredictionEvent[] }) => {
        if (payload.events?.[0]) setPrediction(payload.events[0]);
      })
      .catch(() => setPrediction(defaultPrediction));
  }, [selectedId]);

  function choosePreset(id: PresetId) {
    if (id !== selectedId) setDraftSpec(null);
    setSelectedId(id);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-preset="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
  }

  function shiftPreset(direction: -1 | 1) {
    const current = presets.findIndex((preset) => preset.id === selectedId);
    choosePreset(presets[(current + direction + presets.length) % presets.length].id);
  }

  function updateField(fieldId: string, value: string) {
    setValuesByPreset((current) => ({
      ...current,
      [selectedId]: { ...current[selectedId], [fieldId]: value },
    }));
    setDraftSpec((current) => current?.presetId === selectedId
      ? validateProjectSpec({ ...current, values: { ...current.values, [fieldId]: value } })
      : current);
  }

  async function planPrompt() {
    if (!prompt.trim()) {
      setToast("Describe your idea first — one sentence is enough.");
      return;
    }
    setPlanning(true);
    setPlanLabel("AI is turning your brief into screens, logic and integrations…");
    try {
      let plan: AgentProductPlan;
      let tier = "guest";
      let remaining: number | null = guestRemaining;
      let warning = "";
      const key = activeBrain === "free" ? "" : window.sessionStorage.getItem(`drops-studio:${activeBrain}`) ?? "";

      if (activeBrain !== "free" && !key) {
        openProvider(activeBrain);
        throw new Error(`Connect ${providerList.find((item) => item.id === activeBrain)?.name ?? "this AI"} first.`);
      }

      if (activeBrain === "custom") {
        const endpoint = window.sessionStorage.getItem("drops-studio:custom-endpoint");
        const model = window.sessionStorage.getItem("drops-studio:custom-model");
        if (!endpoint || !model) throw new Error("Custom endpoint or model is missing.");
        const seed = fallbackAgentPlan(prompt.trim());
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: "You are a product architect. Refine the supplied seed into a category-native working crypto product. Preserve the exact JSON shape and keys. Return JSON only. DropsTab is the source/data layer and Drops Bot is the alert/Telegram handoff layer. Never return a generic dashboard when the user asks for a game, channel, radio, assistant or another native experience." },
              { role: "user", content: JSON.stringify({ request: prompt.trim(), seed }) },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? `Custom model returned ${response.status}.`);
        const parsed = JSON.parse(result.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/)?.[0] || "{}") as unknown;
        const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        const candidateBlueprint = candidate.blueprint && typeof candidate.blueprint === "object" && !Array.isArray(candidate.blueprint)
          ? candidate.blueprint as Record<string, unknown>
          : {};
        const candidateContent = candidateBlueprint.content && typeof candidateBlueprint.content === "object" && !Array.isArray(candidateBlueprint.content)
          ? candidateBlueprint.content as Record<string, unknown>
          : {};
        const candidatePresetId = presets.some((item) => item.id === candidate.presetId) ? candidate.presetId as PresetId : seed.presetId;
        const normalized = validateProjectSpec({
          ...candidate,
          schemaVersion: 1,
          presetId: candidatePresetId,
          name: candidate.name ?? seed.name,
          tagline: candidate.tagline ?? seed.tagline,
          description: candidate.description ?? seed.description,
          prompt: prompt.trim(),
          values: valuesByPreset[candidatePresetId],
          tools: candidate.tools ?? seed.tools,
          brain: { provider: "custom", model, enhanced: true },
          theme: { ...(seed.theme ?? {}), ...(candidate.theme && typeof candidate.theme === "object" ? candidate.theme : {}) },
          design: { ...(seed.design ?? {}), ...(candidate.design && typeof candidate.design === "object" ? candidate.design : {}) },
          experience: { ...(seed.experience ?? {}), ...(candidate.experience && typeof candidate.experience === "object" ? candidate.experience : {}) },
          blueprint: {
            ...seed.blueprint,
            ...candidateBlueprint,
            content: { ...seed.blueprint.content, ...candidateContent },
          },
          gameDirection: { ...(seed.gameDirection ?? {}), ...(candidate.gameDirection && typeof candidate.gameDirection === "object" ? candidate.gameDirection : {}) },
          market,
          prediction,
          dataEndpoint: `${window.location.origin}/api/public-data`,
          createdAt: new Date().toISOString(),
        });
        plan = {
          presetId: normalized.presetId,
          name: normalized.name,
          tagline: normalized.tagline,
          description: normalized.description,
          tools: normalized.tools,
          blueprint: normalized.blueprint,
          theme: normalized.theme,
          design: normalized.design,
          experience: normalized.experience,
          gameDirection: normalized.gameDirection,
          provider: "custom",
          model,
        };
        tier = "byok";
        remaining = null;
      } else {
        const headers: Record<string, string> = { "content-type": "application/json", "x-drops-guest": guestIdRef.current };
        if (activeBrain === "openrouter") headers["x-openrouter-key"] = key;
        else if (["openai", "anthropic", "kimi"].includes(activeBrain)) headers["x-provider-key"] = key;
        const response = await fetch("/api/agent/plan", {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: prompt.trim(),
            guestId: guestIdRef.current,
            provider: activeBrain === "free" ? undefined : activeBrain,
            model: window.sessionStorage.getItem(`drops-studio:${activeBrain}:model`) || defaultModels[activeBrain],
          }),
        });
        const payload = await response.json() as { plan?: AgentProductPlan; tier?: string; model?: string; remaining?: number | null; warning?: string; error?: string; code?: string };
        if (!response.ok || !payload.plan) {
          if (payload.code === "GUEST_LIMIT") {
            setProviderId("openrouter");
            setConnectionOpen(true);
          }
          throw new Error(payload.error ?? "AI planning failed.");
        }
        plan = payload.plan;
        tier = payload.tier ?? tier;
        remaining = payload.remaining ?? null;
        warning = payload.warning ?? "";
      }

      const nextPreset = presets.find((item) => item.id === plan.presetId) ?? presets[0];
      const nextValues = valuesByPreset[nextPreset.id];
      const base = createProjectSpec({
        presetId: nextPreset.id,
        values: nextValues,
        prompt: prompt.trim(),
        tools: plan.tools.length ? plan.tools : nextPreset.tools,
        provider: plan.provider ?? (activeBrain === "free" ? "gateway" : activeBrain as ProjectProvider),
        model: plan.model ?? defaultModels[activeBrain] ?? "Drops Free AI",
        market,
        prediction,
        origin: window.location.origin,
      });
      const spec = validateProjectSpec(applyAgentPlan(base, plan));
      choosePreset(nextPreset.id);
      setDraftSpec(spec);
      setCustomMode(true);
      setGuestRemaining(remaining);
      const searchable = `${plan.tools.join(" ")} ${plan.blueprint.dropsTabUse.join(" ")} ${plan.blueprint.dropsBotUse.join(" ")}`.toLowerCase();
      const recommendedTools = customTools.filter((tool) => searchable.includes(tool.id.slice(0, 5)) || searchable.includes(tool.label.split(" ")[0].toLowerCase())).map((tool) => tool.id);
      setSelectedTools(recommendedTools.length ? recommendedTools : ["prices", "telegram"]);
      const brainName = tier === "fallback" ? "Local product compiler" : plan.model || (tier === "guest" ? "Free AI" : "Your model");
      setPlanLabel(`${brainName} · ${plan.blueprint.screens.length} screens · ${plan.blueprint.interactions.length} interactions`);
      setToast(warning || `${brainName} created a real ${plan.blueprint.productType} blueprint.`);
    } catch (error) {
      setPlanLabel("AI planning needs attention");
      setToast(error instanceof Error ? error.message : "AI planning failed.");
    } finally {
      setPlanning(false);
    }
  }

  function toggleTool(id: string) {
    setSelectedTools((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function openProvider(id: ProviderId) {
    setProviderId(id);
    setProviderKey("");
    setProviderModel(window.sessionStorage.getItem(`drops-studio:${id}:model`) ?? defaultModels[id] ?? "");
    setCustomEndpoint(window.sessionStorage.getItem("drops-studio:custom-endpoint") ?? "");
    setConnectionOpen(true);
  }

  async function connectOpenRouterAccount() {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    window.sessionStorage.setItem("drops-studio:openrouter:pkce", verifier);
    const callback = `${window.location.origin}/auth/openrouter`;
    const authorize = new URL("https://openrouter.ai/auth");
    authorize.searchParams.set("callback_url", callback);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    window.location.assign(authorize.toString());
  }

  async function connectProvider() {
    if (providerId === "free") {
      setConnections((current) => ({ ...current, free: true }));
      setActiveBrain("free");
      window.sessionStorage.setItem("drops-studio:active-brain", "free");
      setToast("Free Auto is ready.");
      setConnectionOpen(false);
      return;
    }
    if (providerId === "dropsbot") {
      window.open("https://t.me/Drops", "_blank", "noopener,noreferrer");
      window.sessionStorage.setItem("drops-studio:dropsbot", "telegram-setup-started");
      setConnections((current) => ({ ...current, dropsbot: true }));
      setToast("Official Drops Bot opened. Finish the channel/profile setup in Telegram.");
      setConnectionOpen(false);
      return;
    }
    if (!providerKey.trim()) {
      setToast(`Enter your ${provider.keyLabel ?? "API key"}.`);
      return;
    }
    if (providerId === "custom") {
      try {
        const endpoint = new URL(customEndpoint.trim());
        const blocked = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
        if (endpoint.protocol !== "https:" || blocked.test(endpoint.hostname)) throw new Error("Invalid endpoint");
      } catch {
        setToast("Use a public HTTPS chat-completions endpoint.");
        return;
      }
      if (!providerModel.trim()) {
        setToast("Enter the model ID used by this endpoint.");
        return;
      }
      window.sessionStorage.setItem("drops-studio:custom", providerKey.trim());
      window.sessionStorage.setItem("drops-studio:custom-endpoint", customEndpoint.trim());
      window.sessionStorage.setItem("drops-studio:custom-model", providerModel.trim());
      window.sessionStorage.setItem("drops-studio:active-brain", "custom");
      setConnections((current) => ({ ...current, custom: true }));
      setActiveBrain("custom");
      setToast("Custom API configured for this tab. It will be called directly by your browser when you plan.");
      setConnectionOpen(false);
      return;
    }
    setTestingConnection(true);
    try {
      if (providerId === "dropstab") {
        const response = await fetch("/api/dropstab", { headers: { "x-dropstab-api-key": providerKey.trim() } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "DropsTab rejected this key.");
        setMarket(payload.coins?.length ? payload.coins.slice(0, 3) : sampleMarket);
        setDataMode("live");
      } else {
        const response = await fetch("/api/connections/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: providerId, key: providerKey.trim(), endpoint: customEndpoint.trim() }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Connection test failed.");
      }
      window.sessionStorage.setItem(`drops-studio:${providerId}`, providerKey.trim());
      if (providerModel.trim()) window.sessionStorage.setItem(`drops-studio:${providerId}:model`, providerModel.trim());
      setConnections((current) => ({ ...current, [providerId]: true }));
      if (["openai", "anthropic", "openrouter", "kimi"].includes(providerId)) {
        setActiveBrain(providerId);
        window.sessionStorage.setItem("drops-studio:active-brain", providerId);
      }
      setToast(`${provider.name} verified and connected for this browser tab.`);
      setConnectionOpen(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setTestingConnection(false);
    }
  }

  async function refreshMarket() {
    const key = window.sessionStorage.getItem("drops-studio:dropstab");
    if (!key) {
      openProvider("dropstab");
      setToast("Connect a DropsTab API key to switch this preview to live data.");
      return;
    }
    setToast("Refreshing live DropsTab data…");
    try {
      const response = await fetch("/api/dropstab", { headers: { "x-dropstab-api-key": key } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not refresh live data.");
      setMarket(payload.coins.slice(0, 3));
      setDataMode("live");
      setToast("Live market preview refreshed.");
    } catch (error) {
      setDataMode("sample");
      setToast(error instanceof Error ? error.message : "Could not refresh live data.");
    }
  }

  async function buildProject() {
    if (building) return;
    setBuilding(true);
    setToast(`Compiling a real ${selectedPreset.output.toLowerCase()}…`);
    try {
      const provider = (["openai", "anthropic", "openrouter", "kimi", "custom"].includes(activeBrain) ? activeBrain : "free") as ProjectProvider;
      const model = window.sessionStorage.getItem(`drops-studio:${activeBrain}:model`) || defaultModels[activeBrain] || "Free Auto";
      const selectedToolLabels = selectedTools.map((id) => customTools.find((tool) => tool.id === id)?.label ?? id);
      const hasAgentDraft = Boolean(draftSpec && draftSpec.presetId === selectedId && draftSpec.prompt.trim() === prompt.trim());
      let spec = hasAgentDraft && draftSpec
        ? validateProjectSpec({
            ...draftSpec,
            values,
            tools: customMode && selectedToolLabels.length ? Array.from(new Set([...draftSpec.tools, ...selectedToolLabels])) : draftSpec.tools,
            market,
            prediction,
            dataEndpoint: `${window.location.origin}/api/public-data`,
          })
        : createProjectSpec({
            presetId: selectedId,
            values,
            prompt,
            tools: customMode && selectedToolLabels.length ? selectedToolLabels : selectedPreset.tools,
            provider,
            model,
            market,
            prediction,
            origin: window.location.origin,
          });

      if (!hasAgentDraft && provider !== "free") {
        const key = window.sessionStorage.getItem(`drops-studio:${provider}`);
        if (key) {
          try {
            if (provider === "custom") {
              const endpoint = window.sessionStorage.getItem("drops-studio:custom-endpoint");
              const customModel = window.sessionStorage.getItem("drops-studio:custom-model");
              if (!endpoint || !customModel) throw new Error("Custom model configuration is incomplete.");
              const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: customModel, temperature: 0.2, messages: [{ role: "system", content: "Return JSON only with name, tagline, description and theme. Never return code, URLs, secrets or markdown." }, { role: "user", content: JSON.stringify(spec) }] }), signal: AbortSignal.timeout(60_000) });
              const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
              if (!response.ok) throw new Error(`Custom model returned ${response.status}.`);
              const suggestion = JSON.parse(payload.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/)?.[0] || "{}") as Partial<GeneratedProjectSpec>;
              spec = validateProjectSpec({ ...spec, ...suggestion, presetId: spec.presetId, values: spec.values, tools: spec.tools, market: spec.market, prediction: spec.prediction, brain: { provider, model: customModel, enhanced: true } });
            } else {
              const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, key, model, prompt: prompt || selectedPreset.description, spec }) });
              const payload = await response.json() as { spec?: GeneratedProjectSpec; error?: string };
              if (!response.ok || !payload.spec) throw new Error(payload.error || "Model enhancement failed.");
              spec = payload.spec;
            }
          } catch (error) {
            setToast(`${error instanceof Error ? error.message : "AI enhancement failed."} Free compiler used instead.`);
          }
        }
      }

      const now = new Date().toISOString();
      const project: GeneratedProject = { id: crypto.randomUUID(), spec, html: compileProject(spec), createdAt: now, updatedAt: now };
      const next = [project, ...projects].slice(0, 50);
      try {
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([project, ...projects.filter((item) => !item.spec.experience.backgroundImage).slice(0, 8)]));
      }
      setProjects(next);
      router.push(`/studio/${project.id}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not compile this project.");
      setBuilding(false);
    }
  }

  function toggleAudio() {
    if (isPlaying) {
      window.speechSynthesis?.cancel();
      setIsPlaying(false);
      return;
    }
    const copy = selectedPreset.preview === "siri"
      ? "Solana contributed most of today's portfolio gain. ETF odds rose while your other assets stayed inside normal ranges."
      : "Drops Radio. Solana leads the market as ETF probability rises. Bitcoin is up four point two percent. Next, your token unlock map.";
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(copy);
      utterance.rate = 1.02;
      utterance.onend = () => setIsPlaying(false);
      window.speechSynthesis.speak(utterance);
      setIsPlaying(true);
    } else {
      setToast("Browser speech is not available on this device.");
    }
  }

  async function handlePreviewAction(label: string) {
    if (/OPEN IN DROPSTAB|SHOW THE DATA|VIEW [A-Z]+/.test(label)) {
      window.open("https://dropstab.com/", "_blank", "noopener,noreferrer");
      return;
    }
    if (/ALERT|BUY IN DROPS/.test(label)) {
      window.open("https://t.me/Drops", "_blank", "noopener,noreferrer");
      setToast("Drops Bot opened. You approve the final setup in Telegram.");
      return;
    }
    if (/TRADE MARKET/.test(label)) {
      window.open("https://polymarket.com/", "_blank", "noopener,noreferrer");
      return;
    }
    if (label === "SHARE" || /SHARE/.test(label)) {
      await navigator.clipboard?.writeText(window.location.href);
      setToast("Share link copied.");
      return;
    }
    setToast(`${label} added to the blueprint. Nothing was executed.`);
  }

  return (
    <main className="studio-shell">
      <div className="aurora one" /><div className="aurora two" />
      <header className="studio-header">
        <Brand />
        <nav className={menuOpen ? "open" : ""} aria-label="Primary navigation">
          <button type="button" onClick={() => { document.querySelector(".preset-section")?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); }}>Templates</button>
          <button type="button" onClick={() => { setProjectsOpen(true); setMenuOpen(false); }}>My Projects <span>{projects.length}</span></button>
          <button type="button" onClick={() => { setConnectionOpen(true); setMenuOpen(false); }}>AI Connections</button>
          <a href="https://api-docs.dropstab.com/" target="_blank" rel="noreferrer">Docs <ExternalLink size={13} /></a>
        </nav>
        <div className="header-actions">
          <button className="api-vault-button" type="button" onClick={() => setConnectionOpen(true)}><KeyRound size={16} /> API Vault</button>
          <button className="mobile-menu" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle menu">{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <div className="studio-grid">
        <section className="builder-column">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={14} /> BUILD IN 5 MINUTES</span>
            <h1>Turn a crypto idea<br />into a live project<span>.</span></h1>
            <p>Choose a proven recipe or describe anything. Drops Studio assembles the data, triggers, AI brain and output around DropsTab + Drops Bot.</p>
          </div>

          <div className="prompt-frame">
            <div className="prompt-box">
              <WandSparkles size={22} />
              <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); if (draftSpec && event.target.value.trim() !== draftSpec.prompt.trim()) setDraftSpec(null); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") planPrompt(); }} placeholder="Describe what you want to build — product, design, behavior and audience…" rows={2} aria-label="Describe your crypto project" />
              <button type="button" onClick={planPrompt} disabled={planning} aria-label="Plan a working project">{planning ? <LoaderCircle className="spin" /> : <Send />}</button>
            </div>
            <div className="prompt-meta"><span>{planLabel}</span><span>{activeBrain === "free" ? `${guestRemaining ?? 3} free AI builds left today` : `${providerList.find((item) => item.id === activeBrain)?.name ?? "BYOK"} · your budget`}</span></div>
          </div>

          <section className="preset-section" aria-labelledby="preset-title">
            <div className="section-heading"><div><span>START WITH A RECIPE</span><h2 id="preset-title">Ideas that are worth building</h2></div><div className="carousel-controls"><button type="button" onClick={() => shiftPreset(-1)} aria-label="Previous preset"><ArrowLeft /></button><button type="button" onClick={() => shiftPreset(1)} aria-label="Next preset"><ArrowRight /></button></div></div>
            <div className="preset-carousel" ref={carouselRef}>
              {presets.map((preset) => {
                const Icon = iconMap[preset.icon as keyof typeof iconMap] ?? Sparkles;
                const selected = preset.id === selectedId;
                return (
                  <button data-preset={preset.id} className={`preset-card ${selected ? "selected" : ""}`} style={{ "--preset-accent": preset.accent, "--preset-tint": preset.tint } as React.CSSProperties} key={preset.id} type="button" onClick={() => choosePreset(preset.id)} aria-pressed={selected}>
                    <span className="preset-icon"><Icon size={22} /></span>
                    <span className="preset-badge">{preset.badge}</span>
                    <strong>{preset.shortTitle}</strong>
                    <small>{preset.tagline}</small>
                    <em>{preset.eta} <ChevronRight size={13} /></em>
                  </button>
                );
              })}
            </div>
          </section>

          <AnimatePresence mode="wait">
            <motion.section className="setup-card" key={`${selectedId}-${customMode}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
              <div className="setup-heading">
                <div><span>{draftSpec ? "AI PRODUCT BLUEPRINT" : customMode ? "YOUR CUSTOM BLUEPRINT" : "SET UP THIS RECIPE"}</span><h2>{draftSpec?.name ?? selectedPreset.title}</h2><p>{draftSpec?.description ?? selectedPreset.description}</p></div>
                <label className="custom-switch"><span>Custom mode</span><Switch.Root checked={customMode} onCheckedChange={setCustomMode}><Switch.Thumb /></Switch.Root></label>
              </div>
              <div className="field-grid">
                {selectedPreset.fields.map((field) => (
                  <label className="config-field" key={field.id}><span>{field.label}</span><SelectControl value={values[field.id] ?? field.value} options={field.options} onChange={(value) => updateField(field.id, value)} ariaLabel={field.label} /></label>
                ))}
              </div>

              <AnimatePresence initial={false}>
                {customMode && (
                  <motion.div className="custom-stack" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="custom-stack-heading"><div><BrainCircuit size={18} /><span><strong>Recommended stack</strong><small>Toggle any capability. The blueprint stays editable.</small></span></div><button type="button" onClick={() => setSelectedTools(customTools.map((tool) => tool.id))}>Select all</button></div>
                    <div className="tool-grid">
                      {customTools.map((tool) => {
                        const Icon = tool.icon;
                        const active = selectedTools.includes(tool.id);
                        return <button type="button" className={active ? "active" : ""} key={tool.id} onClick={() => toggleTool(tool.id)}><Icon size={16} />{tool.label}{active && <Check size={14} />}</button>;
                      })}
                    </div>
                    <button className="add-custom-tool" type="button" onClick={() => setToast("Custom HTTPS tools are added through API Vault.")}><Plus size={15} /> Add API, skill or custom endpoint</button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="brain-row">
                <div className="brain-label"><BrainCircuit size={18} /><div><strong>Choose the brain</strong><span>Free Auto works now. Bring your own model when you want more.</span></div></div>
                <div className="provider-chips">
                  {providerList.filter((item) => ["free", "openai", "anthropic", "openrouter", "kimi", "custom"].includes(item.id)).map((item) => (
                    <button type="button" key={item.id} onClick={() => { if (connections[item.id]) { setActiveBrain(item.id); window.sessionStorage.setItem("drops-studio:active-brain", item.id); setToast(`${item.name} is now the active brain.`); } else openProvider(item.id); }} className={`${connections[item.id] ? "connected" : ""} ${activeBrain === item.id ? "active-brain" : ""}`}><span>{item.id === "free" ? <Sparkles /> : item.id === "custom" ? <Code2 /> : <Cloud />}</span>{item.name}{activeBrain === item.id ? <BadgeCheck size={13} /> : connections[item.id] && <Check size={13} />}</button>
                  ))}
                </div>
              </div>

              <div className="source-strip">
                <div><BadgeCheck size={16} /><span><strong>Verified foundation</strong> · {(draftSpec?.tools ?? selectedPreset.tools).join(" · ")}</span></div>
                <button type="button" onClick={refreshMarket}>{dataMode === "live" ? "Refresh live data" : "Connect live data"}</button>
              </div>
              <button className="build-button" type="button" onClick={buildProject} disabled={building}>{building ? <><LoaderCircle className="spin" size={19} />Compiling screens, state and runtime…</> : <><Sparkles size={19} />{draftSpec ? `Build ${draftSpec.name}` : selectedPreset.cta}<ArrowRight size={18} /></>}</button>
              <button className="blank-button" type="button" onClick={() => { setCustomMode(true); setPrompt(""); setToast("Blank canvas enabled. Describe anything or assemble the stack manually."); }}>Start from a blank canvas</button>
            </motion.section>
          </AnimatePresence>
        </section>

        <PreviewCanvas preset={selectedPreset} spec={draftSpec ?? undefined} values={values} market={market} dataMode={dataMode} prediction={prediction} isPlaying={isPlaying} onToggleAudio={toggleAudio} onAction={handlePreviewAction} />
      </div>

      <footer className="studio-footer"><Brand /><p>Build on real crypto intelligence. You approve every external action.</p><div><a href="https://dropstab.com/" target="_blank" rel="noreferrer">DropsTab</a><a href="https://t.me/Drops" target="_blank" rel="noreferrer">Drops Bot</a><a href="https://api-docs.dropstab.com/" target="_blank" rel="noreferrer">API Docs</a></div></footer>

      <Dialog.Root open={connectionOpen} onOpenChange={setConnectionOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="connections-dialog">
            <div className="dialog-top"><div><Dialog.Title>AI & API Vault</Dialog.Title><Dialog.Description>Connect your own tools. Secrets stay in this browser tab; official providers use a narrow verification proxy and custom calls go directly to your endpoint.</Dialog.Description></div><Dialog.Close className="dialog-close"><X /></Dialog.Close></div>
            <div className="connection-layout">
              <div className="provider-list">
                {providerList.map((item) => <button type="button" key={item.id} className={providerId === item.id ? "active" : ""} onClick={() => { setProviderId(item.id); setProviderKey(""); setProviderModel(window.sessionStorage.getItem(`drops-studio:${item.id}:model`) ?? defaultModels[item.id] ?? ""); setCustomEndpoint(window.sessionStorage.getItem("drops-studio:custom-endpoint") ?? ""); }}><span>{item.id === "free" ? <Sparkles /> : item.id === "dropstab" ? <Database /> : item.id === "dropsbot" ? <Bot /> : item.id === "custom" ? <Code2 /> : <Cloud />}</span><div><strong>{item.name}</strong><small>{item.eyebrow}</small></div>{connections[item.id] && <Check className="provider-check" />}</button>)}
              </div>
              <div className="provider-detail">
                <span className="detail-icon">{provider.id === "free" ? <Sparkles /> : provider.id === "dropstab" ? <Database /> : provider.id === "dropsbot" ? <Bot /> : provider.id === "custom" ? <Code2 /> : <Cloud />}</span>
                <div className="detail-copy"><span>{provider.eyebrow}</span><h3>{provider.name}</h3><p>{provider.description}</p></div>
                {provider.id === "openrouter" && <div className="oauth-connect-card"><div><BadgeCheck /><span><strong>Connect account in one click</strong><small>OpenRouter creates a user-controlled key. It stays only in this browser tab.</small></span></div><button type="button" onClick={() => void connectOpenRouterAccount()}>Continue with OpenRouter <ArrowRight size={15} /></button><em>or use an existing API key below</em></div>}
                {provider.endpoint && <label className="key-field"><span>HTTPS chat-completions endpoint</span><input type="url" value={customEndpoint} onChange={(event) => setCustomEndpoint(event.target.value)} placeholder="https://api.example.com/v1/chat/completions" /></label>}
                {provider.keyLabel && <label className="key-field"><span>{provider.keyLabel}</span><div><LockKeyhole size={16} /><input type="password" autoComplete="off" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} placeholder="••••••••••••••••" /></div></label>}
                {["openai", "anthropic", "openrouter", "kimi", "custom"].includes(provider.id) && <label className="key-field"><span>Model ID</span><input type="text" value={providerModel} onChange={(event) => setProviderModel(event.target.value)} placeholder="Enter a model ID" /></label>}
                <div className="privacy-note"><LockKeyhole size={15} /><p><strong>Session-only storage.</strong> The key is never written to the project, database or local project history.{provider.id === "custom" ? " Custom requests go directly from your browser to the endpoint you choose." : ""}</p></div>
                <div className="provider-detail-actions">
                  {provider.docs && <a href={provider.docs} target="_blank" rel="noreferrer">Open official docs <ExternalLink size={14} /></a>}
                  <button type="button" onClick={connectProvider} disabled={testingConnection}>{testingConnection ? <><LoaderCircle className="spin" /> Testing…</> : provider.id === "dropsbot" ? <>Open Drops Bot <ExternalLink size={15} /></> : provider.id === "custom" ? <>Save custom API <ArrowRight size={15} /></> : connections[provider.id] ? <>Re-test connection <BadgeCheck size={15} /></> : <>Connect & test <ArrowRight size={15} /></>}</button>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={projectsOpen} onOpenChange={setProjectsOpen}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="projects-dialog"><div className="dialog-top"><div><Dialog.Title>My Projects</Dialog.Title><Dialog.Description>Working products saved in this browser. Open one to edit, run and publish it.</Dialog.Description></div><Dialog.Close className="dialog-close"><X /></Dialog.Close></div>{projects.length ? <div className="project-list">{projects.map((project) => { const projectPreset = presets.find((item) => item.id === project.spec.presetId); return <button type="button" key={project.id} onClick={() => router.push(`/studio/${project.id}`)}><span><Save size={17} /></span><div><strong>{project.spec.name}</strong><small>{projectPreset?.output ?? "Live application"} · {project.publishedUrl ? "Published" : "Ready to run"} · {new Date(project.createdAt).toLocaleDateString()}</small></div><ChevronRight /></button>; })}</div> : <div className="empty-projects"><Rocket /><strong>No projects yet</strong><p>Pick a recipe, tune the settings and compile your first working product.</p></div>}</Dialog.Content></Dialog.Portal>
      </Dialog.Root>

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite"><CircleHelp size={17} />{toast}</div>
    </main>
  );
}
