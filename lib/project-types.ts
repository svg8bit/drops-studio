import type { PresetId } from "@/lib/presets";

export type ProjectProvider = "free" | "gateway" | "openai" | "anthropic" | "openrouter" | "kimi" | "custom";

export type ProjectDesignKit =
  | "drops-precision"
  | "neon-arena"
  | "mascot-pop"
  | "glass-signal"
  | "editorial-alpha"
  | "terminal-pro";

export type ProjectDensity = "compact" | "comfortable" | "cinematic";
export type ProjectMotion = "reduced" | "smooth" | "expressive";
export type ProjectDeliveryMode = "web-native" | "connection-required" | "research-only";
export type ProjectLaunchStatus = "web-ready" | "external-setup-required" | "research-only";

export interface ProjectRealityContract {
  deliveryMode: ProjectDeliveryMode;
  externalSetupRequired: boolean;
  deliverable: string;
  worksNow: string[];
  requires: string[];
  forbiddenClaims: string[];
}

export interface ProjectBlockConfig {
  visible: boolean;
  variant: "default" | "compact" | "wide" | "spotlight";
}

export interface ProjectGameDirection {
  genre: "market-race" | "coin-quiz" | "portfolio-battle" | "unlock-dodge" | "catcher";
  artStyle: "3d-toy" | "comic" | "pixel" | "neon" | "retro-cartoon";
  world: "cloud-city" | "space-exchange" | "token-island" | "cyber-arcade" | "retro-factory";
  mascot: "coin-crew" | "rocket-pets" | "market-monsters" | "retro-wolf" | "no-mascot";
  gameLoop: string;
  mechanic: string;
  protagonist: string;
  scene: string;
  objective: string;
  artDirection: string;
  dataUse: string;
  difficulty: "casual" | "normal" | "expert";
  roundSeconds: number;
  sound: boolean;
  assetSource: "free-vector" | "uploaded" | "ai-generated";
  backgroundImage?: string;
}

export interface ProjectBlueprint {
  locale: "en" | "ru" | "auto";
  productType: string;
  visualConcept: string;
  primaryLoop: string;
  modules: string[];
  screens: string[];
  interactions: string[];
  dropsTabUse: string[];
  dropsBotUse: string[];
  acceptanceChecks: string[];
  revisionNotes?: string[];
  content: {
    headline: string;
    subheadline: string;
    primaryAction: string;
    emptyState: string;
  };
  game?: {
    mechanic: string;
    protagonist: string;
    scene: string;
    objective: string;
    artDirection: string;
    dataUse: string;
  };
}

export interface ProjectExperienceDirection {
  archetype:
    | "decision-cockpit"
    | "creator-feed"
    | "editorial-brief"
    | "impact-map"
    | "strategy-monitor"
    | "market-explorer"
    | "game-world"
    | "discovery-companion"
    | "character-habitat"
    | "launch-board"
    | "audio-studio"
    | "voice-assistant";
  layout: "focus" | "split" | "dashboard" | "feed" | "spatial";
  dataView: "cards" | "table" | "timeline" | "graph" | "map";
  engagement: "realtime" | "scheduled" | "social" | "personal";
  audience: string;
  primaryLoop: string;
  modules: string[];
  assetSource: "free-vector" | "uploaded" | "ai-generated";
  backgroundImage?: string;
}

export interface ProjectMarketCoin {
  symbol: string;
  name: string;
  price: string;
  change: number | null;
  marketCap: string;
}

export interface ProjectPrediction {
  title: string;
  probability: number | null;
  change: number | null;
  url?: string;
}

export interface GeneratedProjectSpec {
  schemaVersion: 1;
  presetId: PresetId;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  prompt: string;
  values: Record<string, string>;
  tools: string[];
  brain: {
    provider: ProjectProvider;
    model: string;
    enhanced: boolean;
  };
  theme: {
    accent: string;
    surface: string;
    mode: "light" | "dark" | "hybrid";
    style: "precision" | "cosmic" | "editorial" | "playful";
  };
  design: {
    kit: ProjectDesignKit;
    density: ProjectDensity;
    motion: ProjectMotion;
    radius: number;
    font: "inter" | "space-grotesk" | "ibm-plex";
  };
  blocks: Record<string, ProjectBlockConfig>;
  experience: ProjectExperienceDirection;
  blueprint: ProjectBlueprint;
  gameDirection?: ProjectGameDirection;
  market: ProjectMarketCoin[];
  prediction: ProjectPrediction;
  dataEndpoint: string;
  createdAt: string;
}

export interface GeneratedProject {
  id: string;
  spec: GeneratedProjectSpec;
  html: string;
  createdAt: string;
  updatedAt: string;
  publishedUrl?: string;
  publishedSlug?: string;
  publishedAt?: string;
  checkpoints?: ProjectCheckpoint[];
  conversation?: ProjectChatMessage[];
  quality?: ProjectQualityReport;
}

export interface ProjectQualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  weight: number;
  critical: boolean;
}

export interface ProjectQualityReport {
  score: number;
  readyToPublish: boolean;
  launchStatus: ProjectLaunchStatus;
  deliveryMode: ProjectDeliveryMode;
  externalSetupRequired: boolean;
  checkedAt: string;
  checks: ProjectQualityCheck[];
  criticalFailures: string[];
  runtimeSmoke?: ProjectRuntimeSmokeResult;
}

export interface ProjectRuntimeSmokeResult {
  executed: boolean;
  runtime: boolean;
  interactions: boolean;
  dropstab: boolean;
  dropsbot: boolean;
  actions: boolean;
  errors: string[];
  checkedAt: string;
}

export interface ProjectCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  source: "director" | "design" | "manual" | "system";
  spec: GeneratedProjectSpec;
}

export interface ProjectChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposal?: {
    label: string;
    summary: string[];
    spec: GeneratedProjectSpec;
  };
}

export interface PublishedProjectRecord {
  id: string;
  slug: string;
  title: string;
  presetId: PresetId;
  spec: GeneratedProjectSpec;
  html: string;
  createdAt: string;
}

export const PROJECTS_STORAGE_KEY = "drops-studio-projects-v2";
