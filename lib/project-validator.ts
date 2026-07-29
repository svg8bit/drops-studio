import { presets, type PresetId } from "@/lib/presets";
import { createDefaultBlueprint } from "@/lib/product-blueprint";
import type { GeneratedProjectSpec, ProjectBlockConfig, ProjectBlueprint, ProjectDesignKit, ProjectExperienceDirection, ProjectGameDirection, ProjectMarketCoin, ProjectPrediction, ProjectProvider } from "@/lib/project-types";

const presetIds = new Set(presets.map((preset) => preset.id));
const providers = new Set<ProjectProvider>(["free", "gateway", "openai", "anthropic", "openrouter", "kimi", "custom"]);
const modes = new Set(["light", "dark", "hybrid"]);
const styles = new Set(["precision", "cosmic", "editorial", "playful"]);
const designKits = new Set<ProjectDesignKit>(["drops-precision", "neon-arena", "mascot-pop", "glass-signal", "editorial-alpha", "terminal-pro"]);
const densities = new Set(["compact", "comfortable", "cinematic"]);
const motions = new Set(["reduced", "smooth", "expressive"]);
const fonts = new Set(["inter", "space-grotesk", "ibm-plex"]);
const blockVariants = new Set<ProjectBlockConfig["variant"]>(["default", "compact", "wide", "spotlight"]);
const gameGenres = new Set<ProjectGameDirection["genre"]>(["market-race", "coin-quiz", "portfolio-battle", "unlock-dodge", "catcher"]);
const artStyles = new Set<ProjectGameDirection["artStyle"]>(["3d-toy", "comic", "pixel", "neon", "retro-cartoon"]);
const gameWorlds = new Set<ProjectGameDirection["world"]>(["cloud-city", "space-exchange", "token-island", "cyber-arcade", "retro-factory"]);
const mascots = new Set<ProjectGameDirection["mascot"]>(["coin-crew", "rocket-pets", "market-monsters", "retro-wolf", "no-mascot"]);
const assetSources = new Set<ProjectGameDirection["assetSource"]>(["free-vector", "uploaded", "ai-generated"]);
const difficulties = new Set<ProjectGameDirection["difficulty"]>(["casual", "normal", "expert"]);
const experienceArchetypes = new Set<ProjectExperienceDirection["archetype"]>(["decision-cockpit", "creator-feed", "editorial-brief", "impact-map", "strategy-monitor", "market-explorer", "game-world", "discovery-companion", "character-habitat", "launch-board", "audio-studio", "voice-assistant"]);
const experienceLayouts = new Set<ProjectExperienceDirection["layout"]>(["focus", "split", "dashboard", "feed", "spatial"]);
const dataViews = new Set<ProjectExperienceDirection["dataView"]>(["cards", "table", "timeline", "graph", "map"]);
const engagements = new Set<ProjectExperienceDirection["engagement"]>(["realtime", "scheduled", "social", "personal"]);

const experienceDefaults: Record<PresetId, Omit<ProjectExperienceDirection, "assetSource" | "backgroundImage">> = {
  "action-engine": { archetype: "decision-cockpit", layout: "split", dataView: "graph", engagement: "realtime", audience: "Active crypto operators", primaryLoop: "Define thesis → confirm trigger → review action → monitor outcome", modules: ["Thesis", "Trigger graph", "Action ledger", "Drops Bot handoff"] },
  "alpha-channel": { archetype: "creator-feed", layout: "feed", dataView: "timeline", engagement: "social", audience: "Telegram crypto creators", primaryLoop: "Discover sourced signal → compose → approve → publish → monetize", modules: ["Signal inbox", "Composer", "Channel preview", "Growth loop"] },
  "morning-alpha": { archetype: "editorial-brief", layout: "focus", dataView: "cards", engagement: "scheduled", audience: "Daily crypto decision makers", primaryLoop: "Refresh context → scan priorities → open research → set alerts", modules: ["Market strip", "Decision brief", "Catalysts", "Action list"] },
  "prediction-impact": { archetype: "impact-map", layout: "split", dataView: "map", engagement: "realtime", audience: "Event-driven traders", primaryLoop: "Watch odds → map affected assets → review sensitivity → choose action", modules: ["Odds signal", "Impact graph", "Asset map", "Action plan"] },
  "smart-money-copy": { archetype: "strategy-monitor", layout: "dashboard", dataView: "timeline", engagement: "realtime", audience: "Risk-aware onchain traders", primaryLoop: "Follow wallets → confirm context → simulate → approve or skip", modules: ["Wallet feed", "Risk rules", "Paper ledger", "Alerts"] },
  "crypto-aggregator": { archetype: "market-explorer", layout: "dashboard", dataView: "table", engagement: "realtime", audience: "Crypto researchers and communities", primaryLoop: "Search → filter and rank → inspect asset → compare or track", modules: ["Search", "Rankings", "Coin pages", "Watchlist"] },
  "crypto-game": { archetype: "game-world", layout: "spatial", dataView: "graph", engagement: "social", audience: "Crypto-curious players", primaryLoop: "Choose hero → play live round → earn score → challenge friends", modules: ["Game scene", "Characters", "Leaderboard", "Daily quests"] },
  "personal-companion": { archetype: "discovery-companion", layout: "feed", dataView: "cards", engagement: "personal", audience: "Personalized crypto explorers", primaryLoop: "Express taste → explore recommendation → explain → save or dismiss", modules: ["Taste graph", "Discovery feed", "Explanations", "Memory"] },
  "portfolio-tamagotchi": { archetype: "character-habitat", layout: "split", dataView: "cards", engagement: "personal", audience: "Portfolio holders who want playful risk feedback", primaryLoop: "Check creature → understand health → take safe care action → share", modules: ["Creature", "Portfolio health", "Care actions", "Alerts"] },
  "crypto-product-hunt": { archetype: "launch-board", layout: "feed", dataView: "cards", engagement: "social", audience: "Crypto builders and early adopters", primaryLoop: "Discover launch → inspect context → vote or follow → submit", modules: ["Launch feed", "Filters", "Project context", "Submissions"] },
  "crypto-radio": { archetype: "audio-studio", layout: "split", dataView: "timeline", engagement: "scheduled", audience: "Listeners who prefer audio intelligence", primaryLoop: "Build rundown → listen → skip or deepen → schedule or share", modules: ["Player", "Rundown", "Voice", "Schedule"] },
  "crypto-siri": { archetype: "voice-assistant", layout: "focus", dataView: "cards", engagement: "personal", audience: "Voice-first crypto users", primaryLoop: "Ask → hear sourced answer → open research → create alert", modules: ["Voice orb", "Answer cards", "Research handoff", "Alert intent"] },
};

function cleanText(value: unknown, fallback: string, max = 160): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

function cleanSlug(value: unknown, fallback: string): string {
  const slug = cleanText(value, fallback, 72).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
}

function optionalFinite(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : null;
}

function backgroundImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 760_000) return undefined;
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function market(value: unknown): ProjectMarketCoin[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((row): ProjectMarketCoin | null => {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    const symbol = cleanText(item.symbol, "", 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol) return null;
    return {
      symbol,
      name: cleanText(item.name, symbol, 40),
      price: cleanText(item.price, "—", 24),
      change: optionalFinite(item.change, -99.99, 999.99),
      marketCap: cleanText(item.marketCap, "—", 24),
    };
  }).filter((item): item is ProjectMarketCoin => Boolean(item));
}

function prediction(value: unknown): ProjectPrediction {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const url = typeof item.url === "string" && /^https:\/\//i.test(item.url) ? item.url.slice(0, 500) : undefined;
  const probability = optionalFinite(item.probability, 0, 100);
  const probabilityChange = optionalFinite(item.change, -100, 100);
  return {
    title: cleanText(item.title, "Waiting for a live crypto prediction market", 180),
    probability: probability === null ? null : Math.round(probability),
    change: probabilityChange === null ? null : Math.round(probabilityChange),
    ...(url ? { url } : {}),
  };
}

function blocks(value: unknown): Record<string, ProjectBlockConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 32).map(([rawKey, rawValue]) => {
    const key = cleanText(rawKey, "block", 48).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const item = rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : {};
    const variant = blockVariants.has(item.variant as ProjectBlockConfig["variant"]) ? item.variant as ProjectBlockConfig["variant"] : "default";
    return [key, { visible: item.visible !== false, variant } satisfies ProjectBlockConfig];
  }));
}

function textList(value: unknown, fallback: string[], maxItems = 12, maxLength = 140): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.map((item) => cleanText(item, "", maxLength)).filter(Boolean).slice(0, maxItems);
  return items.length ? items : [...fallback];
}

function blueprint(value: unknown, presetId: PresetId, prompt: string): ProjectBlueprint {
  const fallback = createDefaultBlueprint(presetId, prompt);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const contentInput = input.content && typeof input.content === "object" && !Array.isArray(input.content) ? input.content as Record<string, unknown> : {};
  const gameInput = input.game && typeof input.game === "object" && !Array.isArray(input.game) ? input.game as Record<string, unknown> : null;
  const locale = input.locale === "ru" || input.locale === "en" || input.locale === "auto" ? input.locale : fallback.locale;
  return {
    locale,
    productType: cleanText(input.productType, fallback.productType, 100),
    visualConcept: cleanText(input.visualConcept, fallback.visualConcept, 600),
    primaryLoop: cleanText(input.primaryLoop, fallback.primaryLoop, 500),
    modules: textList(input.modules, fallback.modules, 12, 80),
    screens: textList(input.screens, fallback.screens, 10, 80),
    interactions: textList(input.interactions, fallback.interactions, 14, 120),
    dropsTabUse: textList(input.dropsTabUse, fallback.dropsTabUse, 10, 140),
    dropsBotUse: textList(input.dropsBotUse, fallback.dropsBotUse, 10, 140),
    acceptanceChecks: textList(input.acceptanceChecks, fallback.acceptanceChecks, 10, 180),
    ...(Array.isArray(input.revisionNotes) ? { revisionNotes: textList(input.revisionNotes, [], 8, 180) } : {}),
    content: {
      headline: cleanText(contentInput.headline, fallback.content.headline, 100),
      subheadline: cleanText(contentInput.subheadline, fallback.content.subheadline, 180),
      primaryAction: cleanText(contentInput.primaryAction, fallback.content.primaryAction, 64),
      emptyState: cleanText(contentInput.emptyState, fallback.content.emptyState, 180),
    },
    ...(presetId === "crypto-game" ? {
      game: {
        mechanic: cleanText(gameInput?.mechanic, fallback.game?.mechanic ?? "Catch market objects and avoid risk hazards.", 360),
        protagonist: cleanText(gameInput?.protagonist, fallback.game?.protagonist ?? "An original market character.", 320),
        scene: cleanText(gameInput?.scene, fallback.game?.scene ?? fallback.visualConcept, 420),
        objective: cleanText(gameInput?.objective, fallback.game?.objective ?? fallback.primaryLoop, 320),
        artDirection: cleanText(gameInput?.artDirection, fallback.game?.artDirection ?? fallback.visualConcept, 420),
        dataUse: cleanText(gameInput?.dataUse, fallback.game?.dataUse ?? fallback.dropsTabUse.join(" · "), 420),
      },
    } : {}),
  };
}

function gameDirection(value: unknown): ProjectGameDirection {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const safeBackgroundImage = backgroundImage(input.backgroundImage);
  return {
    genre: gameGenres.has(input.genre as ProjectGameDirection["genre"]) ? input.genre as ProjectGameDirection["genre"] : "market-race",
    artStyle: artStyles.has(input.artStyle as ProjectGameDirection["artStyle"]) ? input.artStyle as ProjectGameDirection["artStyle"] : "3d-toy",
    world: gameWorlds.has(input.world as ProjectGameDirection["world"]) ? input.world as ProjectGameDirection["world"] : "cloud-city",
    mascot: mascots.has(input.mascot as ProjectGameDirection["mascot"]) ? input.mascot as ProjectGameDirection["mascot"] : "coin-crew",
    gameLoop: cleanText(input.gameLoop, "Pick a coin hero, lock a prediction, watch the live market race, then challenge friends.", 240),
    mechanic: cleanText(input.mechanic, "React to market-driven objects and finish the round with the highest score.", 360),
    protagonist: cleanText(input.protagonist, "An original market character.", 320),
    scene: cleanText(input.scene, "A polished illustrated crypto game world.", 420),
    objective: cleanText(input.objective, "Finish the round with the highest market-informed score.", 320),
    artDirection: cleanText(input.artDirection, "Expressive original game illustration with readable silhouettes.", 420),
    dataUse: cleanText(input.dataUse, "DropsTab market context changes the round; Drops Bot delivers daily challenges.", 420),
    difficulty: difficulties.has(input.difficulty as ProjectGameDirection["difficulty"]) ? input.difficulty as ProjectGameDirection["difficulty"] : "normal",
    roundSeconds: Math.round(finite(input.roundSeconds, 8, 5, 120)),
    sound: input.sound !== false,
    assetSource: assetSources.has(input.assetSource as ProjectGameDirection["assetSource"]) ? input.assetSource as ProjectGameDirection["assetSource"] : "free-vector",
    ...(safeBackgroundImage ? { backgroundImage: safeBackgroundImage } : {}),
  };
}

function experienceDirection(value: unknown, presetId: PresetId): ProjectExperienceDirection {
  const fallback = experienceDefaults[presetId];
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const modules = Array.isArray(input.modules) ? input.modules.map((item) => cleanText(item, "", 64)).filter(Boolean).slice(0, 12) : fallback.modules;
  const safeBackgroundImage = backgroundImage(input.backgroundImage);
  return {
    archetype: experienceArchetypes.has(input.archetype as ProjectExperienceDirection["archetype"]) ? input.archetype as ProjectExperienceDirection["archetype"] : fallback.archetype,
    layout: experienceLayouts.has(input.layout as ProjectExperienceDirection["layout"]) ? input.layout as ProjectExperienceDirection["layout"] : fallback.layout,
    dataView: dataViews.has(input.dataView as ProjectExperienceDirection["dataView"]) ? input.dataView as ProjectExperienceDirection["dataView"] : fallback.dataView,
    engagement: engagements.has(input.engagement as ProjectExperienceDirection["engagement"]) ? input.engagement as ProjectExperienceDirection["engagement"] : fallback.engagement,
    audience: cleanText(input.audience, fallback.audience, 120),
    primaryLoop: cleanText(input.primaryLoop, fallback.primaryLoop, 240),
    modules: modules.length ? modules : fallback.modules,
    assetSource: assetSources.has(input.assetSource as ProjectExperienceDirection["assetSource"]) ? input.assetSource as ProjectExperienceDirection["assetSource"] : "free-vector",
    ...(safeBackgroundImage ? { backgroundImage: safeBackgroundImage } : {}),
  };
}

export function validateProjectSpec(value: unknown): GeneratedProjectSpec {
  if (!value || typeof value !== "object") throw new Error("Project spec must be an object.");
  const input = value as Record<string, unknown>;
  const presetId = presetIds.has(input.presetId as PresetId) ? input.presetId as PresetId : "morning-alpha";
  const preset = presets.find((item) => item.id === presetId) ?? presets[0];
  const brainInput = input.brain && typeof input.brain === "object" ? input.brain as Record<string, unknown> : {};
  const provider = providers.has(brainInput.provider as ProjectProvider) ? brainInput.provider as ProjectProvider : "free";
  const themeInput = input.theme && typeof input.theme === "object" ? input.theme as Record<string, unknown> : {};
  const designInput = input.design && typeof input.design === "object" ? input.design as Record<string, unknown> : {};
  const inputValues = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? input.values as Record<string, unknown> : {};
  const values = Object.fromEntries(preset.fields.map((field) => [field.id, cleanText(inputValues[field.id], field.value, 120)]));
  const tools = Array.isArray(input.tools)
    ? input.tools.map((item) => cleanText(item, "", 80)).filter(Boolean).slice(0, 12)
    : preset.tools;
  const safeMarket = market(input.market);
  const safePrompt = cleanText(input.prompt, "", 2_000);
  const dataEndpoint = typeof input.dataEndpoint === "string" && /^https?:\/\//i.test(input.dataEndpoint)
    ? input.dataEndpoint.slice(0, 500)
    : "/api/public-data";

  return {
    schemaVersion: 1,
    presetId,
    name: cleanText(input.name, preset.shortTitle, 64),
    slug: cleanSlug(input.slug, preset.id),
    tagline: cleanText(input.tagline, preset.tagline, 120),
    description: cleanText(input.description, preset.description, 360),
    prompt: safePrompt,
    values,
    tools: tools.length ? tools : preset.tools,
    brain: {
      provider,
      model: cleanText(brainInput.model, provider === "free" ? "Free Auto" : "Connected model", 100),
      enhanced: Boolean(brainInput.enhanced),
    },
    theme: {
      accent: color(themeInput.accent, preset.accent),
      surface: color(themeInput.surface, "#071326"),
      mode: modes.has(String(themeInput.mode)) ? themeInput.mode as GeneratedProjectSpec["theme"]["mode"] : "dark",
      style: styles.has(String(themeInput.style)) ? themeInput.style as GeneratedProjectSpec["theme"]["style"] : presetId === "crypto-game" || presetId === "portfolio-tamagotchi" ? "playful" : "precision",
    },
    design: {
      kit: designKits.has(designInput.kit as ProjectDesignKit) ? designInput.kit as ProjectDesignKit : presetId === "crypto-game" ? "neon-arena" : presetId === "portfolio-tamagotchi" ? "mascot-pop" : "drops-precision",
      density: densities.has(String(designInput.density)) ? designInput.density as GeneratedProjectSpec["design"]["density"] : presetId === "crypto-game" ? "cinematic" : "comfortable",
      motion: motions.has(String(designInput.motion)) ? designInput.motion as GeneratedProjectSpec["design"]["motion"] : presetId === "crypto-game" ? "expressive" : "smooth",
      radius: Math.round(finite(designInput.radius, presetId === "crypto-game" ? 22 : 16, 0, 32)),
      font: fonts.has(String(designInput.font)) ? designInput.font as GeneratedProjectSpec["design"]["font"] : presetId === "crypto-game" ? "space-grotesk" : "inter",
    },
    blocks: blocks(input.blocks),
    experience: experienceDirection(input.experience, presetId),
    blueprint: blueprint(input.blueprint, presetId, safePrompt),
    ...(presetId === "crypto-game" ? { gameDirection: gameDirection(input.gameDirection) } : {}),
    market: safeMarket.length ? safeMarket : [
      { symbol: "BTC", name: "Bitcoin", price: "—", change: null, marketCap: "—" },
      { symbol: "ETH", name: "Ethereum", price: "—", change: null, marketCap: "—" },
      { symbol: "SOL", name: "Solana", price: "—", change: null, marketCap: "—" },
    ],
    prediction: prediction(input.prediction),
    dataEndpoint,
    createdAt: cleanText(input.createdAt, new Date().toISOString(), 40),
  };
}

export function applyEnhancement(spec: GeneratedProjectSpec, enhancement: unknown): GeneratedProjectSpec {
  if (!enhancement || typeof enhancement !== "object") return spec;
  const input = enhancement as Record<string, unknown>;
  const blueprintInput = input.blueprint && typeof input.blueprint === "object"
    ? input.blueprint as Record<string, unknown>
    : null;
  return validateProjectSpec({
    ...spec,
    name: input.name ?? spec.name,
    tagline: input.tagline ?? spec.tagline,
    description: input.description ?? spec.description,
    theme: { ...spec.theme, ...(input.theme && typeof input.theme === "object" ? input.theme : {}) },
    design: { ...spec.design, ...(input.design && typeof input.design === "object" ? input.design : {}) },
    experience: { ...spec.experience, ...(input.experience && typeof input.experience === "object" ? input.experience : {}) },
    blueprint: blueprintInput
      ? {
          ...spec.blueprint,
          ...blueprintInput,
          content: {
            ...spec.blueprint.content,
            ...(blueprintInput.content && typeof blueprintInput.content === "object" ? blueprintInput.content : {}),
          },
        }
      : spec.blueprint,
    gameDirection: spec.gameDirection ? { ...spec.gameDirection, ...(input.gameDirection && typeof input.gameDirection === "object" ? input.gameDirection : {}) } : undefined,
    brain: { ...spec.brain, enhanced: true },
  });
}
