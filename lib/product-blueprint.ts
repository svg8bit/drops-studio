import { getProjectPreset, type PresetId } from "./presets.ts";
import type { GeneratedProjectSpec, ProjectBlueprint, ProjectCustomComponent, ProjectCustomGraph, ProjectElementConfig, ProjectGameDirection } from "./project-types.ts";
import { routeProductIntent } from "./product-intent.ts";
export { routeProductIntent, type ProductIntentRoute } from "./product-intent.ts";

export interface AgentProductPlan {
  presetId: PresetId;
  name: string;
  tagline: string;
  description: string;
  tools: string[];
  blueprint: ProjectBlueprint;
  theme?: Partial<GeneratedProjectSpec["theme"]>;
  design?: Partial<GeneratedProjectSpec["design"]>;
  experience?: Partial<GeneratedProjectSpec["experience"]>;
  customGraph?: ProjectCustomGraph;
  gameDirection?: Partial<ProjectGameDirection>;
  elementEdit?: { elementId: string; config: ProjectElementConfig };
  model?: string;
  provider?: GeneratedProjectSpec["brain"]["provider"];
}

type BlueprintSeed = Omit<ProjectBlueprint, "locale" | "content"> & {
  content: ProjectBlueprint["content"];
};

type ExperienceSeed = Pick<GeneratedProjectSpec["experience"], "archetype" | "layout" | "dataView" | "engagement" | "audience" | "assetSource">;

const experienceSeeds: Record<PresetId, ExperienceSeed> = {
  "action-engine": { archetype: "decision-cockpit", layout: "split", dataView: "graph", engagement: "realtime", audience: "Active crypto operators", assetSource: "free-vector" },
  "alpha-channel": { archetype: "creator-feed", layout: "feed", dataView: "timeline", engagement: "social", audience: "Telegram crypto creators", assetSource: "free-vector" },
  "morning-alpha": { archetype: "editorial-brief", layout: "focus", dataView: "cards", engagement: "scheduled", audience: "Daily crypto decision makers", assetSource: "free-vector" },
  "prediction-impact": { archetype: "impact-map", layout: "split", dataView: "map", engagement: "realtime", audience: "Event-driven traders", assetSource: "free-vector" },
  "smart-money-copy": { archetype: "strategy-monitor", layout: "dashboard", dataView: "timeline", engagement: "realtime", audience: "Risk-aware onchain traders", assetSource: "free-vector" },
  "crypto-aggregator": { archetype: "market-explorer", layout: "dashboard", dataView: "table", engagement: "realtime", audience: "Crypto researchers and communities", assetSource: "free-vector" },
  "crypto-game": { archetype: "game-world", layout: "spatial", dataView: "graph", engagement: "social", audience: "Crypto-curious players", assetSource: "ai-generated" },
  "personal-companion": { archetype: "discovery-companion", layout: "feed", dataView: "cards", engagement: "personal", audience: "Personalized crypto explorers", assetSource: "free-vector" },
  "portfolio-tamagotchi": { archetype: "character-habitat", layout: "split", dataView: "cards", engagement: "personal", audience: "Portfolio holders who want playful risk feedback", assetSource: "ai-generated" },
  "crypto-product-hunt": { archetype: "launch-board", layout: "feed", dataView: "cards", engagement: "social", audience: "Crypto builders and early adopters", assetSource: "free-vector" },
  "crypto-radio": { archetype: "audio-studio", layout: "split", dataView: "timeline", engagement: "scheduled", audience: "Listeners who prefer audio intelligence", assetSource: "free-vector" },
  "crypto-siri": { archetype: "voice-assistant", layout: "focus", dataView: "cards", engagement: "personal", audience: "Voice-first crypto users", assetSource: "free-vector" },
  "custom-product": { archetype: "modular-crypto-app", layout: "dashboard", dataView: "mixed", engagement: "personal", audience: "Crypto product operators", assetSource: "free-vector" },
};

function createDefaultExperience(presetId: PresetId, blueprint: ProjectBlueprint): GeneratedProjectSpec["experience"] {
  return {
    ...experienceSeeds[presetId],
    primaryLoop: blueprint.primaryLoop,
    modules: blueprint.modules.slice(0, 12),
  };
}

function prioritizeUnique(existing: string[], required: string[], limit: number, label: string, revisionNotes: string[]): string[] {
  const items = Array.from(new Set([...required, ...existing]));
  const kept = items.slice(0, limit);
  const replaced = existing.filter((item) => !kept.includes(item));
  if (replaced.length) {
    revisionNotes.push(`${label}: requested capabilities replaced ${replaced.join(", ")} in this revision; the prior checkpoint can restore them.`.slice(0, 180));
  }
  return kept;
}

const seeds: Record<PresetId, BlueprintSeed> = {
  "action-engine": {
    productType: "decision operating system",
    visualConcept: "A calm intelligence cockpit with an evidence graph, trigger rail and explicit action gate.",
    primaryLoop: "Write a thesis → attach DropsTab evidence → wait for a Drops Bot trigger → approve an action plan → monitor the result.",
    modules: ["Thesis builder", "Evidence graph", "Trigger stream", "Action gate", "Decision journal"],
    screens: ["Decision cockpit", "Signal detail", "Action review", "Outcome journal"],
    interactions: ["Compose thesis", "Inspect evidence", "Arm trigger", "Approve or reject plan", "Review outcome"],
    dropsTabUse: ["Market context", "Token research", "Unlock and funding context", "Relative performance"],
    dropsBotUse: ["Price and wallet triggers", "Polymarket triggers", "Telegram delivery", "Alert handoff"],
    acceptanceChecks: ["Every recommendation cites DropsTab context", "No trade is shown as executed without explicit approval", "Armed triggers can be reviewed and disabled"],
    content: { headline: "Turn intelligence into a decision", subheadline: "Know why, catch when, choose what happens next.", primaryAction: "Build decision", emptyState: "Describe a market thesis to create the first decision graph." },
  },
  "alpha-channel": {
    productType: "Telegram channel creator and publishing tool",
    visualConcept: "A sourced signal inbox, native Telegram composer and an explicit account connection flow that creates a real channel, adds the bot and verifies the first post.",
    primaryLoop: "Connect a Telegram user account → create or select a real channel → discover a sourced signal → enrich it with DropsTab context → approve and publish through the bot.",
    modules: ["Signal inbox", "Post composer", "Native Telegram preview", "Channel creator", "Drops Bot automation", "Growth and monetization"],
    screens: ["Signal inbox", "Composer", "Telegram preview", "Account connection", "Live channel result"],
    interactions: ["Filter signals", "Generate sourced post", "Edit voice", "Connect Telegram account", "Create channel", "Add bot", "Publish first post", "Open live channel"],
    dropsTabUse: ["Token pages", "Price and market-cap context", "Unlocks", "Funding and activities"],
    dropsBotUse: ["Wallet and coin alerts", "Channel delivery", "Caller links", "Telegram profiles"],
    acceptanceChecks: ["Preview visibly looks like Telegram and is marked preview until creation succeeds", "Every post contains a DropsTab source handoff", "Only a connected Telegram user account creates the channel", "The UI reports success only after Telegram returns the channel and the bot publishes the first post"],
    content: { headline: "Create your sourced alpha channel", subheadline: "Compose with DropsTab, then launch a real Telegram channel with Drops Bot.", primaryAction: "Create live channel", emptyState: "Choose a niche, then connect your Telegram account to create the channel." },
  },
  "morning-alpha": {
    productType: "personal daily Telegram brief",
    visualConcept: "A bright, highly readable Telegram morning edition with clear sections and research links.",
    primaryLoop: "Refresh the watchlist → rank important changes → read a concise brief → open DropsTab evidence → create follow-up alerts.",
    modules: ["Morning cover", "Biggest moves", "Upcoming unlocks", "Funding and activity", "Action list"],
    screens: ["Telegram brief", "Watchlist setup", "Schedule", "Archive"],
    interactions: ["Choose assets", "Change schedule", "Refresh brief", "Open DropsTab", "Create Drops Bot alert"],
    dropsTabUse: ["Prices and performance", "Unlock calendar", "Funding rounds", "Project activity"],
    dropsBotUse: ["Telegram delivery setup", "Follow-up alerts", "Coin tracking"],
    acceptanceChecks: ["Brief is readable at phone size and marked preview", "Sections react to the chosen watchlist", "Unavailable unlock and funding sections never show invented values"],
    content: { headline: "Morning Alpha", subheadline: "Wake up to decisions, not noise.", primaryAction: "Build today’s brief", emptyState: "Add five to ten assets to create a useful morning edition." },
  },
  "prediction-impact": {
    productType: "prediction-market impact terminal",
    visualConcept: "An event-first research map connecting live odds, a labelled heuristic token relationship and reversible external handoffs.",
    primaryLoop: "Watch an odds move → inspect potentially related assets → open source research → create an alert or external trade plan.",
    modules: ["Event monitor", "Heuristic impact map", "Research basket", "Current reaction", "Action planner"],
    screens: ["Event terminal", "Impact graph", "Basket detail", "Alert setup"],
    interactions: ["Track event", "Change odds trigger", "Inspect selected assets", "Open external market", "Prepare reversal alert"],
    dropsTabUse: ["Selected tokens and categories", "Current performance", "Market cap and liquidity", "Research links"],
    dropsBotUse: ["Polymarket event tracking", "Odds and volume alerts", "Telegram delivery"],
    acceptanceChecks: ["Heuristic event-to-token selection is visibly labelled", "Current reaction is separated from causal prediction", "Actions remain handoffs or plans"],
    content: { headline: "When odds move, see what crypto may feel it", subheadline: "Event context becomes a transparent asset impact map.", primaryAction: "Map this event", emptyState: "Select or paste a prediction market to build an impact graph." },
  },
  "smart-money-copy": {
    productType: "risk-gated copy strategy monitor",
    visualConcept: "A professional wallet stream with confirmation checks, paper execution and an auditable rule set.",
    primaryLoop: "Follow public wallets → confirm the move with DropsTab → size by risk rules → paper-copy or approve → audit performance.",
    modules: ["Wallet stream", "Context checks", "Risk sizing", "Paper ledger", "Alerts"],
    screens: ["Strategy monitor", "Wallet profile", "Risk rules", "Paper ledger"],
    interactions: ["Add wallet", "Filter move", "Inspect context", "Paper-copy", "Mute or alert"],
    dropsTabUse: ["Token liquidity and valuation", "Price performance", "Unlock risk", "Category context"],
    dropsBotUse: ["Public wallet monitoring", "Swap alerts", "Telegram delivery"],
    acceptanceChecks: ["Wallet identities are clearly public/user-provided", "Default mode is paper or one-tap approval", "Every copy decision shows its risk gate"],
    content: { headline: "Copy the rule, not the hype", subheadline: "Paper wallet strategies with context, sizing and an audit trail.", primaryAction: "Run paper copy", emptyState: "Add a public wallet address and connect a verified event feed." },
  },
  "crypto-aggregator": {
    productType: "branded crypto market aggregator",
    visualConcept: "A real market website with search, rankings, category filters, coin pages, charts and alert actions.",
    primaryLoop: "Search or browse → filter and rank assets → inspect a coin page → compare, save or create an alert.",
    modules: ["Global market header", "Search and filters", "Live rankings", "Coin drawer", "Watchlist"],
    screens: ["Market home", "Coin detail", "Categories", "Unlock calendar", "Watchlist"],
    interactions: ["Search coin", "Sort ranking", "Filter category", "Open research", "Favourite and alert"],
    dropsTabUse: ["Coin prices", "Rankings", "FDV and market cap", "Categories", "Unlock data"],
    dropsBotUse: ["Price alerts", "Watchlist delivery", "Coin tracking"],
    acceptanceChecks: ["Market table is searchable and sortable", "Coin detail opens without leaving the product", "Live versus snapshot data is labelled"],
    content: { headline: "Your market, your brand", subheadline: "A useful crypto explorer powered by DropsTab intelligence.", primaryAction: "Explore markets", emptyState: "Choose a market universe to populate your aggregator." },
  },
  "crypto-game": {
    productType: "playable crypto browser game",
    visualConcept: "A character-led animated game world where market data changes the level instead of appearing as dashboard cards.",
    primaryLoop: "Start a round → react to live market-driven objects → score → finish → replay or challenge a friend.",
    modules: ["Animated game scene", "Player character", "Market-driven objects", "Score and streak", "Daily challenge"],
    screens: ["Game start", "Playable round", "Round result", "Local challenge score"],
    interactions: ["Move character", "Catch or dodge objects", "Use power-up", "Finish round", "Replay and share"],
    dropsTabUse: ["Asset prices and momentum", "Market leaders", "Unlock-risk events", "Daily market snapshot"],
    dropsBotUse: ["Daily challenge reminder recipe", "Score share handoff", "Market-event challenge trigger"],
    acceptanceChecks: ["A complete round can be played and restarted", "The scene has characters and animation", "DropsTab data changes gameplay rather than only labels"],
    content: { headline: "Catch the market before it moves", subheadline: "A real arcade loop driven by crypto intelligence.", primaryAction: "Play now", emptyState: "Choose a game idea or describe your own world and mechanic." },
    game: {
      mechanic: "Catch rising assets and dodge unlock-risk objects before the round timer ends.",
      protagonist: "An original energetic market explorer character.",
      scene: "A lively illustrated crypto city with moving lanes, foreground props and a clear play area.",
      objective: "Build the highest score by reacting correctly to market-driven objects.",
      artDirection: "Expressive polished cartoon illustration with large readable characters and smooth motion.",
      dataUse: "DropsTab momentum controls object value and speed; Drops Bot schedules daily challenges.",
    },
  },
  "personal-companion": {
    productType: "personalized crypto discovery companion",
    visualConcept: "A calm recommendation feed with visible preference memory, explanations and related-topic trails.",
    primaryLoop: "Express interests → receive recommendations → ask why → save, dismiss or tune → improve the next feed.",
    modules: ["Taste profile", "Ranked market feed", "Why this", "Topic choices", "Memory controls"],
    screens: ["For-you feed", "Recommendation detail", "Taste profile", "Memory"],
    interactions: ["More like this", "Less like this", "Explain", "Follow topic", "Reset memory"],
    dropsTabUse: ["Available market universe", "Asset research links", "Current performance", "Optional connected categories"],
    dropsBotUse: ["Topic and coin alerts", "Personal Telegram delivery"],
    acceptanceChecks: ["Recommendations explain their source and reason", "Feedback visibly updates preference state", "User can inspect and reset memory"],
    content: { headline: "Crypto discovery that learns your taste", subheadline: "Explore related assets, themes and events with transparent reasons.", primaryAction: "Tune my feed", emptyState: "Choose three topics to start your personal crypto graph." },
  },
  "portfolio-tamagotchi": {
    productType: "portfolio care game",
    visualConcept: "A real illustrated creature habitat where portfolio health changes mood, environment and care tasks.",
    primaryLoop: "Enter portfolio weights → calculate health → inspect the formula → refresh market context → prepare an optional alert.",
    modules: ["Creature habitat", "Holdings editor", "Health formula", "Calculation history", "Alert setup"],
    screens: ["Habitat", "Health explanation", "Holdings input", "Local history"],
    interactions: ["Add holdings", "Calculate health", "Inspect allocation", "Refresh market data", "Prepare alert"],
    dropsTabUse: ["Current asset prices", "Current 24h movement", "Available asset universe", "Research handoff"],
    dropsBotUse: ["Health-alert recipe", "Large-move alert setup"],
    acceptanceChecks: ["Creature state comes from entered holdings and current data", "Every score component is visible", "No wallet connection or rebalance is implied"],
    content: { headline: "Keep your portfolio creature alive", subheadline: "Risk and diversification become a daily care loop.", primaryAction: "Check health", emptyState: "Enter holdings to hatch your portfolio creature." },
  },
  "crypto-product-hunt": {
    productType: "public crypto launch community",
    visualConcept: "A polished launch discovery community with persistent submissions, transparent browser-session votes and DropsTab research context.",
    primaryLoop: "Discover a launch → inspect its available context → vote or follow → submit a project → return to ranked feeds.",
    modules: ["Top launches", "Newest launches", "Project submission", "Browser-session voting", "DropsTab context"],
    screens: ["Launch feed", "Project detail", "Submit project", "Storage setup"],
    interactions: ["Search and filter", "Sort top or new", "Submit project", "Vote once per browser session", "Open research"],
    dropsTabUse: ["Project research links", "Available funding context", "Available investor context", "Token and market status"],
    dropsBotUse: ["Launch-follow alert recipe", "Telegram delivery handoff"],
    acceptanceChecks: ["Submissions persist only when the documented cloud backend is configured", "Vote receipts are labelled browser-session votes, not verified people", "Unreviewed listings and unavailable research fields are explicit"],
    content: { headline: "Discover and launch crypto products", subheadline: "A public community feed enriched with available DropsTab intelligence.", primaryAction: "Explore launches", emptyState: "No public launches yet. Submit the first project after storage is connected." },
  },
  "crypto-radio": {
    productType: "browser crypto audio briefing",
    visualConcept: "A real browser speech player with show art, queue, chapters, voice selection and a shareable rundown.",
    primaryLoop: "Build a rundown → listen with browser speech → skip or deepen a story → share the briefing.",
    modules: ["Browser player", "Rundown queue", "Story chapters", "Voice controls", "Share rundown"],
    screens: ["Audio player", "Rundown builder", "Source list", "Local archive"],
    interactions: ["Play and pause", "Play a chapter", "Open source", "Change topic", "Share rundown"],
    dropsTabUse: ["Market moves", "Unlocks", "Funding and activities", "Watchlist context"],
    dropsBotUse: ["Reminder recipe", "Breaking-move trigger", "Telegram handoff"],
    acceptanceChecks: ["Browser speech actually plays", "Queue and transport state work", "Every narrated story links to research context"],
    content: { headline: "Crypto intelligence you can listen to", subheadline: "A personal browser audio briefing built from DropsTab context.", primaryAction: "Play briefing", emptyState: "Add topics to build your first audio rundown." },
  },
  "crypto-siri": {
    productType: "voice-first crypto assistant",
    visualConcept: "A focused conversational assistant with a large voice surface, sourced answer cards and one-tap alert handoffs.",
    primaryLoop: "Ask a supported question → receive a snapshot answer → inspect DropsTab evidence → prepare a follow-up Drops Bot alert.",
    modules: ["Voice input", "Answer canvas", "Source cards", "Follow-up prompts", "Alert handoff"],
    screens: ["Ask", "Answer", "Research detail", "Alert confirmation"],
    interactions: ["Speak or type", "Ask supported follow-up", "Open source", "Prepare alert", "Hear answer"],
    dropsTabUse: ["Available coin context", "Market performance", "Optional unlock/activity endpoints", "Research links"],
    dropsBotUse: ["Natural-language alert recipe", "Telegram handoff"],
    acceptanceChecks: ["Text input always works when voice is unavailable", "Rule-based versus AI answers are labelled", "Alert setup requires confirmation in Drops Bot"],
    content: { headline: "Ask crypto. Get a sourced answer.", subheadline: "A personal voice companion built on DropsTab and Drops Bot.", primaryAction: "Ask Drops", emptyState: "Ask what moved, what unlocks next or what deserves an alert." },
  },
  "custom-product": {
    productType: "modular crypto web application",
    visualConcept: "A focused standalone product composed from safe local UI primitives, live DropsTab-compatible market context and explicit Drops Bot setup handoffs.",
    primaryLoop: "Open the workspace → inspect sourced market context → use the product-specific tool → save local progress → configure an optional Drops Bot alert.",
    modules: ["Market overview", "Product workspace", "Research context", "Saved state", "Alert setup"],
    screens: ["Overview", "Workspace", "Automation"],
    interactions: ["Navigate screens", "Refresh market data", "Filter and compare assets", "Save local work", "Open DropsTab research", "Configure Drops Bot"],
    dropsTabUse: ["Market prices and performance", "Asset research handoffs", "Optional unlock, funding and activity context"],
    dropsBotUse: ["Explicit alert recipe setup", "Telegram delivery handoff"],
    acceptanceChecks: ["Every screen is assembled from validated components", "Stateful interactions persist locally", "No model-authored executable code is accepted", "External actions require an explicit handoff"],
    content: { headline: "Your custom crypto product", subheadline: "A real modular app built around your workflow, DropsTab context and Drops Bot automation.", primaryAction: "Open workspace", emptyState: "Describe the workflow, audience and outcome you want to create." },
  },
};

function detectLocale(prompt: string): ProjectBlueprint["locale"] {
  return /[а-яё]/i.test(prompt) ? "ru" : prompt.trim() ? "en" : "auto";
}

function isRetroWolfPrompt(prompt: string): boolean {
  return /(?:волк|wolf)/i.test(prompt) && /(?:ссср|soviet|retro|совет|ну\s*,?\s*погоди)/i.test(prompt);
}

function customProductLabel(prompt: string): string {
  const cleaned = prompt
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Custom crypto workflow").slice(0, 100);
}

function customComponent(
  id: string,
  title: string,
  description: string,
  kind: ProjectCustomComponent["kind"],
  dataSource: ProjectCustomComponent["dataSource"],
  actions: ProjectCustomComponent["actions"],
  span: ProjectCustomComponent["span"] = "half",
): ProjectCustomComponent {
  return { id, title, description, kind, dataSource, actions, span };
}

/**
 * Deterministic blank-canvas foundation used when no curated recipe matches.
 * It is intentionally an IR, not generated source code: every node maps to a
 * compiler-owned component with a finite data and action vocabulary.
 */
export function createDefaultCustomGraph(prompt = ""): ProjectCustomGraph {
  const text = prompt.toLowerCase();
  const components: ProjectCustomComponent[] = [
    customComponent("market-pulse", "Market pulse", "Current prices and movement from the configured market adapter.", "metric-strip", "market", ["refresh", "open-dropstab"], "full"),
    customComponent("market-workspace", "Market workspace", "Searchable assets with local watch and comparison actions.", "market-table", "market", ["filter", "sort", "favorite", "compare", "open-dropstab"], "full"),
    customComponent("saved-watchlist", "Saved watchlist", "A local list that persists in this browser.", "watchlist", "local", ["favorite", "open-dropstab"], "half"),
    customComponent("research-stream", "Research stream", "Available unlock, funding and activity context; unavailable sources remain labelled.", "research-feed", /unlock|анлок|vesting|вестинг/i.test(text) ? "unlocks" : /fund|раунд|invest/i.test(text) ? "funding" : "activities", ["refresh", "open-dropstab"], "half"),
    customComponent("alert-workflow", "Alert workflow", "Prepare a reviewable coin or event alert and continue in Drops Bot.", "alert-builder", "market", ["configure-dropsbot"], "half"),
    customComponent("workspace-notes", "Workspace notes", "Keep product-specific notes locally without sending them to a provider.", "notes", "local", ["save-local"], "half"),
  ];

  if (/portfolio|treasury|казнач|портфел|runway|allocation/i.test(text)) {
    components.splice(2, 0, customComponent("portfolio-model", "Portfolio model", "Edit asset weights and inspect a transparent local allocation summary.", "portfolio", "market", ["save-local", "open-dropstab"], "full"));
  }
  if (/compare|comparison|сравн/i.test(text)) {
    components.splice(2, 0, customComponent("asset-comparison", "Asset comparison", "Compare selected assets against the same sourced market snapshot.", "comparison", "market", ["compare", "open-dropstab"], "full"));
  }
  if (/unlock|анлок|vesting|вестинг|event|событ/i.test(text)) {
    components.splice(3, 0, customComponent("event-timeline", "Event timeline", "Review available events without inventing dates or values.", "event-timeline", "unlocks", ["refresh", "configure-dropsbot"], "full"));
  }

  const componentIds = components.map((component) => component.id);
  const overviewIds = componentIds.filter((id) => ["market-pulse", "market-workspace", "portfolio-model", "asset-comparison"].includes(id));
  const researchIds = componentIds.filter((id) => ["saved-watchlist", "research-stream", "event-timeline", "workspace-notes"].includes(id));
  const automationIds = componentIds.filter((id) => ["alert-workflow", "workspace-notes", "saved-watchlist"].includes(id));

  return {
    version: 1,
    appKind: customProductLabel(prompt),
    initialScreenId: "overview",
    screens: [
      { id: "overview", title: "Overview", route: "/", layout: "grid", componentIds: overviewIds.length ? overviewIds : ["market-pulse", "market-workspace"] },
      { id: "research", title: "Research", route: "/research", layout: "feed", componentIds: researchIds.length ? researchIds : ["research-stream", "workspace-notes"] },
      { id: "automation", title: "Automation", route: "/automation", layout: "split", componentIds: automationIds.length ? automationIds : ["alert-workflow", "workspace-notes"] },
    ],
    modules: [
      { id: "market-intelligence", title: "Market intelligence", description: "DropsTab-compatible market and research context.", componentIds: componentIds.filter((id) => ["market-pulse", "market-workspace", "asset-comparison", "event-timeline", "research-stream"].includes(id)) },
      { id: "personal-workspace", title: "Personal workspace", description: "Browser-local inputs and saved state.", componentIds: componentIds.filter((id) => ["portfolio-model", "saved-watchlist", "workspace-notes"].includes(id)) },
      { id: "action-handoff", title: "Action handoff", description: "Consent-based Drops Bot automation setup.", componentIds: ["alert-workflow"] },
    ],
    components: components.slice(0, 18),
  };
}

export function createDefaultBlueprint(presetId: PresetId, prompt = ""): ProjectBlueprint {
  const seed = seeds[presetId];
  const blueprint: ProjectBlueprint = {
    ...seed,
    locale: detectLocale(prompt),
    modules: [...seed.modules],
    screens: [...seed.screens],
    interactions: [...seed.interactions],
    dropsTabUse: [...seed.dropsTabUse],
    dropsBotUse: [...seed.dropsBotUse],
    acceptanceChecks: [...seed.acceptanceChecks],
    content: { ...seed.content },
    ...(seed.game ? { game: { ...seed.game } } : {}),
  };

  if (presetId === "crypto-game" && isRetroWolfPrompt(prompt)) {
    blueprint.productType = "retro cartoon market catcher game";
    blueprint.visualConcept = "An original 1970s Eastern-European cel-animation game with a lanky grey market wolf, expressive poses, painted industrial scenery and large animated objects — never a dashboard and never a copy of an existing cartoon character.";
    blueprint.primaryLoop = "Move the wolf between four baskets → catch rising token eggs → dodge red unlock bombs → trigger a market power-up → finish the timed round → replay or share the score.";
    blueprint.modules = ["Retro game stage", "Wolf character", "Four catch lanes", "Market eggs and unlock bombs", "Score, lives and daily challenge"];
    blueprint.screens = ["Animated title screen", "Playable catcher round", "Round result", "Local challenge score"];
    blueprint.interactions = ["Move left and right", "Switch basket lanes", "Catch token eggs", "Dodge unlock bombs", "Restart and share"];
    blueprint.content = {
      headline: "Волк ловит рынок",
      subheadline: "Лови растущие токены, уворачивайся от анлоков и держи серию.",
      primaryAction: "Играть",
      emptyState: "Нажмите «Играть», чтобы запустить первый рыночный раунд.",
    };
    blueprint.game = {
      mechanic: "Four-lane catcher: the player moves a wolf with baskets to catch falling token eggs and avoid unlock bombs.",
      protagonist: "An original lanky grey market wolf in a mustard jacket and sneakers, expressive but visually distinct from any existing copyrighted character.",
      scene: "A hand-painted retro television factory rooftop with pipes, antennas, warm sunset clouds and four chutes feeding the playfield.",
      objective: "Score as many points as possible before the timer ends; green market leaders add streaks, red unlock bombs remove a life.",
      artDirection: "1970s Eastern-European cel animation, inked outlines, painted gouache backgrounds, tactile paper grain, broad readable silhouettes, lively squash-and-stretch motion.",
      dataUse: "DropsTab 24h momentum selects token values and fall speed; unlock-risk items become hazards; Drops Bot delivers the daily challenge and score alert recipe.",
    };
  }

  return blueprint;
}

export function applyAgentPlan(spec: GeneratedProjectSpec, plan: AgentProductPlan): GeneratedProjectSpec {
  const game = plan.blueprint.game;
  return {
    ...spec,
    presetId: plan.presetId,
    name: plan.name || spec.name,
    tagline: plan.tagline || spec.tagline,
    description: plan.description || spec.description,
    tools: plan.tools.length ? plan.tools : spec.tools,
    blueprint: plan.blueprint,
    brain: {
      provider: plan.provider ?? spec.brain.provider,
      model: plan.model ?? spec.brain.model,
      enhanced: Boolean(plan.provider && plan.provider !== "free") || spec.brain.enhanced,
    },
    theme: { ...spec.theme, ...plan.theme },
    design: { ...spec.design, ...plan.design },
    experience: {
      ...spec.experience,
      ...plan.experience,
      primaryLoop: plan.experience?.primaryLoop || plan.blueprint.primaryLoop,
      modules: plan.experience?.modules?.length ? plan.experience.modules : plan.blueprint.modules,
    },
    ...(plan.presetId === "custom-product" ? {
      customGraph: plan.customGraph ?? spec.customGraph ?? createDefaultCustomGraph(spec.prompt),
    } : {}),
    ...(plan.elementEdit ? {
      elements: {
        ...(spec.elements ?? {}),
        [plan.elementEdit.elementId]: {
          ...(spec.elements?.[plan.elementEdit.elementId] ?? {}),
          ...plan.elementEdit.config,
        },
      },
    } : {}),
    ...(spec.gameDirection || plan.presetId === "crypto-game" ? {
      gameDirection: {
        ...(spec.gameDirection ?? {
          genre: "catcher" as const,
          artStyle: "retro-cartoon" as const,
          world: "retro-factory" as const,
          mascot: "retro-wolf" as const,
          gameLoop: plan.blueprint.primaryLoop,
          mechanic: game?.mechanic ?? "Catch market objects and avoid risk hazards.",
          protagonist: game?.protagonist ?? "An original market character.",
          scene: game?.scene ?? plan.blueprint.visualConcept,
          objective: game?.objective ?? plan.blueprint.primaryLoop,
          artDirection: game?.artDirection ?? plan.blueprint.visualConcept,
          dataUse: game?.dataUse ?? plan.blueprint.dropsTabUse.join(" · "),
          difficulty: "normal" as const,
          roundSeconds: 30,
          sound: true,
          assetSource: "ai-generated" as const,
        }),
        ...plan.gameDirection,
        gameLoop: plan.gameDirection?.gameLoop || plan.blueprint.primaryLoop,
        mechanic: plan.gameDirection?.mechanic || game?.mechanic || spec.gameDirection?.mechanic || "Catch market objects and avoid risk hazards.",
        protagonist: plan.gameDirection?.protagonist || game?.protagonist || spec.gameDirection?.protagonist || "An original market character.",
        scene: plan.gameDirection?.scene || game?.scene || spec.gameDirection?.scene || plan.blueprint.visualConcept,
        objective: plan.gameDirection?.objective || game?.objective || spec.gameDirection?.objective || plan.blueprint.primaryLoop,
        artDirection: plan.gameDirection?.artDirection || game?.artDirection || spec.gameDirection?.artDirection || plan.blueprint.visualConcept,
        dataUse: plan.gameDirection?.dataUse || game?.dataUse || spec.gameDirection?.dataUse || plan.blueprint.dropsTabUse.join(" · "),
      },
    } : {}),
  };
}

export function presetFromPrompt(prompt: string): PresetId {
  return routeProductIntent(prompt).presetId;
}

function revisionInstruction(prompt: string): string {
  return prompt.match(/User change:\s*([\s\S]*?)\nSelected block:/i)?.[1]?.trim() || prompt.trim();
}

function revisionJson<T>(prompt: string, label: string, nextLabel: string): T | null {
  const expression = new RegExp(`${label}:\\s*([\\s\\S]*?)\\n${nextLabel}:`, "i");
  const raw = prompt.match(expression)?.[1]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function requestedSeconds(instruction: string): number | null {
  const match = instruction.match(/(\d{1,3})\s*(?:секунд(?:ы|у)?|seconds?|secs?|s\b)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(5, Math.min(120, Math.round(value))) : null;
}

export function fallbackAgentPlan(prompt: string, presetId = presetFromPrompt(prompt)): AgentProductPlan {
  const preset = getProjectPreset(presetId);
  const instruction = revisionInstruction(prompt);
  const currentProduct = revisionJson<{ name?: string; tagline?: string; description?: string; tools?: string[] }>(prompt, "Current product", "Current blueprint");
  const currentBlueprint = revisionJson<ProjectBlueprint>(prompt, "Current blueprint", "Current design");
  const hasSafeBlueprintArrays = currentBlueprint
    && Array.isArray(currentBlueprint.modules)
    && Array.isArray(currentBlueprint.screens)
    && Array.isArray(currentBlueprint.interactions)
    && Array.isArray(currentBlueprint.dropsTabUse)
    && Array.isArray(currentBlueprint.dropsBotUse)
    && Array.isArray(currentBlueprint.acceptanceChecks)
    && currentBlueprint.content
    && typeof currentBlueprint.content === "object";
  const blueprint = hasSafeBlueprintArrays
    ? { ...currentBlueprint, modules: [...currentBlueprint.modules], screens: [...currentBlueprint.screens], interactions: [...currentBlueprint.interactions], dropsTabUse: [...currentBlueprint.dropsTabUse], dropsBotUse: [...currentBlueprint.dropsBotUse], acceptanceChecks: [...currentBlueprint.acceptanceChecks], ...(currentBlueprint.revisionNotes ? { revisionNotes: [...currentBlueprint.revisionNotes] } : {}), content: { ...currentBlueprint.content }, ...(currentBlueprint.game ? { game: { ...currentBlueprint.game } } : {}) }
    : createDefaultBlueprint(preset.id, prompt);
  const revisionNotes = [...(blueprint.revisionNotes ?? [])];
  const hasWalletCapability = /wallet|кошел|smart money|кит|whale/i.test(instruction);
  const hasAlertRules = /alert|алерт|trigger|триггер|rule|правил/i.test(instruction);
  if ((preset.id === "alpha-channel" || preset.id === "morning-alpha") && hasWalletCapability) {
    blueprint.modules = prioritizeUnique(blueprint.modules, ["Wallet source tracker", "Editable alert rules"], 12, "Modules", revisionNotes);
    blueprint.screens = prioritizeUnique(blueprint.screens, ["Wallet source setup", "Alert rule editor"], 10, "Screens", revisionNotes);
    blueprint.interactions = prioritizeUnique(blueprint.interactions, ["Choose public or user-provided wallets", "Edit threshold and quiet hours"], 14, "Interactions", revisionNotes);
    blueprint.dropsBotUse = prioritizeUnique(blueprint.dropsBotUse, ["Public wallet move alerts", "Editable thresholds and Telegram channel delivery"], 10, "Drops Bot capabilities", revisionNotes);
    blueprint.acceptanceChecks = prioritizeUnique(blueprint.acceptanceChecks, ["Wallet tracking is configured as a source inside the Telegram workflow"], 10, "Acceptance checks", revisionNotes);
  } else if (hasAlertRules) {
    blueprint.modules = prioritizeUnique(blueprint.modules, ["Editable alert rules"], 12, "Modules", revisionNotes);
    blueprint.interactions = prioritizeUnique(blueprint.interactions, ["Edit trigger thresholds and delivery schedule"], 14, "Interactions", revisionNotes);
  }
  if (revisionNotes.length) blueprint.revisionNotes = Array.from(new Set(revisionNotes)).slice(-8);
  const retroWolf = preset.id === "crypto-game" && isRetroWolfPrompt(prompt);
  const seconds = requestedSeconds(instruction);
  const asksComic = /(?:comic|комикс)/i.test(instruction);
  const asksPixel = /(?:pixel|пиксел)/i.test(instruction);
  const asksNeon = /(?:neon|неон)/i.test(instruction);
  const asksAnimation = /(?:animat|анимац|motion|движен)/i.test(instruction);
  const asksLight = /(?:light theme|светл(?:ая|ую) тем)/i.test(instruction);
  const asksDark = /(?:dark theme|т[её]мн(?:ая|ую) тем)/i.test(instruction);
  const gameArtStyle: ProjectGameDirection["artStyle"] = asksComic ? "comic" : asksPixel ? "pixel" : asksNeon ? "neon" : retroWolf ? "retro-cartoon" : "3d-toy";
  if (preset.id === "crypto-game" && blueprint.game && (asksComic || asksPixel || asksNeon || asksAnimation)) {
    const requestedDirection = [
      asksComic ? "bold comic panels, halftone accents and kinetic inked impact shapes" : "",
      asksPixel ? "crisp pixel-art silhouettes and arcade particles" : "",
      asksNeon ? "neon arcade lighting and luminous market objects" : "",
      asksAnimation ? "stronger squash-and-stretch, trails and object anticipation" : "",
    ].filter(Boolean).join(", ");
    blueprint.game.artDirection = `${blueprint.game.artDirection} Requested revision: ${requestedDirection}.`;
    blueprint.visualConcept = `${blueprint.visualConcept} The revised runtime emphasizes ${requestedDirection}.`;
  }
  const theme: AgentProductPlan["theme"] = {
    ...(retroWolf ? { accent: "#ffcf4a", surface: "#16324a", mode: "dark" as const, style: "playful" as const } : {}),
    ...(asksLight ? { mode: "light" as const } : {}),
    ...(asksDark ? { mode: "dark" as const } : {}),
    ...((asksComic || asksPixel || asksNeon) ? { style: "playful" as const } : {}),
  };
  const design: AgentProductPlan["design"] = {
    ...(retroWolf ? { kit: "mascot-pop" as const, density: "cinematic" as const, motion: "expressive" as const, radius: 18, font: "space-grotesk" as const } : {}),
    ...(asksAnimation ? { motion: "expressive" as const } : {}),
    ...(asksNeon ? { kit: "neon-arena" as const } : {}),
  };
  return {
    presetId: preset.id,
    name: currentProduct?.name || (retroWolf ? "Волк ловит рынок" : preset.shortTitle),
    tagline: currentProduct?.tagline || (retroWolf ? "Ретро-аркада на живых данных DropsTab" : preset.tagline),
    description: currentProduct?.description || (prompt.trim() || preset.description),
    tools: currentProduct?.tools?.length ? [...currentProduct.tools] : [...preset.tools],
    blueprint,
    ...(Object.keys(theme).length ? { theme } : {}),
    ...(Object.keys(design).length ? { design } : {}),
    experience: createDefaultExperience(preset.id, blueprint),
    ...(preset.id === "custom-product" ? { customGraph: createDefaultCustomGraph(prompt) } : {}),
    ...(preset.id === "crypto-game" ? {
      gameDirection: { genre: "catcher", artStyle: gameArtStyle, world: retroWolf ? "retro-factory" : "cyber-arcade", mascot: retroWolf ? "retro-wolf" : "coin-crew", roundSeconds: seconds ?? 45, difficulty: "normal", sound: true, assetSource: "ai-generated", gameLoop: blueprint.primaryLoop, ...blueprint.game },
    } : {}),
    model: "Fallback product compiler",
    provider: "free",
  };
}
