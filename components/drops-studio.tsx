"use client";

import dynamic from "next/dynamic";
import { DropsBrand } from "@/components/drops-brand";
import { DropsStudioSetup } from "@/components/drops-studio-setup";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  ExternalLink,
  Gamepad2,
  HeartPulse,
  KeyRound,
  LoaderCircle,
  Megaphone,
  Menu,
  Radio,
  Rocket,
  Send,
  Sparkles,
  Sun,
  TableProperties,
  UserRound,
  UsersRound,
  WalletCards,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  MarketCoin,
  PredictionEvent,
} from "@/components/preview-canvas";
import type { AgentProductPlan } from "@/lib/product-blueprint";
import type {
  GeneratedProject,
  GeneratedProjectSpec,
  ProjectProvider,
  ProjectQualityReport,
} from "@/lib/project-types";
import {
  deleteProjectSafely,
  readProjectsFromStore,
  saveProjectSafely,
} from "@/lib/project-store";
import {
  deleteMemberProjectFromCloud,
  listMemberProjectsFromCloud,
  materializeMemberProject,
  saveMemberProjectToCloud,
} from "@/lib/member-project-sync-client";
import {
  deleteProjectV2FromCloud,
  saveProjectV2ToCloud,
} from "@/lib/project-v2-sync-client";
import { customProductPreset, defaultPresetId, getProjectPreset, presets, type PresetId } from "@/lib/presets";
import {
  isModelProviderId,
  modelProviderIds,
  normalizeProviderModelCatalog,
  providerModelCatalogStorageKey,
  type ModelProviderId,
  type ProviderModelCatalog,
} from "@/lib/provider-models";
import { parseStudioConnectionHandoff } from "@/lib/studio-connection-handoff";
import { safeSameOriginReturnPath } from "@/lib/safe-return-to";
import {
  studioAccountDisplayName,
  studioAccountInitial,
} from "@/lib/studio-account-profile";

// Defer the Connections Hub and My Projects overlays until either is opened.
const DropsStudioDialogs = dynamic(
  () =>
    import("@/components/drops-studio-dialogs").then(
      (module) => module.DropsStudioDialogs,
    ),
  { ssr: false },
);

// The category-native preview has its own interaction and media runtime. Keep
// it out of the prompt shell's hydration path so the server-rendered hero can
// paint before preview code is evaluated on constrained devices.
const PreviewCanvas = dynamic(
  () =>
    import("@/components/preview-canvas").then(
      (module) => module.PreviewCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="preview-column" aria-busy="true" aria-label="Loading product preview">
        <div className="preview-device" />
      </section>
    ),
  },
);

type ProviderId =
  | "free"
  | "dropstab"
  | "dropsbot"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "kimi"
  | "custom";
type BuilderRunMode = "plan" | "build";
type BuildActivityStatus = "queued" | "active" | "done" | "failed";

interface BuildActivityItem {
  id: "intent" | "blueprint" | "runtime" | "quality";
  label: string;
  detail: string;
  status: BuildActivityStatus;
}

interface StudioAccessStatus {
  tier?: string;
  authenticated?: boolean;
  projectSync?: boolean;
  platformAi?: { available?: boolean; remaining?: number | null };
  account?: { connected?: boolean; projectSync?: boolean };
}

interface StudioAccountProfileView {
  provider: "google" | "openrouter";
  name: string;
  email?: string;
  picture?: string;
}

interface StudioAccountConnectionView {
  provider: Exclude<ProviderId, "free"> | "telegram";
  connected: boolean;
  model?: string;
  endpointHost?: string;
}

const initialBuildActivity: BuildActivityItem[] = [
  {
    id: "intent",
    label: "Understand output",
    detail: "Category and secondary capabilities",
    status: "queued",
  },
  {
    id: "blueprint",
    label: "Direct the product",
    detail: "Screens, loops, data and actions",
    status: "queued",
  },
  {
    id: "runtime",
    label: "Compile working app",
    detail: "State, interactions and responsive UI",
    status: "queued",
  },
  {
    id: "quality",
    label: "Run release checks",
    detail: "Category, safety, data and publish gate",
    status: "queued",
  },
];

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
  {
    id: "free",
    name: "Free Auto",
    eyebrow: "No key",
    description:
      "Local planner plus the best available free workflow. Nothing to connect.",
  },
  {
    id: "dropstab",
    name: "DropsTab API",
    eyebrow: "Live data",
    description:
      "Use your DropsTab API key for live prices, rankings, FDV, unlocks and research data.",
    keyLabel: "DropsTab API key",
    docs: "https://api-docs.dropstab.com/",
  },
  {
    id: "dropsbot",
    name: "Telegram delivery",
    eyebrow: "Drops Bot guided setup available",
    description:
      "Connect and remember your Telegram delivery account. Official Drops Bot Profile linking remains a separate documented guided step.",
    docs: "https://core.telegram.org/method/channels.createChannel",
  },
  {
    id: "openai",
    name: "OpenAI",
    eyebrow: "Bring your key",
    description:
      "Use your own OpenAI API project as the reasoning layer and choose any model available to that key.",
    keyLabel: "OpenAI API key",
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    eyebrow: "Bring your key",
    description:
      "Connect Claude for long-form research, editorial voice and strategy explanations.",
    keyLabel: "Anthropic API key",
    docs: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    eyebrow: "Your account models",
    description:
      "Verify your account, then choose from the model IDs OpenRouter returns for that key.",
    keyLabel: "OpenRouter API key",
    docs: "https://openrouter.ai/keys",
  },
  {
    id: "kimi",
    name: "Kimi",
    eyebrow: "Long context",
    description:
      "Connect Moonshot Kimi models for research-heavy crypto workflows.",
    keyLabel: "Moonshot API key",
    docs: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    id: "custom",
    name: "Custom API",
    eyebrow: "OpenAI compatible",
    description:
      "Connect any public HTTPS OpenAI-compatible chat-completions endpoint you control.",
    keyLabel: "Bearer token",
    endpoint: true,
  },
];

const defaultModels: Partial<Record<ProviderId, string>> = {
  openai: "gpt-5.6-sol",
  anthropic: "claude-sonnet-5",
  openrouter: "openrouter/free",
  kimi: "kimi-k3",
};

function readProviderModelCatalog(
  provider: ModelProviderId,
): ProviderModelCatalog | null {
  try {
    const raw = window.sessionStorage.getItem(
      providerModelCatalogStorageKey(provider),
    );
    return raw ? normalizeProviderModelCatalog(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const sampleMarket: MarketCoin[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: "$68,432.21",
    change: 4.21,
    marketCap: "$1.35T",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: "$3,642.18",
    change: -0.58,
    marketCap: "$438B",
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: "$171.35",
    change: 2.31,
    marketCap: "$81B",
  },
];

const defaultPrediction: PredictionEvent = {
  title: "SOL ETF approval",
  probability: 68,
  change: 26,
};

const GAME_RUNTIME_ASSETS = [
  "/assets/market-catcher-retro.png",
  "/assets/market-wolf-catcher.png",
] as const;

async function warmProjectExperience(spec: GeneratedProjectSpec) {
  if (spec.presetId !== "crypto-game") return;

  await Promise.race([
    Promise.allSettled(
      GAME_RUNTIME_ASSETS.map((src) =>
        fetch(src, { cache: "force-cache" }).then((response) => {
          if (!response.ok) throw new Error(`Could not preload ${src}.`);
          return response.blob();
        }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_200)),
  ]);
}

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
    [...presets, customProductPreset].map((preset) => [
      preset.id,
      Object.fromEntries(preset.fields.map((field) => [field.id, field.value])),
    ]),
  ) as Record<PresetId, Record<string, string>>;
}

function Brand() {
  return <DropsBrand />;
}

function useNearViewport() {
  const [ready, setReady] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const elementRef = useCallback((next: HTMLElement | null) => {
    setElement(next);
  }, []);

  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "64px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ready, elementRef };
}

export function DropsStudio({ hero }: { hero: ReactNode }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<PresetId>(defaultPresetId);
  const [valuesByPreset, setValuesByPreset] = useState(initialValues);
  const [prompt, setPrompt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [selectedTools, setSelectedTools] = useState([
    "prices",
    "unlocks",
    "telegram",
  ]);
  const [market, setMarket] = useState(sampleMarket);
  const [dataMode, setDataMode] = useState<"sample" | "live">("sample");
  const [prediction, setPrediction] = useState(defaultPrediction);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toast, setToast] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionReturnTo, setConnectionReturnTo] = useState<string | null>(
    null,
  );
  const [telegramProjectSlug, setTelegramProjectSlug] = useState<string | null>(
    null,
  );
  const [providerId, setProviderId] = useState<ProviderId>("free");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [modelCatalogs, setModelCatalogs] = useState<
    Partial<Record<ModelProviderId, ProviderModelCatalog>>
  >({});
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connections, setConnections] = useState<Record<ProviderId, boolean>>({
    free: true,
    dropstab: false,
    dropsbot: false,
    openai: false,
    anthropic: false,
    openrouter: false,
    kimi: false,
    custom: false,
  });
  const [activeBrain, setActiveBrain] = useState<ProviderId>("free");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [building, setBuilding] = useState(false);
  const [draftSpec, setDraftSpec] = useState<GeneratedProjectSpec | null>(null);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [platformAiAvailable, setPlatformAiAvailable] = useState(false);
  const [memberConnected, setMemberConnected] = useState(false);
  const [accountProfile, setAccountProfile] =
    useState<StudioAccountProfileView | null>(null);
  const [projectSyncAvailable, setProjectSyncAvailable] = useState(false);
  const [planLabel, setPlanLabel] = useState("Ready to build");
  const [buildActivity, setBuildActivity] = useState<BuildActivityItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const centeredPresetRef = useRef(false);
  const guestIdRef = useRef("");
  const previewSection = useNearViewport();

  const selectedPreset = useMemo(
    () => getProjectPreset(selectedId),
    [selectedId],
  );
  const values = valuesByPreset[selectedId];
  const provider =
    providerList.find((item) => item.id === providerId) ?? providerList[0];
  const providerModelCatalog = isModelProviderId(providerId)
    ? (modelCatalogs[providerId] ?? null)
    : null;
  const telegramProject = useMemo(
    () =>
      telegramProjectSlug
        ? (projects.find(
            (project) =>
              project.id === telegramProjectSlug ||
              project.spec.slug === telegramProjectSlug,
          ) ?? null)
        : null,
    [projects, telegramProjectSlug],
  );
  const applyAccessStatus = useCallback((access: StudioAccessStatus) => {
    const signedIn = Boolean(access.authenticated && access.account?.connected);
    const projectSync = Boolean(
      access.projectSync ?? access.account?.projectSync,
    );
    const available = access.platformAi?.available === true;
    const reportedRemaining = access.platformAi?.remaining;
    const remaining = available && Number.isSafeInteger(reportedRemaining) && Number(reportedRemaining) >= 0
      ? Number(reportedRemaining)
      : null;
    setMemberConnected(signedIn);
    setProjectSyncAvailable(projectSync);
    setPlatformAiAvailable(available);
    setGuestRemaining(remaining);
    setPlanLabel(
      available
        ? signedIn
          ? "AI planning ready"
          : "Free planning ready"
        : signedIn
          ? "Signed in · ready to build"
          : "Ready to build offline",
    );
    return {
      authenticated: signedIn,
      available,
      remaining,
      projectSync,
    };
  }, []);

  const hydrateAccountState = useCallback(async () => {
    const response = await fetch("/api/account", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) {
      setAccountProfile(null);
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      profile?: StudioAccountProfileView | null;
      connections?: StudioAccountConnectionView[];
    };
    if (!response.ok) return;
    setAccountProfile(payload.profile ?? null);
    const remembered = payload.connections ?? [];
    setConnections((current) => {
      const next = { ...current };
      for (const connection of remembered) {
        if (connection.provider === "telegram") {
          next.dropsbot = connection.connected;
        } else if (connection.provider in next) {
          next[connection.provider as Exclude<ProviderId, "free">] = connection.connected;
        }
      }
      return next;
    });
    for (const connection of remembered) {
      if (
        connection.connected
        && connection.model
        && isModelProviderId(connection.provider)
      ) {
        window.sessionStorage.setItem(
          `drops-studio:${connection.provider}:model`,
          connection.model,
        );
      }
    }
    if (!window.sessionStorage.getItem("drops-studio:active-brain")) {
      const preferred = remembered.find(
        (connection) =>
          connection.connected && isModelProviderId(connection.provider),
      );
      if (preferred && isModelProviderId(preferred.provider)) {
        window.sessionStorage.setItem(
          "drops-studio:active-brain",
          preferred.provider,
        );
        setActiveBrain(preferred.provider);
      }
    }
  }, []);

  useEffect(() => {
    const handleConnectionChange = (event: Event) => {
      const detail = (event as CustomEvent<{
        provider?: string;
        connected?: boolean;
      }>).detail;
      if (detail?.provider !== "telegram") return;
      setConnections((current) => ({
        ...current,
        dropsbot: detail.connected === true,
      }));
    };
    window.addEventListener(
      "drops-studio:connection-changed",
      handleConnectionChange,
    );
    return () => {
      window.removeEventListener(
        "drops-studio:connection-changed",
        handleConnectionChange,
      );
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedReturnTo = safeSameOriginReturnPath(
        params.get("returnTo"),
        window.location.origin,
        "",
      );
      if (requestedReturnTo) {
        setConnectionReturnTo(requestedReturnTo);
      }
      const authState = params.get("auth");
      if (authState === "google-connected") {
        setToast("Google profile connected. Private projects and verified connections can now follow your account.");
      } else if (authState === "google-unavailable") {
        setToast("Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.");
      } else if (authState?.startsWith("google-")) {
        setToast("Google sign-in could not be verified. Please try again.");
      }
      const presetParam = params.get("preset");
      const requestedCatalogPreset = presets.find(
        (preset) => preset.id === presetParam,
      );
      if (requestedCatalogPreset) setSelectedId(requestedCatalogPreset.id);

      let savedProjects = readProjectsFromStore();

      try {
        const legacy = JSON.parse(
          window.localStorage.getItem("drops-studio-projects") || "[]",
        ) as Array<{
          id?: string;
          presetId?: PresetId;
          title?: string;
          createdAt?: string;
        }>;
        const legacyModules = legacy.length
          ? await Promise.all([
              import("@/lib/project-compiler"),
              import("@/lib/project-factory"),
            ])
          : null;
        const compileLegacyProject = legacyModules?.[0].compileProject ?? null;
        const createLegacyProjectSpec =
          legacyModules?.[1].createProjectSpec ?? null;
        for (const draft of Array.isArray(legacy) ? legacy : []) {
          if (
            !draft.id ||
            !draft.presetId ||
            savedProjects.some((item) => item.id === draft.id) ||
            !presets.some((item) => item.id === draft.presetId)
          )
            continue;
          if (!compileLegacyProject || !createLegacyProjectSpec) continue;
          const legacyPreset =
            presets.find((item) => item.id === draft.presetId) ?? presets[0];
          const spec = createLegacyProjectSpec({
            presetId: legacyPreset.id,
            values: Object.fromEntries(
              legacyPreset.fields.map((field) => [field.id, field.value]),
            ),
            prompt:
              draft.title && draft.title !== legacyPreset.title
                ? draft.title
                : "",
            tools: legacyPreset.tools,
            provider: "free",
            model: "Free Auto",
            market: sampleMarket,
            prediction: defaultPrediction,
            origin: window.location.origin,
          });
          const migratedProject: GeneratedProject = {
            id: draft.id,
            spec,
            html: compileLegacyProject(spec),
            createdAt: draft.createdAt || spec.createdAt,
            updatedAt: new Date().toISOString(),
          };
          const stored = await saveProjectSafely(migratedProject, {
            expectedUpdatedAt: null,
          });
          if (stored.status === "saved") savedProjects = stored.projects;
        }
      } catch {
        /* Legacy drafts are optional. */
      }
      setProjects(savedProjects);
      // A Telegram user-account session is not evidence that Drops Bot is linked.
      window.sessionStorage.removeItem("drops-studio:dropsbot");
      setConnections((current) => {
        const connected = { ...current };
        providerList.forEach((item) => {
          const marker = window.sessionStorage.getItem(
            `drops-studio:${item.id}`,
          );
          if (item.id !== "free" && item.id !== "dropsbot" && marker)
            connected[item.id] = true;
        });
        return connected;
      });
      const restoredCatalogs: Partial<
        Record<ModelProviderId, ProviderModelCatalog>
      > = {};
      for (const modelProvider of modelProviderIds) {
        const catalog = readProviderModelCatalog(modelProvider);
        if (catalog) restoredCatalogs[modelProvider] = catalog;
      }
      setModelCatalogs(restoredCatalogs);
      const rememberedBrain = window.sessionStorage.getItem(
        "drops-studio:active-brain",
      ) as ProviderId | null;
      if (
        rememberedBrain &&
        providerList.some((item) => item.id === rememberedBrain)
      )
        setActiveBrain(rememberedBrain);
      guestIdRef.current =
        window.sessionStorage.getItem("drops-studio:guest-id") ||
        crypto.randomUUID();
      window.sessionStorage.setItem(
        "drops-studio:guest-id",
        guestIdRef.current,
      );
      let hydratedAccess: StudioAccessStatus | null = null;
      try {
        const accessResponse = await fetch("/api/access", { cache: "no-store" });
        const accessPayload = (await accessResponse.json()) as {
          access?: StudioAccessStatus;
        };
        if (accessResponse.ok && accessPayload.access) {
          hydratedAccess = accessPayload.access;
          const accessState = applyAccessStatus(hydratedAccess);
          if (accessState.authenticated) {
            await hydrateAccountState().catch(() => undefined);
          }
          if (accessState.authenticated && accessState.projectSync) {
            try {
              const cloud = await listMemberProjectsFromCloud();
              for (const record of cloud.projects) {
                const local = savedProjects.find(
                  (project) => project.id === record.id,
                );
                if (
                  local &&
                  Date.parse(local.updatedAt) >= Date.parse(record.updatedAt)
                ) {
                  continue;
                }
                const materialized = await materializeMemberProject(record);
                const stored = await saveProjectSafely(materialized, {
                  expectedUpdatedAt: local?.updatedAt ?? null,
                });
                if (stored.status === "saved") savedProjects = stored.projects;
              }
              setProjects(savedProjects);
            } catch {
              /* Browser projects remain authoritative while cloud sync is offline. */
            }
          }
        }
      } catch {
        /* The local compiler remains available when access status is offline. */
      }
      const handoff = parseStudioConnectionHandoff(window.location.search);
      if (handoff.connections) {
        const requestedProvider = providerList.find(
          (item) => item.id === handoff.provider,
        );
        if (requestedProvider) setProviderId(requestedProvider.id);

        if (
          handoff.provider === "dropsbot" &&
          handoff.flow === "telegram-channel"
        ) {
          setProviderId("dropsbot");
          setTelegramProjectSlug(handoff.project);
          const requestedProject = savedProjects.find(
            (project) =>
              project.id === handoff.project ||
              project.spec.slug === handoff.project,
          );
          const requestedPreset =
            requestedProject?.spec.presetId ??
            presets.find(
              (preset) =>
                handoff.project === preset.id ||
                handoff.project?.startsWith(`${preset.id}-`),
            )?.id;
          if (requestedPreset) setSelectedId(requestedPreset);
          if (requestedProject) {
            setDraftSpec(requestedProject.spec);
            setValuesByPreset((current) => ({
              ...current,
              [requestedProject.spec.presetId]: requestedProject.spec.values,
            }));
          }
        }
        setConnectionOpen(true);
      }
      if (params.get("openrouter") === "connected") {
        const sessionKey = window.sessionStorage.getItem("drops-studio:openrouter");
        if (hydratedAccess?.authenticated && hydratedAccess.account?.connected && sessionKey) {
          setConnections((current) => ({ ...current, openrouter: true }));
          setActiveBrain("openrouter");
          setProviderId("openrouter");
          setToast("OpenRouter connected. Your signed-in member session and AI brain are ready.");
        } else {
          setToast("OpenRouter connection could not be confirmed. Connect it again from AI Connections.");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyAccessStatus, hydrateAccountState]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const centerPreset = useCallback(
    (id: PresetId, behavior: ScrollBehavior) => {
      const carousel = carouselRef.current;
      const card = carousel?.querySelector<HTMLElement>(`[data-preset="${id}"]`);
      if (!carousel || !card) return;
      const centeredLeft =
        card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
      const maxLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
      carousel.scrollTo({
        left: Math.min(maxLeft, Math.max(0, centeredLeft)),
        behavior,
      });
    },
    [],
  );

  useEffect(() => {
    const isInitialSelection = !centeredPresetRef.current;
    centeredPresetRef.current = true;
    if (
      isInitialSelection &&
      !window.matchMedia("(max-width: 620px)").matches
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      centerPreset(selectedId, isInitialSelection ? "auto" : "smooth");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [centerPreset, selectedId]);

  useEffect(() => {
    let frame = 0;
    const handleResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => centerPreset(selectedId, "auto"));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(frame);
    };
  }, [centerPreset, selectedId]);

  useEffect(() => {
    if (selectedId !== "prediction-impact") return;
    fetch("/api/polymarket")
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Unavailable")),
      )
      .then((payload: { events?: PredictionEvent[] }) => {
        if (payload.events?.[0]) setPrediction(payload.events[0]);
      })
      .catch(() => setPrediction(defaultPrediction));
  }, [selectedId]);

  function choosePreset(id: PresetId) {
    if (id === selectedId) {
      centerPreset(id, "smooth");
      return;
    }
    if (id !== selectedId) setDraftSpec(null);
    setSelectedId(id);
  }

  function shiftPreset(direction: -1 | 1) {
    const current = presets.findIndex((preset) => preset.id === selectedId);
    choosePreset(
      presets[(current + direction + presets.length) % presets.length].id,
    );
  }

  function updateField(fieldId: string, value: string) {
    setValuesByPreset((current) => ({
      ...current,
      [selectedId]: { ...current[selectedId], [fieldId]: value },
    }));
    setDraftSpec((current) =>
      current?.presetId === selectedId
        ? {
            ...current,
            values: { ...current.values, [fieldId]: value },
          }
        : current,
    );
  }

  function setActivity(
    id: BuildActivityItem["id"],
    status: BuildActivityStatus,
    detail?: string,
  ) {
    setBuildActivity((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status, detail: detail ?? item.detail }
          : item,
      ),
    );
  }

  async function planPrompt(): Promise<GeneratedProjectSpec | null> {
    if (!prompt.trim()) {
      setToast("Describe your idea first — one sentence is enough.");
      return null;
    }
    setPlanning(true);
    setPlanLabel(
      "AI is turning your brief into screens, logic and integrations…",
    );
    try {
      const [blueprintModule, factoryModule, validatorModule] =
        await Promise.all([
          import("@/lib/product-blueprint"),
          import("@/lib/project-factory"),
          import("@/lib/project-validator"),
        ]);
      const { applyAgentPlan, fallbackAgentPlan } = blueprintModule;
      const { createProjectSpec } = factoryModule;
      const { validateProjectSpec } = validatorModule;
      let plan: AgentProductPlan;
      let tier = "guest";
      let remaining: number | null = guestRemaining;
      let warning = "";
      const key =
        activeBrain === "free"
          ? ""
          : (window.sessionStorage.getItem(`drops-studio:${activeBrain}`) ??
            "");

      if (
        activeBrain !== "free"
        && !key
        && (activeBrain === "custom" || !connections[activeBrain])
      ) {
        openProvider(activeBrain);
        throw new Error(
          `Connect ${providerList.find((item) => item.id === activeBrain)?.name ?? "this AI"} first.`,
        );
      }

      if (activeBrain === "custom") {
        const endpoint = window.sessionStorage.getItem(
          "drops-studio:custom-endpoint",
        );
        const model = window.sessionStorage.getItem(
          "drops-studio:custom-model",
        );
        if (!endpoint || !model)
          throw new Error("Custom endpoint or model is missing.");
        const seed = fallbackAgentPlan(prompt.trim());
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "You are a product architect. Refine the supplied seed into a category-native working crypto product. Preserve the exact JSON shape and keys. Return JSON only. DropsTab is the source/data layer and Drops Bot is the alert/Telegram handoff layer. Never return a generic dashboard when the user asks for a game, channel, radio, assistant or another native experience.",
              },
              {
                role: "user",
                content: JSON.stringify({ request: prompt.trim(), seed }),
              },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const result = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(
            result.error?.message ??
              `Custom model returned ${response.status}.`,
          );
        const parsed = JSON.parse(
          result.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/)?.[0] ||
            "{}",
        ) as unknown;
        const candidate =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        const candidateBlueprint =
          candidate.blueprint &&
          typeof candidate.blueprint === "object" &&
          !Array.isArray(candidate.blueprint)
            ? (candidate.blueprint as Record<string, unknown>)
            : {};
        const candidateContent =
          candidateBlueprint.content &&
          typeof candidateBlueprint.content === "object" &&
          !Array.isArray(candidateBlueprint.content)
            ? (candidateBlueprint.content as Record<string, unknown>)
            : {};
        const candidatePresetId = presets.some(
          (item) => item.id === candidate.presetId,
        )
          ? (candidate.presetId as PresetId)
          : seed.presetId;
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
          theme: {
            ...(seed.theme ?? {}),
            ...(candidate.theme && typeof candidate.theme === "object"
              ? candidate.theme
              : {}),
          },
          design: {
            ...(seed.design ?? {}),
            ...(candidate.design && typeof candidate.design === "object"
              ? candidate.design
              : {}),
          },
          experience: {
            ...(seed.experience ?? {}),
            ...(candidate.experience && typeof candidate.experience === "object"
              ? candidate.experience
              : {}),
          },
          blueprint: {
            ...seed.blueprint,
            ...candidateBlueprint,
            content: { ...seed.blueprint.content, ...candidateContent },
          },
          gameDirection: {
            ...(seed.gameDirection ?? {}),
            ...(candidate.gameDirection &&
            typeof candidate.gameDirection === "object"
              ? candidate.gameDirection
              : {}),
          },
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
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-drops-guest": guestIdRef.current,
        };
        if (activeBrain === "openrouter" && key) headers["x-openrouter-key"] = key;
        else if (["openai", "anthropic", "kimi"].includes(activeBrain) && key)
          headers["x-provider-key"] = key;
        const response = await fetch("/api/agent/plan", {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: prompt.trim(),
            guestId: guestIdRef.current,
            provider: activeBrain === "free" ? undefined : activeBrain,
            model:
              window.sessionStorage.getItem(
                `drops-studio:${activeBrain}:model`,
              ) || defaultModels[activeBrain],
          }),
        });
        const payload = (await response.json()) as {
          plan?: AgentProductPlan;
          tier?: string;
          model?: string;
          remaining?: number | null;
          access?: {
            authenticated?: boolean;
            account?: { connected?: boolean };
            platformAi?: { available?: boolean; remaining?: number | null };
          };
          warning?: string;
          error?: string;
          code?: string;
        };
        const accessState = payload.access ? applyAccessStatus(payload.access) : null;
        remaining = accessState?.remaining ?? null;
        if (!response.ok || !payload.plan) {
          if (payload.code === "GUEST_LIMIT") {
            setProviderId("openrouter");
            setConnectionOpen(true);
          }
          throw new Error(payload.error ?? "AI planning failed.");
        }
        plan = payload.plan;
        tier = payload.tier ?? tier;
        warning = payload.warning ?? "";
      }

      const nextPreset = getProjectPreset(plan.presetId);
      const nextValues = valuesByPreset[nextPreset.id];
      const base = createProjectSpec({
        presetId: nextPreset.id,
        values: nextValues,
        prompt: prompt.trim(),
        tools: plan.tools.length ? plan.tools : nextPreset.tools,
        provider:
          plan.provider ??
          (activeBrain === "free"
            ? "gateway"
            : (activeBrain as ProjectProvider)),
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
      const searchable =
        `${plan.tools.join(" ")} ${plan.blueprint.dropsTabUse.join(" ")} ${plan.blueprint.dropsBotUse.join(" ")}`.toLowerCase();
      const recommendedTools = customTools
        .filter(
          (tool) =>
            searchable.includes(tool.id.slice(0, 5)) ||
            searchable.includes(tool.label.split(" ")[0].toLowerCase()),
        )
        .map((tool) => tool.id);
      setSelectedTools(
        recommendedTools.length ? recommendedTools : ["prices", "telegram"],
      );
      const brainName =
        tier === "fallback"
          ? "Local product compiler"
          : plan.model || (tier === "guest" ? "Free AI" : tier === "member" ? "Member Free AI" : "Your model");
      setPlanLabel(
        `${brainName} · ${plan.blueprint.screens.length} screens · ${plan.blueprint.interactions.length} interactions`,
      );
      setToast(
        warning ||
          `${brainName} created a real ${plan.blueprint.productType} blueprint.`,
      );
      return spec;
    } catch (error) {
      setPlanLabel("AI planning needs attention");
      setToast(error instanceof Error ? error.message : "AI planning failed.");
      return null;
    } finally {
      setPlanning(false);
    }
  }

  async function runPrompt(mode: BuilderRunMode) {
    if (planning || building) return;
    setBuildActivity(
      initialBuildActivity.map((item, index) => ({
        ...item,
        status: index === 0 ? "active" : "queued",
      })),
    );
    let spec: GeneratedProjectSpec | null = null;
    if (mode === "build") {
      if (!prompt.trim()) {
        setActivity(
          "intent",
          "done",
          `${selectedPreset.title} selected from the recipe catalog`,
        );
        setActivity(
          "blueprint",
          "done",
          "Recipe screens, interactions and integrations are editable in Studio",
        );
        await buildProject();
        return;
      }
    }
    spec = await planPrompt();
    if (!spec) {
      setActivity("intent", "failed", "The product brief needs attention");
      return;
    }
    setActivity(
      "intent",
      "done",
      `${spec.presetId.replace(/-/g, " ")} selected from the requested output`,
    );
    setActivity(
      "blueprint",
      "done",
      `${spec.blueprint.screens.length} screens · ${spec.blueprint.interactions.length} interactions`,
    );
    if (mode === "plan") {
      setActivity(
        "runtime",
        "queued",
        "Review the blueprint, then build when ready",
      );
      setActivity("quality", "queued", "Runs on the compiled product");
      return;
    }
    await buildProject(spec);
  }

  function toggleTool(id: string) {
    setSelectedTools((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function selectProvider(id: ProviderId) {
    setProviderId(id);
    setProviderKey("");
    setProviderModel(
      window.sessionStorage.getItem(
        id === "custom"
          ? "drops-studio:custom-model"
          : `drops-studio:${id}:model`,
      ) ??
        defaultModels[id] ??
        "",
    );
    setCustomEndpoint(
      window.sessionStorage.getItem("drops-studio:custom-endpoint") ?? "",
    );
    if (isModelProviderId(id)) {
      const catalog = readProviderModelCatalog(id);
      setModelCatalogs((current) =>
        catalog ? { ...current, [id]: catalog } : current,
      );
    }
  }

  function selectProviderModel(model: string) {
    setProviderModel(model);
    if (!isModelProviderId(providerId) || !connections[providerId]) return;
    const selectedModel = model.trim();
    if (!selectedModel) {
      window.sessionStorage.removeItem(`drops-studio:${providerId}:model`);
      if (activeBrain === providerId) {
        setActiveBrain("free");
        window.sessionStorage.setItem("drops-studio:active-brain", "free");
      }
      return;
    }
    window.sessionStorage.setItem(
      `drops-studio:${providerId}:model`,
      selectedModel,
    );
    window.sessionStorage.setItem("drops-studio:active-brain", providerId);
    setActiveBrain(providerId);
  }

  function openProvider(id: ProviderId) {
    selectProvider(id);
    setConnectionOpen(true);
  }

  function closeConnectionsHub() {
    setConnectionOpen(false);
    if (connectionReturnTo) {
      window.location.assign(connectionReturnTo);
      return;
    }
    const url = new URL(window.location.href);
    for (const key of ["connections", "provider", "flow", "project", "returnTo", "auth"]) {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function startGoogleSignIn() {
    const returnTo = safeSameOriginReturnPath(
      `${window.location.pathname}${window.location.search}`,
      window.location.origin,
    );
    window.location.assign(
      `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  async function signOutStudioAccount() {
    const response = await fetch("/api/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
    if (!response?.ok) {
      setToast("Could not sign out. Your account session was left unchanged.");
      return;
    }
    setAccountProfile(null);
    setMemberConnected(false);
    setProjectSyncAvailable(false);
    const accountBackedProviders = [
      "dropstab",
      "openai",
      "anthropic",
      "openrouter",
      "kimi",
      "custom",
    ] as const;
    setConnections((current) => {
      const next = { ...current };
      for (const provider of accountBackedProviders) {
        if (!window.sessionStorage.getItem(`drops-studio:${provider}`)?.trim()) {
          next[provider] = false;
        }
      }
      return next;
    });
    if (
      activeBrain !== "free"
      && activeBrain !== "dropsbot"
      && !window.sessionStorage.getItem(`drops-studio:${activeBrain}`)?.trim()
    ) {
      setActiveBrain("free");
      window.sessionStorage.setItem("drops-studio:active-brain", "free");
    }
    setToast("Signed out. Browser projects and session-only connections remain available.");
  }

  async function rememberConnection(input: {
    provider: Exclude<ProviderId, "free" | "dropsbot">;
    credential: string;
    model?: string;
    endpoint?: string;
  }): Promise<boolean> {
    if (!memberConnected) return false;
    const response = await fetch("/api/account/connections", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    return Boolean(response?.ok);
  }

  async function connectOpenRouterAccount() {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    window.sessionStorage.setItem("drops-studio:openrouter:pkce", verifier);
    const callback = `${window.location.origin}/auth/openrouter`;
    const authorize = new URL("https://openrouter.ai/auth");
    authorize.searchParams.set("callback_url", callback);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    window.location.assign(authorize.toString());
  }

  async function disconnectOpenRouterAccount() {
    if (memberConnected) {
      await fetch("/api/account/connections?provider=openrouter", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      }).catch(() => undefined);
    }
    for (const key of [
      "drops-studio:openrouter",
      "drops-studio:openrouter:model",
      providerModelCatalogStorageKey("openrouter"),
      "drops-studio:openrouter:pkce",
    ]) window.sessionStorage.removeItem(key);
    if (window.sessionStorage.getItem("drops-studio:active-brain") === "openrouter") {
      window.sessionStorage.setItem("drops-studio:active-brain", "free");
      setActiveBrain("free");
    }
    setConnections((current) => ({ ...current, openrouter: false }));
    setModelCatalogs((current) => {
      const next = { ...current };
      delete next.openrouter;
      return next;
    });
    setProviderId("free");
    setToast("OpenRouter disconnected. Your Studio profile remains signed in.");
  }

  async function connectProvider() {
    if (providerId === "free") {
      setConnections((current) => ({ ...current, free: true }));
      setActiveBrain("free");
      window.sessionStorage.setItem("drops-studio:active-brain", "free");
      setToast("Free Auto is ready.");
      closeConnectionsHub();
      return;
    }
    if (providerId === "dropsbot") {
      const popup = window.open("about:blank", "_blank");
      if (!popup) {
        setToast(
          "Your browser blocked the Drops Bot tab. Allow popups or open the official bot manually to continue.",
        );
        return;
      }
      popup.opener = null;
      popup.location.replace("https://t.me/Drops");
      setToast(
        "Official Drops Bot opened. Telegram account verification remains separate; follow the documented Profile steps before treating alerts as configured.",
      );
      closeConnectionsHub();
      return;
    }
    const connectionKey =
      providerKey.trim() ||
      window.sessionStorage.getItem(`drops-studio:${providerId}`)?.trim() ||
      "";
    if (!connectionKey) {
      setToast(`Enter your ${provider.keyLabel ?? "API key"}.`);
      return;
    }
    if (providerId === "custom") {
      try {
        const endpoint = new URL(customEndpoint.trim());
        const blocked =
          /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
        if (endpoint.protocol !== "https:" || blocked.test(endpoint.hostname))
          throw new Error("Invalid endpoint");
      } catch {
        setToast("Use a public HTTPS chat-completions endpoint.");
        return;
      }
      if (!providerModel.trim()) {
        setToast("Enter the model ID used by this endpoint.");
        return;
      }
      window.sessionStorage.setItem("drops-studio:custom", connectionKey);
      window.sessionStorage.setItem(
        "drops-studio:custom-endpoint",
        customEndpoint.trim(),
      );
      window.sessionStorage.setItem(
        "drops-studio:custom-model",
        providerModel.trim(),
      );
      window.sessionStorage.setItem("drops-studio:active-brain", "custom");
      setConnections((current) => ({ ...current, custom: true }));
      setActiveBrain("custom");
      const remembered = await rememberConnection({
        provider: "custom",
        credential: connectionKey,
        model: providerModel.trim(),
        endpoint: customEndpoint.trim(),
      });
      setToast(
        remembered
          ? "Custom API verified for this tab and encrypted in your Studio account vault."
          : "Custom API configured for this tab. Sign in to remember it across sessions.",
      );
      closeConnectionsHub();
      return;
    }
    setTestingConnection(true);
    try {
      let verifiedCatalog: ProviderModelCatalog | null = null;
      if (providerId === "dropstab") {
        const response = await fetch("/api/dropstab", {
          headers: { "x-dropstab-api-key": connectionKey },
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error ?? "DropsTab rejected this key.");
        const coins =
          payload && Array.isArray(payload.coins) ? payload.coins : [];
        setMarket(coins.length ? coins.slice(0, 3) : sampleMarket);
        setDataMode(coins.length ? "live" : "sample");
      } else {
        const response = await fetch("/api/connections/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: providerId,
            key: connectionKey,
            endpoint: customEndpoint.trim(),
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const providerError =
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : "Connection test failed.";
          throw new Error(providerError);
        }
        if (isModelProviderId(providerId)) {
          verifiedCatalog = normalizeProviderModelCatalog(payload);
          if (!verifiedCatalog)
            throw new Error("The provider returned an invalid model catalog.");
          setModelCatalogs((current) => ({
            ...current,
            [providerId]: verifiedCatalog as ProviderModelCatalog,
          }));
          window.sessionStorage.setItem(
            providerModelCatalogStorageKey(providerId),
            JSON.stringify(verifiedCatalog),
          );
        }
      }
      window.sessionStorage.setItem(
        `drops-studio:${providerId}`,
        connectionKey,
      );
      setConnections((current) => ({ ...current, [providerId]: true }));
      if (isModelProviderId(providerId)) {
        const storedModel =
          window.sessionStorage.getItem(`drops-studio:${providerId}:model`) ??
          "";
        const requestedModel = providerModel.trim();
        const returnedModels = verifiedCatalog?.models ?? [];
        const selectedModel =
          (returnedModels.includes(storedModel) ? storedModel : "") ||
          (returnedModels.includes(requestedModel) ? requestedModel : "") ||
          (defaultModels[providerId] &&
          returnedModels.includes(defaultModels[providerId] as string)
            ? (defaultModels[providerId] as string)
            : "") ||
          returnedModels[0] ||
          storedModel;
        setProviderModel(selectedModel);
        if (selectedModel) {
          window.sessionStorage.setItem(
            `drops-studio:${providerId}:model`,
            selectedModel,
          );
          setActiveBrain(providerId);
          window.sessionStorage.setItem(
            "drops-studio:active-brain",
            providerId,
          );
        } else {
          window.sessionStorage.removeItem(
            `drops-studio:${providerId}:model`,
          );
        }
        const remembered = await rememberConnection({
          provider: providerId,
          credential: connectionKey,
          ...(selectedModel ? { model: selectedModel } : {}),
        });
        setToast(
          returnedModels.length
            ? `${provider.name} verified${remembered ? " and encrypted for your account" : " for this tab"}. Choose from ${verifiedCatalog?.totalModelCount ?? returnedModels.length} provider-returned models.`
            : `${provider.name} verified, but no model list was returned. Enter the exact model ID to continue.`,
        );
        return;
      }
      const remembered = await rememberConnection({
        provider: providerId,
        credential: connectionKey,
      });
      setToast(
        remembered
          ? `${provider.name} verified and encrypted for your Studio account.`
          : `${provider.name} verified and connected for this browser tab.`,
      );
      closeConnectionsHub();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Connection test failed.",
      );
    } finally {
      setTestingConnection(false);
    }
  }

  async function refreshMarket() {
    const key = window.sessionStorage.getItem("drops-studio:dropstab");
    if (!key && !connections.dropstab) {
      openProvider("dropstab");
      setToast(
        "Connect a DropsTab API key to switch this preview to live data.",
      );
      return;
    }
    setToast("Refreshing live DropsTab data…");
    try {
      const response = await fetch("/api/dropstab", {
        ...(key ? { headers: { "x-dropstab-api-key": key } } : {}),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Could not refresh live data.");
      if (!payload || !Array.isArray(payload.coins))
        throw new Error("DropsTab returned an invalid market response.");
      setMarket(payload.coins.slice(0, 3));
      setDataMode("live");
      setToast("Live market preview refreshed.");
    } catch (error) {
      setDataMode("sample");
      setToast(
        error instanceof Error ? error.message : "Could not refresh live data.",
      );
    }
  }

  async function buildProject(specOverride?: GeneratedProjectSpec) {
    if (building) return;
    setBuilding(true);
    const targetPreset = specOverride
      ? getProjectPreset(specOverride.presetId)
      : selectedPreset;
    setActivity(
      "runtime",
      "active",
      `Compiling ${targetPreset.output.toLowerCase()}`,
    );
    setToast(`Compiling a real ${targetPreset.output.toLowerCase()}…`);
    try {
      const [{ createProjectSpec }, { validateProjectSpec }] =
        await Promise.all([
          import("@/lib/project-factory"),
          import("@/lib/project-validator"),
        ]);
      const provider = (
        ["openai", "anthropic", "openrouter", "kimi", "custom"].includes(
          activeBrain,
        )
          ? activeBrain
          : "free"
      ) as ProjectProvider;
      const model =
        window.sessionStorage.getItem(`drops-studio:${activeBrain}:model`) ||
        defaultModels[activeBrain] ||
        "Free Auto";
      const selectedToolLabels = selectedTools.map(
        (id) => customTools.find((tool) => tool.id === id)?.label ?? id,
      );
      const hasAgentDraft = Boolean(
        specOverride ||
          (draftSpec &&
            draftSpec.presetId === selectedId &&
            draftSpec.prompt.trim() === prompt.trim()),
      );
      let serverBuildWarning = "";
      let spec = specOverride
        ? validateProjectSpec({
            ...specOverride,
            market,
            prediction,
            dataEndpoint: `${window.location.origin}/api/public-data`,
          })
        : hasAgentDraft && draftSpec
          ? validateProjectSpec({
              ...draftSpec,
              values,
              tools:
                customMode && selectedToolLabels.length
                  ? Array.from(
                      new Set([...draftSpec.tools, ...selectedToolLabels]),
                    )
                  : draftSpec.tools,
              market,
              prediction,
              dataEndpoint: `${window.location.origin}/api/public-data`,
            })
          : createProjectSpec({
              presetId: selectedId,
              values,
              prompt,
              tools:
                customMode && selectedToolLabels.length
                  ? selectedToolLabels
                  : selectedPreset.tools,
              provider,
              model,
              market,
              prediction,
              origin: window.location.origin,
            });

      // The initial release inspection is deterministic and server-owned so
      // the browser can open Studio quickly without executing generated code.
      // The selected BYOK provider is used by the visible Project V2 agent
      // loop after navigation, where file edits, Sandbox checks and repairs
      // are streamed into the Director conversation.
      const buildResponse = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-drops-session": guestIdRef.current,
        },
        body: JSON.stringify({
          provider: "free",
          model: "Free Auto",
          prompt: prompt || selectedPreset.description,
          spec,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const buildPayload = (await buildResponse.json().catch(() => ({}))) as {
        spec?: GeneratedProjectSpec;
        quality?: ProjectQualityReport;
        run?: { status?: string; trace?: unknown[] };
        error?: string;
        warning?: string;
      };
      if (!buildResponse.ok || !buildPayload.spec || !buildPayload.quality) {
        throw new Error(
          buildPayload.error ||
            "The authoritative build runner could not validate this project.",
        );
      }
      spec = validateProjectSpec(buildPayload.spec);
      serverBuildWarning = buildPayload.warning || "";

      const [
        { compileProject },
        { evaluateProjectQuality },
        { materializeProjectV2Template },
      ] =
        await Promise.all([
          import("@/lib/project-compiler"),
          import("@/lib/project-quality"),
          import("@/lib/project-template-materializer"),
        ]);
      const html = compileProject(spec);
      setActivity(
        "runtime",
        "done",
        "Standalone state, interactions and responsive runtime compiled",
      );
      setActivity(
        "quality",
        "active",
        "Checking category fit, safety and data/action contracts",
      );
      // Keep the server release inspection authoritative. The browser
      // evaluation is still computed to ensure this exact compiled artifact
      // has not diverged before it enters Project Studio.
      const browserQuality = evaluateProjectQuality(spec, html);
      const quality = {
        ...buildPayload.quality,
        runtimeSmoke: browserQuality.runtimeSmoke,
      };
      const sandboxChecks = new Set([
        "runtime",
        "interactions",
        "data-adapter",
        "dropsbot",
        "actions",
      ]);
      const staticFailures = quality.criticalFailures.filter(
        (id) => !sandboxChecks.has(id),
      );
      if (staticFailures.length) {
        throw new Error(
          `Build stopped by quality gate (${quality.score}/100): ${staticFailures.join(", ")}.`,
        );
      }
      setActivity(
        "quality",
        "done",
        "Static contract passed · sandbox smoke continues in Studio",
      );
      const now = new Date().toISOString();
      const projectId = crypto.randomUUID();
      const projectV2 = await materializeProjectV2Template({
        id: projectId,
        spec,
        now,
      });
      const project: GeneratedProject = {
        id: projectId,
        spec,
        html,
        projectV2,
        quality,
        conversation: [
          {
            id: `user-${projectId}`,
            role: "user",
            content:
              prompt.trim() || targetPreset.title.replace(/^Build Your\s+/i, "Build "),
            createdAt: now,
          },
          {
            id: `assistant-${projectId}`,
            role: "assistant",
            content: `I prepared an editable ${spec.blueprint.productType} plan with ${spec.blueprint.screens.length} screens and ${spec.blueprint.interactions.length} working interactions. I’m opening Studio now; the isolated build, checks, preview and any repair will continue visibly in this chat.`,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      const studioHref = `/studio/${project.id}?panel=director&autobuild=1`;
      void router.prefetch(studioHref);
      void warmProjectExperience(spec);
      const stored = await saveProjectSafely(project, {
        expectedUpdatedAt: null,
      });
      if (stored.status === "conflict") {
        throw new Error(
          "A project with this identity was created in another tab. Build again to keep both versions.",
        );
      }
      let builderSnapshotSaved = false;
      try {
        const accessResponse = await fetch("/api/access", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const accessPayload = (await accessResponse.json()) as {
          access?: StudioAccessStatus;
        };
        const privateProjectStorageAvailable = Boolean(
          accessResponse.ok &&
            (accessPayload.access?.projectSync ??
              accessPayload.access?.account?.projectSync),
        );
        if (privateProjectStorageAvailable) {
          await saveProjectV2ToCloud(projectV2, 0);
          builderSnapshotSaved = true;
        }
      } catch {
        builderSnapshotSaved = false;
      }
      let cloudSaved = false;
      if (memberConnected && projectSyncAvailable) {
        try {
          await saveMemberProjectToCloud(project, 0);
          cloudSaved = builderSnapshotSaved;
        } catch {
          cloudSaved = false;
        }
      }
      const next = stored.projects;
      setProjects(next);
      setToast(
        serverBuildWarning
          ? `${serverBuildWarning} Opening Studio for the isolated build…`
          : cloudSaved
            ? "Editable plan saved to your account. Opening the live build conversation…"
            : builderSnapshotSaved
              ? "Editable Project V2 saved. Opening the live build conversation…"
              : "Editable plan created. Opening Studio while the verified build continues…",
      );
      setBuilding(false);
      router.push(studioHref);
    } catch (error) {
      setActivity(
        "quality",
        "failed",
        error instanceof Error ? error.message : "Release checks failed",
      );
      setToast(
        error instanceof Error
          ? error.message
          : "Could not compile this project.",
      );
      setBuilding(false);
    }
  }

  function toggleAudio() {
    if (isPlaying) {
      window.speechSynthesis?.cancel();
      setIsPlaying(false);
      return;
    }
    const available = market.filter((coin) => coin.price !== "—");
    const marketCopy = available.length
      ? available
          .slice(0, 3)
          .map((coin) =>
            coin.change === null
              ? `${coin.name} percentage change is unavailable`
              : `${coin.name} is ${coin.change >= 0 ? "up" : "down"} ${Math.abs(coin.change).toFixed(2)} percent`,
          )
          .join(". ")
      : "The live market adapter has not returned data yet";
    const copy =
      selectedPreset.preview === "siri"
        ? `No portfolio is connected. Current market context: ${marketCopy}.`
        : `Drops browser audio briefing. ${marketCopy}. Unlock and funding stories require a connected DropsTab endpoint.`;
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
    if (label === "BUILD PROJECT") {
      await runPrompt("build");
      return;
    }
    if (label === "EDIT PLAN") {
      if (!prompt.trim()) {
        document
          .querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Describe your crypto project"]',
          )
          ?.focus();
        setToast("Describe your product, then create an editable plan.");
        return;
      }
      await runPrompt("plan");
      return;
    }
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

  const deleteProjectRecord = useCallback(async (project: GeneratedProject) => {
    const result = await deleteProjectSafely(project.id, {
      expectedUpdatedAt: project.updatedAt,
    });
    if (result.status === "conflict") {
      throw new Error("This project changed in another tab. Reload before deleting it.");
    }
    try {
      if (projectSyncAvailable) {
        await deleteProjectV2FromCloud(project.id);
      }
      if (memberConnected) {
        await deleteMemberProjectFromCloud(project.id);
      }
    } catch (error) {
      const restored = await saveProjectSafely(project, {
        expectedUpdatedAt: null,
      }).catch(() => null);
      if (restored?.status === "saved") setProjects(restored.projects);
      throw error;
    }
    setProjects(result.projects);
  }, [memberConnected, projectSyncAvailable]);

  const deleteProjectFromLibrary = useCallback(async (project: GeneratedProject) => {
    if (!window.confirm(`Delete “${project.spec.name}”? Its Sandbox and private snapshots will also be removed.`)) {
      return;
    }
    try {
      await deleteProjectRecord(project);
      setToast(`${project.spec.name} deleted.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Project deletion failed.");
    }
  }, [deleteProjectRecord]);

  const deleteAllProjectsFromLibrary = useCallback(async () => {
    if (!projects.length) return;
    if (!window.confirm(`Delete all ${projects.length} projects? This permanently removes their private snapshots and Sandboxes.`)) {
      return;
    }
    try {
      for (const project of [...projects]) await deleteProjectRecord(project);
      setProjects([]);
      setToast("All projects deleted.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Some projects could not be deleted.");
    }
  }, [deleteProjectRecord, projects]);

  return (
    <main className="studio-shell">
      <div className="aurora one" />
      <div className="aurora two" />
      <header className="studio-header">
        <Brand />
        <nav className={menuOpen ? "open" : ""} aria-label="Primary navigation">
          <a href="/templates">Templates</a>
          <button
            type="button"
            onClick={() => {
              setProjectsOpen(true);
              setMenuOpen(false);
            }}
          >
            My Projects <span>{projects.length}</span>
          </button>
          <a href="/integrations">Integrations</a>
          <a href="/platform">Platform</a>
          <button
            className="mobile-nav-connections"
            type="button"
            onClick={() => {
              setConnectionOpen(true);
              setMenuOpen(false);
            }}
          >
            Connections
          </button>
          <a
            href="https://api-docs.dropstab.com/"
            target="_blank"
            rel="noreferrer"
          >
            Docs <ExternalLink size={13} />
          </a>
        </nav>
        <div className="header-actions">
          <button
            className={`account-profile-button ${accountProfile ? "connected" : ""}`}
            type="button"
            aria-label={accountProfile
              ? `Open projects for ${studioAccountDisplayName(accountProfile.name)}`
              : "Sign in"}
            onClick={accountProfile ? () => setProjectsOpen(true) : startGoogleSignIn}
          >
            <span className="account-avatar" aria-hidden="true">
              {accountProfile ? studioAccountInitial(accountProfile.name) : <UserRound />}
            </span>
            <span>{accountProfile
              ? studioAccountDisplayName(accountProfile.name)
              : "Sign in"}</span>
          </button>
          <button
            className="api-vault-button"
            type="button"
            onClick={() => setConnectionOpen(true)}
          >
            <KeyRound size={16} /> Connections
          </button>
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <div className="studio-grid">
        <section className="builder-column">
          <div className="builder-primary">
            {hero}

            <div className="prompt-frame">
              <div className="prompt-box">
                <WandSparkles size={22} />
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    if (
                      draftSpec &&
                      event.target.value.trim() !== draftSpec.prompt.trim()
                    )
                      setDraftSpec(null);
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                      void runPrompt("build");
                  }}
                  placeholder="Describe the full product: output, users, behavior, design and data…"
                  rows={2}
                  aria-label="Describe your crypto project"
                />
                <button
                  className="prompt-build-button"
                  type="button"
                  onClick={() => void runPrompt("build")}
                  disabled={planning || building}
                  aria-label="Build now"
                >
                  {planning || building ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Rocket />
                  )}
                  <span>
                    {building ? "Building…" : planning ? "Planning…" : "Build now"}
                  </span>
                </button>
              </div>
              <div className="prompt-runbar">
                <button
                  className="prompt-plan-button"
                  type="button"
                  onClick={() => void runPrompt("plan")}
                  disabled={planning || building}
                >
                  <WandSparkles /> Plan
                </button>
                <span>
                  Your requested product comes first. Build it now, or review its
                  screens and actions.
                </span>
              </div>
              <div className="prompt-meta">
                <span>{planLabel}</span>
                <span>
                  {activeBrain === "free"
                    ? platformAiAvailable && guestRemaining !== null
                      ? `${guestRemaining} ${memberConnected ? "signed-in" : "guest"} AI builds left today`
                      : "Local build available"
                    : `${providerList.find((item) => item.id === activeBrain)?.name ?? "BYOK"} · your budget`}
                </span>
              </div>
            </div>

            {buildActivity.length > 0 && (
              <div className="build-activity" aria-live="polite">
                {buildActivity.map((item) => (
                  <div className={item.status} key={item.id}>
                    <span>
                      {item.status === "done" ? (
                        <Check />
                      ) : item.status === "active" ? (
                        <LoaderCircle className="spin" />
                      ) : item.status === "failed" ? (
                        <X />
                      ) : (
                        <i />
                      )}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="preset-section" aria-labelledby="preset-title">
            <div className="section-heading">
              <div>
                <span>START WITH A RECIPE</span>
                <h2 id="preset-title">Ideas that are worth building</h2>
              </div>
              <div className="carousel-controls">
                <button
                  type="button"
                  onClick={() => shiftPreset(-1)}
                  aria-label="Previous preset"
                >
                  <ArrowLeft />
                </button>
                <button
                  type="button"
                  onClick={() => shiftPreset(1)}
                  aria-label="Next preset"
                >
                  <ArrowRight />
                </button>
              </div>
            </div>
            <div className="preset-carousel" ref={carouselRef}>
              {presets.map((preset) => {
                const Icon =
                  iconMap[preset.icon as keyof typeof iconMap] ?? Sparkles;
                const selected = preset.id === selectedId;
                return (
                  <button
                    data-preset={preset.id}
                    className={`preset-card ${selected ? "selected" : ""}`}
                    style={
                      {
                        "--preset-accent": preset.accent,
                        "--preset-tint": preset.tint,
                      } as React.CSSProperties
                    }
                    key={preset.id}
                    type="button"
                    onClick={() => choosePreset(preset.id)}
                    aria-pressed={selected}
                  >
                    <span className="preset-icon">
                      <Icon size={22} />
                    </span>
                    <span className="preset-badge">{preset.badge}</span>
                    <strong>{preset.shortTitle}</strong>
                    <small>{preset.tagline}</small>
                    <em>
                      {preset.eta} <ChevronRight size={13} />
                    </em>
                  </button>
                );
              })}
            </div>
          </section>

          <DropsStudioSetup
              key={`${selectedId}-${customMode}`}
              preset={selectedPreset}
              draftSpec={draftSpec}
              customMode={customMode}
              values={values}
              tools={customTools}
              selectedTools={selectedTools}
              providers={providerList.filter((item) =>
                [
                  "free",
                  "openai",
                  "anthropic",
                  "openrouter",
                  "kimi",
                  "custom",
                ].includes(item.id),
              )}
              connections={connections}
              activeBrain={activeBrain}
              dataMode={dataMode}
              building={building}
              onCustomModeChange={setCustomMode}
              onUpdateField={updateField}
              onSelectAllTools={() =>
                setSelectedTools(customTools.map((tool) => tool.id))
              }
              onToggleTool={toggleTool}
              onAddTool={() =>
                setToast(
                  "APIs, Telegram, AI and deployment accounts are added through Connections.",
                )
              }
              onChooseProvider={(providerId) => {
                const id = providerId as ProviderId;
                const item = providerList.find((candidate) => candidate.id === id);
                if (!item) return;
                if (connections[id]) {
                  setActiveBrain(id);
                  window.sessionStorage.setItem(
                    "drops-studio:active-brain",
                    id,
                  );
                  setToast(`${item.name} is now the active brain.`);
                } else openProvider(id);
              }}
              onRefreshMarket={refreshMarket}
              onBuild={() => void buildProject()}
              onBlank={() => {
                setCustomMode(true);
                setPrompt("");
                setToast(
                  "Idea mode enabled. Describe any crypto product and map it onto one of 12 extensible working foundations.",
                );
              }}
            />
        </section>

        {previewSection.ready || selectedId !== defaultPresetId ? (
          <PreviewCanvas
            preset={selectedPreset}
            spec={draftSpec ?? undefined}
            values={values}
            market={market}
            dataMode={dataMode}
            prediction={prediction}
            isPlaying={isPlaying}
            onToggleAudio={toggleAudio}
            onAction={handlePreviewAction}
          />
        ) : (
          <section
            ref={previewSection.elementRef}
            className="preview-column"
            aria-busy="true"
            aria-label="Preparing product preview"
          >
            <div className="preview-device" />
          </section>
        )}
      </div>

      <footer className="studio-footer">
        <div className="studio-footer-intro">
          <DropsBrand compact />
          <p>
            Build real crypto products with DropsTab intelligence and approved
            Drops Bot delivery.
          </p>
        </div>
        <div className="studio-footer-links">
          <div>
            <strong>Product</strong>
            <a href="/templates">Templates</a>
            <a href="/projects">Projects</a>
            <a href="/integrations">Integrations</a>
            <a href="/platform">Platform</a>
          </div>
          <div>
            <strong>Ecosystem</strong>
            <a href="https://dropstab.com/" target="_blank" rel="noreferrer">
              DropsTab
            </a>
            <a
              href="https://dropstab.com/products/drops-bot"
              target="_blank"
              rel="noreferrer"
            >
              Drops Bot
            </a>
            <a
              href="https://api-docs.dropstab.com/"
              target="_blank"
              rel="noreferrer"
            >
              API documentation
            </a>
          </div>
          <div>
            <strong>Community</strong>
            <a href="https://x.com/Dropstab_com" target="_blank" rel="noreferrer">
              X / Twitter
            </a>
            <a href="https://t.me/dropstab_en" target="_blank" rel="noreferrer">
              Telegram
            </a>
            <a
              href="https://discord.com/invite/8krdPBCvEU"
              target="_blank"
              rel="noreferrer"
            >
              Discord
            </a>
          </div>
        </div>
        <div className="studio-footer-bottom">
          <span>© {new Date().getFullYear()} Drops Studio</span>
          <span>Session-safe credentials · explicit approval for external actions</span>
        </div>
      </footer>

      {(connectionOpen || projectsOpen) && (
        <DropsStudioDialogs
          connectionOpen={connectionOpen}
          onConnectionOpenChange={(open) => {
            if (open) setConnectionOpen(true);
            else closeConnectionsHub();
          }}
          projectsOpen={projectsOpen}
          onProjectsOpenChange={setProjectsOpen}
          providers={providerList}
          provider={provider}
          providerId={providerId}
          connections={connections}
          providerKey={providerKey}
          providerModel={providerModel}
          providerModelCatalog={providerModelCatalog}
          customEndpoint={customEndpoint}
          testingConnection={testingConnection}
          selectedId={selectedId}
          telegramProject={telegramProject}
          telegramProjectSlug={telegramProjectSlug}
          projects={projects}
          onSelectProvider={selectProvider}
          onProviderKeyChange={setProviderKey}
          onProviderModelChange={selectProviderModel}
          onCustomEndpointChange={setCustomEndpoint}
          onConnectOpenRouter={() => void connectOpenRouterAccount()}
          memberConnected={memberConnected}
          accountProfile={accountProfile}
          onSignInGoogle={startGoogleSignIn}
          onSignOut={() => void signOutStudioAccount()}
          projectSyncAvailable={projectSyncAvailable}
          onDisconnectOpenRouter={() => void disconnectOpenRouterAccount()}
          onConnectProvider={() => void connectProvider()}
          onOpenProject={(id) => router.push(`/studio/${id}`)}
          onDeleteProject={deleteProjectFromLibrary}
          onDeleteAllProjects={deleteAllProjectsFromLibrary}
        />
      )}

      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        <CircleHelp size={17} />
        {toast}
      </div>
    </main>
  );
}
