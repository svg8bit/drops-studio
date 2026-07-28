import type { PresetId } from "@/lib/presets";

export type ProjectProvider = "free" | "openai" | "anthropic" | "openrouter" | "kimi" | "custom";

export type ProjectDesignKit =
  | "drops-precision"
  | "neon-arena"
  | "mascot-pop"
  | "glass-signal"
  | "editorial-alpha"
  | "terminal-pro";

export type ProjectDensity = "compact" | "comfortable" | "cinematic";
export type ProjectMotion = "reduced" | "smooth" | "expressive";

export interface ProjectBlockConfig {
  visible: boolean;
  variant: "default" | "compact" | "wide" | "spotlight";
}

export interface ProjectGameDirection {
  genre: "market-race" | "coin-quiz" | "portfolio-battle" | "unlock-dodge";
  artStyle: "3d-toy" | "comic" | "pixel" | "neon";
  world: "cloud-city" | "space-exchange" | "token-island" | "cyber-arcade";
  mascot: "coin-crew" | "rocket-pets" | "market-monsters" | "no-mascot";
  gameLoop: string;
  difficulty: "casual" | "normal" | "expert";
  roundSeconds: number;
  sound: boolean;
  assetSource: "free-vector" | "uploaded" | "ai-generated";
  backgroundImage?: string;
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
  change: number;
  marketCap: string;
}

export interface ProjectPrediction {
  title: string;
  probability: number;
  change: number;
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
