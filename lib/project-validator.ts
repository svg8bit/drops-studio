import { getProjectPreset, projectPresets, type PresetId } from "@/lib/presets";
import { createDefaultBlueprint, createDefaultCustomGraph } from "@/lib/product-blueprint";
import type { GeneratedProjectSpec, ProjectBlockConfig, ProjectBlueprint, ProjectCustomAction, ProjectCustomComponent, ProjectCustomComponentKind, ProjectCustomDataSource, ProjectCustomGraph, ProjectDesignKit, ProjectElementConfig, ProjectExperienceDirection, ProjectGameDirection, ProjectMarketCoin, ProjectPrediction, ProjectProvider } from "@/lib/project-types";

const presetIds = new Set(projectPresets.map((preset) => preset.id));
const providers = new Set<ProjectProvider>(["free", "gateway", "openai", "anthropic", "openrouter", "kimi", "custom"]);
const modes = new Set(["light", "dark", "hybrid"]);
const styles = new Set(["precision", "cosmic", "editorial", "playful"]);
const designKits = new Set<ProjectDesignKit>(["drops-precision", "neon-arena", "mascot-pop", "glass-signal", "editorial-alpha", "terminal-pro"]);
const densities = new Set(["compact", "comfortable", "cinematic"]);
const motions = new Set(["reduced", "smooth", "expressive"]);
const fonts = new Set(["inter", "space-grotesk", "ibm-plex"]);
const blockVariants = new Set<ProjectBlockConfig["variant"]>(["default", "compact", "wide", "spotlight"]);
const textAlignments = new Set<ProjectElementConfig["textAlign"]>(["left", "center", "right"]);
const gameGenres = new Set<ProjectGameDirection["genre"]>(["market-race", "coin-quiz", "portfolio-battle", "unlock-dodge", "catcher"]);
const artStyles = new Set<ProjectGameDirection["artStyle"]>(["3d-toy", "comic", "pixel", "neon", "retro-cartoon"]);
const gameWorlds = new Set<ProjectGameDirection["world"]>(["cloud-city", "space-exchange", "token-island", "cyber-arcade", "retro-factory"]);
const mascots = new Set<ProjectGameDirection["mascot"]>(["coin-crew", "rocket-pets", "market-monsters", "retro-wolf", "no-mascot"]);
const assetSources = new Set<ProjectGameDirection["assetSource"]>(["free-vector", "uploaded", "ai-generated"]);
const difficulties = new Set<ProjectGameDirection["difficulty"]>(["casual", "normal", "expert"]);
const experienceArchetypes = new Set<ProjectExperienceDirection["archetype"]>(["decision-cockpit", "creator-feed", "editorial-brief", "impact-map", "strategy-monitor", "market-explorer", "game-world", "discovery-companion", "character-habitat", "launch-board", "audio-studio", "voice-assistant", "modular-crypto-app"]);
const experienceLayouts = new Set<ProjectExperienceDirection["layout"]>(["focus", "split", "dashboard", "feed", "spatial"]);
const dataViews = new Set<ProjectExperienceDirection["dataView"]>(["cards", "table", "timeline", "graph", "map", "mixed"]);
const engagements = new Set<ProjectExperienceDirection["engagement"]>(["realtime", "scheduled", "social", "personal"]);
const customComponentKinds = new Set<ProjectCustomComponentKind>(["metric-strip", "market-table", "watchlist", "research-feed", "event-timeline", "comparison", "portfolio", "alert-builder", "notes"]);
const customDataSources = new Set<ProjectCustomDataSource>(["market", "unlocks", "funding", "activities", "predictions", "local"]);
const customActions = new Set<ProjectCustomAction>(["refresh", "filter", "sort", "favorite", "compare", "save-local", "open-dropstab", "configure-dropsbot", "none"]);
const customSpans = new Set<ProjectCustomComponent["span"]>(["third", "half", "full"]);
const customLayouts = new Set<ProjectCustomGraph["screens"][number]["layout"]>(["grid", "feed", "split"]);

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
  "custom-product": { archetype: "modular-crypto-app", layout: "dashboard", dataView: "mixed", engagement: "personal", audience: "Crypto product operators", primaryLoop: "Open workspace → inspect sourced context → use the product tool → save local progress → configure alerts", modules: ["Market context", "Product workspace", "Research", "Saved state", "Alert setup"] },
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

function elementColor(value: unknown, allowTransparent = false): string | undefined {
  if (allowTransparent && value === "transparent") return "transparent";
  if (typeof value !== "string") return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgba = value.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/i);
  if (!rgba) return undefined;
  const channels = rgba.slice(1, 4).map(Number);
  const alpha = Number(rgba[4]);
  if (channels.some((channel) => channel < 0 || channel > 255) || alpha < 0 || alpha > 1) return undefined;
  return `rgba(${channels.join(", ")}, ${alpha})`;
}

function elements(value: unknown): Record<string, ProjectElementConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const seen = new Set<string>();
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 96).map(([rawKey, rawValue]) => {
    const baseKey = cleanText(rawKey, "element", 96).toLowerCase().replace(/[^a-z0-9-]/g, "-") || "element";
    let key = baseKey;
    let suffix = 2;
    while (seen.has(key)) {
      const tail = `-${suffix}`;
      key = `${baseKey.slice(0, 96 - tail.length)}${tail}`;
      suffix += 1;
    }
    seen.add(key);
    const item = rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : {};
    const optionalNumber = (field: string, min: number, max: number) => {
      if (item[field] === undefined || item[field] === null || item[field] === "") return undefined;
      const candidate = Number(item[field]);
      return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : undefined;
    };
    const text = typeof item.text === "string"
      ? item.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 800)
      : undefined;
    const imageSrc = typeof item.imageSrc === "string" && (
      /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(item.imageSrc)
      || (/^\/assets\/[a-z0-9._/-]+$/i.test(item.imageSrc) && !item.imageSrc.includes(".."))
      || /^https:\/\/[^\s]+$/i.test(item.imageSrc)
    ) && item.imageSrc.length <= 360_000 ? item.imageSrc : undefined;
    const safeColor = elementColor(item.color);
    const safeBackground = elementColor(item.backgroundColor, true);
    const textAlign = textAlignments.has(item.textAlign as ProjectElementConfig["textAlign"]) ? item.textAlign as ProjectElementConfig["textAlign"] : undefined;
    return [key, {
      ...(text !== undefined ? { text } : {}),
      ...(imageSrc ? { imageSrc } : {}),
      ...(typeof item.visible === "boolean" ? { visible: item.visible } : {}),
      ...(safeColor ? { color: safeColor } : {}),
      ...(safeBackground ? { backgroundColor: safeBackground } : {}),
      ...(optionalNumber("fontSize", 12, 120) !== undefined ? { fontSize: Math.round(optionalNumber("fontSize", 12, 120) as number) } : {}),
      ...(optionalNumber("fontWeight", 300, 950) !== undefined ? { fontWeight: Math.round(optionalNumber("fontWeight", 300, 950) as number) } : {}),
      ...(textAlign ? { textAlign } : {}),
      ...(optionalNumber("width", 10, 100) !== undefined ? { width: optionalNumber("width", 10, 100) } : {}),
      ...(optionalNumber("padding", 0, 80) !== undefined ? { padding: Math.round(optionalNumber("padding", 0, 80) as number) } : {}),
      ...(optionalNumber("borderRadius", 0, 80) !== undefined ? { borderRadius: Math.round(optionalNumber("borderRadius", 0, 80) as number) } : {}),
      ...(optionalNumber("translateX", -500, 500) !== undefined ? { translateX: Math.round(optionalNumber("translateX", -500, 500) as number) } : {}),
      ...(optionalNumber("translateY", -500, 500) !== undefined ? { translateY: Math.round(optionalNumber("translateY", -500, 500) as number) } : {}),
      ...(optionalNumber("opacity", 0, 1) !== undefined ? { opacity: optionalNumber("opacity", 0, 1) } : {}),
      ...(optionalNumber("zIndex", -10, 100) !== undefined ? { zIndex: Math.round(optionalNumber("zIndex", -10, 100) as number) } : {}),
    } satisfies ProjectElementConfig];
  }));
}

function textList(value: unknown, fallback: string[], maxItems = 12, maxLength = 140): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.map((item) => cleanText(item, "", maxLength)).filter(Boolean).slice(0, maxItems);
  return items.length ? items : [...fallback];
}

function customId(value: unknown, fallback: string): string {
  const id = cleanText(value, fallback, 48)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function uniqueCustomId(raw: unknown, fallback: string, seen: Set<string>): string {
  const base = customId(raw, fallback);
  let id = base;
  let suffix = 2;
  while (seen.has(id)) {
    const tail = `-${suffix}`;
    id = `${base.slice(0, 48 - tail.length)}${tail}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function customRoute(value: unknown, screenId: string): string {
  if (value === "/") return "/";
  if (typeof value !== "string" || value.length > 80 || !value.startsWith("/")) return `/${screenId}`;
  const route = value
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\/{0,1}$/, "")
    .replace(/\.{2,}/g, "");
  return route && route !== "/" ? `/${route.replace(/^\/+/, "")}` : "/";
}

function customGraph(value: unknown, prompt: string): ProjectCustomGraph {
  const fallback = createDefaultCustomGraph(prompt);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawComponents = Array.isArray(input.components) ? input.components.slice(0, 18) : fallback.components;
  const seenComponents = new Set<string>();
  const aliases = new Map<string, string>();
  const components = rawComponents.map((raw, index): ProjectCustomComponent => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const rawId = cleanText(item.id, `component-${index + 1}`, 80);
    const id = uniqueCustomId(rawId, `component-${index + 1}`, seenComponents);
    aliases.set(rawId, id);
    aliases.set(customId(rawId, id), id);
    const kind = customComponentKinds.has(item.kind as ProjectCustomComponentKind) ? item.kind as ProjectCustomComponentKind : "research-feed";
    const dataSource = customDataSources.has(item.dataSource as ProjectCustomDataSource) ? item.dataSource as ProjectCustomDataSource : kind === "notes" ? "local" : "market";
    const actions = Array.isArray(item.actions)
      ? Array.from(new Set(item.actions.filter((action): action is ProjectCustomAction => customActions.has(action as ProjectCustomAction)))).slice(0, 6)
      : [];
    return {
      id,
      title: cleanText(item.title, `Component ${index + 1}`, 80).replace(/[<>]/g, ""),
      description: cleanText(item.description, "Editable product component.", 220).replace(/[<>]/g, ""),
      kind,
      dataSource,
      actions: actions.length ? actions : [kind === "notes" ? "save-local" : "open-dropstab"],
      span: customSpans.has(item.span as ProjectCustomComponent["span"]) ? item.span as ProjectCustomComponent["span"] : "half",
    };
  });
  const safeComponents = components.length ? components : fallback.components;
  const componentIds = new Set(safeComponents.map((component) => component.id));
  const resolveComponentIds = (candidate: unknown, defaults: string[]): string[] => {
    const safeDefaults = defaults.filter((id) => componentIds.has(id)).slice(0, 12);
    if (!Array.isArray(candidate)) return safeDefaults.length ? safeDefaults : [safeComponents[0].id];
    const resolved = candidate
      .map((id) => aliases.get(cleanText(id, "", 80)) ?? aliases.get(customId(id, "")) ?? customId(id, ""))
      .filter((id) => componentIds.has(id));
    const unique = Array.from(new Set(resolved)).slice(0, 12);
    return unique.length ? unique : safeDefaults.length ? safeDefaults : [safeComponents[0].id];
  };

  const rawScreens = Array.isArray(input.screens) ? input.screens.slice(0, 6) : fallback.screens;
  const seenScreens = new Set<string>();
  const screens = rawScreens.map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const fallbackScreen = fallback.screens[index] ?? fallback.screens[0];
    const id = uniqueCustomId(item.id, fallbackScreen?.id ?? `screen-${index + 1}`, seenScreens);
    return {
      id,
      title: cleanText(item.title, fallbackScreen?.title ?? `Screen ${index + 1}`, 72).replace(/[<>]/g, ""),
      route: customRoute(item.route, id),
      layout: customLayouts.has(item.layout as ProjectCustomGraph["screens"][number]["layout"])
        ? item.layout as ProjectCustomGraph["screens"][number]["layout"]
        : fallbackScreen?.layout ?? "grid",
      componentIds: resolveComponentIds(item.componentIds, fallbackScreen?.componentIds ?? safeComponents.slice(0, 4).map((component) => component.id)),
    };
  });
  const safeScreens = screens.length ? screens : fallback.screens;

  const rawModules = Array.isArray(input.modules) ? input.modules.slice(0, 10) : fallback.modules;
  const seenModules = new Set<string>();
  const modules = rawModules.map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const fallbackModule = fallback.modules[index] ?? fallback.modules[0];
    const id = uniqueCustomId(item.id, fallbackModule?.id ?? `module-${index + 1}`, seenModules);
    return {
      id,
      title: cleanText(item.title, fallbackModule?.title ?? `Module ${index + 1}`, 72).replace(/[<>]/g, ""),
      description: cleanText(item.description, fallbackModule?.description ?? "Bounded product module.", 180).replace(/[<>]/g, ""),
      componentIds: resolveComponentIds(item.componentIds, fallbackModule?.componentIds ?? safeComponents.slice(0, 4).map((component) => component.id)),
    };
  });
  const safeModules = modules.length ? modules : fallback.modules;
  const requestedInitial = customId(input.initialScreenId, fallback.initialScreenId);

  return {
    version: 1,
    appKind: cleanText(input.appKind, fallback.appKind, 100).replace(/[<>]/g, ""),
    initialScreenId: safeScreens.some((screen) => screen.id === requestedInitial) ? requestedInitial : safeScreens[0].id,
    screens: safeScreens,
    modules: safeModules,
    components: safeComponents,
  };
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
  const preset = getProjectPreset(presetId);
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
    elements: elements(input.elements),
    experience: experienceDirection(input.experience, presetId),
    blueprint: blueprint(input.blueprint, presetId, safePrompt),
    ...(presetId === "custom-product" ? { customGraph: customGraph(input.customGraph, safePrompt) } : {}),
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
    customGraph: spec.presetId === "custom-product"
      ? (input.customGraph && typeof input.customGraph === "object" ? input.customGraph : spec.customGraph)
      : undefined,
    gameDirection: spec.gameDirection ? { ...spec.gameDirection, ...(input.gameDirection && typeof input.gameDirection === "object" ? input.gameDirection : {}) } : undefined,
    brain: { ...spec.brain, enhanced: true },
  });
}
