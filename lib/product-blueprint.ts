import { presets, type PresetId } from "@/lib/presets";
import type { GeneratedProjectSpec, ProjectBlueprint, ProjectGameDirection } from "@/lib/project-types";

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
  gameDirection?: Partial<ProjectGameDirection>;
  model?: string;
  provider?: GeneratedProjectSpec["brain"]["provider"];
}

type BlueprintSeed = Omit<ProjectBlueprint, "locale" | "content"> & {
  content: ProjectBlueprint["content"];
};

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
    productType: "automated Telegram editorial channel",
    visualConcept: "A native Telegram channel experience with a sourced signal inbox, post composer and phone-sized live preview.",
    primaryLoop: "Discover a sourced signal → enrich it with DropsTab context → approve the post → deliver through Drops Bot → learn from engagement.",
    modules: ["Signal inbox", "Post composer", "Telegram preview", "Drops Bot recipe", "Growth and monetization"],
    screens: ["Signal inbox", "Composer", "Telegram channel", "Automation setup"],
    interactions: ["Filter signals", "Generate sourced post", "Edit voice", "Copy Drops Bot recipe", "Preview Telegram delivery"],
    dropsTabUse: ["Token pages", "Price and market-cap context", "Unlocks", "Funding and activities"],
    dropsBotUse: ["Wallet and coin alerts", "Channel delivery", "Caller links", "Telegram profiles"],
    acceptanceChecks: ["Preview visibly looks like Telegram", "Every post contains a DropsTab source handoff", "Drops Bot setup is a truthful guided recipe"],
    content: { headline: "Your alpha channel, already on air", subheadline: "Sourced crypto posts with a repeatable publishing loop.", primaryAction: "Generate first post", emptyState: "Choose a niche and sources to populate the signal inbox." },
  },
  "morning-alpha": {
    productType: "personal daily Telegram brief",
    visualConcept: "A bright, highly readable Telegram morning edition with clear sections and research links.",
    primaryLoop: "Refresh the watchlist → rank important changes → read a concise brief → open DropsTab evidence → create follow-up alerts.",
    modules: ["Morning cover", "Biggest moves", "Upcoming unlocks", "Funding and activity", "Action list"],
    screens: ["Telegram brief", "Watchlist setup", "Schedule", "Archive"],
    interactions: ["Choose assets", "Change schedule", "Refresh brief", "Open DropsTab", "Create Drops Bot alert"],
    dropsTabUse: ["Prices and performance", "Unlock calendar", "Funding rounds", "Project activity"],
    dropsBotUse: ["Scheduled Telegram delivery", "Follow-up alerts", "Coin tracking"],
    acceptanceChecks: ["Brief is readable at phone size", "Sections react to the chosen watchlist", "Sources and alert actions are visible"],
    content: { headline: "Morning Alpha", subheadline: "Wake up to decisions, not noise.", primaryAction: "Build today’s brief", emptyState: "Add five to ten assets to create a useful morning edition." },
  },
  "prediction-impact": {
    productType: "prediction-market impact terminal",
    visualConcept: "An event-first impact map connecting odds, token baskets, historical sensitivity and reversible actions.",
    primaryLoop: "Watch an odds move → map related assets → inspect historical reactions → create a trade, hedge or reversal alert plan.",
    modules: ["Event monitor", "Impact map", "Related basket", "Historical sensitivity", "Action planner"],
    screens: ["Event terminal", "Impact graph", "Basket detail", "Alert setup"],
    interactions: ["Track event", "Change odds trigger", "Inspect token relationship", "Build basket", "Set reversal alert"],
    dropsTabUse: ["Related tokens and categories", "Historical performance", "Market cap and liquidity", "Public portfolios"],
    dropsBotUse: ["Polymarket event tracking", "Odds and volume alerts", "Telegram delivery"],
    acceptanceChecks: ["Event-to-token relationship is visible", "Historical context is separated from prediction", "Actions remain handoffs or plans"],
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
    content: { headline: "Copy the rule, not the hype", subheadline: "Wallet intelligence with context, sizing and an audit trail.", primaryAction: "Run paper copy", emptyState: "Add a public wallet or choose a verified sample strategy." },
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
    screens: ["Game start", "Playable round", "Round result", "Leaderboard"],
    interactions: ["Move character", "Catch or dodge objects", "Use power-up", "Finish round", "Replay and share"],
    dropsTabUse: ["Asset prices and momentum", "Market leaders", "Unlock-risk events", "Daily market snapshot"],
    dropsBotUse: ["Daily challenge reminder", "Score and event delivery", "Market-event challenge trigger"],
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
    modules: ["Taste profile", "Discovery feed", "Why this", "Topic graph", "Memory controls"],
    screens: ["For-you feed", "Recommendation detail", "Taste profile", "Memory"],
    interactions: ["More like this", "Less like this", "Explain", "Follow topic", "Reset memory"],
    dropsTabUse: ["Categories and related assets", "Project activities", "Funding and unlock context", "Market performance"],
    dropsBotUse: ["Topic and coin alerts", "Personal Telegram delivery"],
    acceptanceChecks: ["Recommendations explain their source and reason", "Feedback visibly updates preference state", "User can inspect and reset memory"],
    content: { headline: "Crypto discovery that learns your taste", subheadline: "Explore related assets, themes and events with transparent reasons.", primaryAction: "Tune my feed", emptyState: "Choose three topics to start your personal crypto graph." },
  },
  "portfolio-tamagotchi": {
    productType: "portfolio care game",
    visualConcept: "A real illustrated creature habitat where portfolio health changes mood, environment and care tasks.",
    primaryLoop: "Check the creature → understand a health signal → perform a safe care action → watch state change → return daily.",
    modules: ["Creature habitat", "Health signals", "Care actions", "Daily streak", "Alert diary"],
    screens: ["Habitat", "Health explanation", "Care task", "History"],
    interactions: ["Feed", "Calm", "Rebalance plan", "Inspect signal", "Share creature"],
    dropsTabUse: ["Portfolio prices", "Volatility", "Diversification", "Unlock exposure"],
    dropsBotUse: ["Health alerts", "Daily check-in", "Large-move delivery"],
    acceptanceChecks: ["Creature state changes and persists", "Every mood has an explainable portfolio reason", "Care actions never pretend to trade"],
    content: { headline: "Keep your portfolio creature alive", subheadline: "Risk and diversification become a daily care loop.", primaryAction: "Check health", emptyState: "Connect or enter holdings to hatch your portfolio creature." },
  },
  "crypto-product-hunt": {
    productType: "community crypto launch board",
    visualConcept: "A polished discovery marketplace with launch cards, categories, voting, submissions and DropsTab research context.",
    primaryLoop: "Discover a launch → inspect team, funding and token context → vote or follow → submit the next product.",
    modules: ["Launch feed", "Category filters", "Project page", "Voting", "Submission and moderation"],
    screens: ["Launch feed", "Project detail", "Submit", "Moderation queue"],
    interactions: ["Search", "Filter", "Vote", "Follow launch", "Submit product"],
    dropsTabUse: ["Project search", "Funding rounds", "Investors", "Token and market status"],
    dropsBotUse: ["Launch follow alerts", "Community Telegram delivery"],
    acceptanceChecks: ["Votes and local submissions persist", "Project cards expose research context", "Moderation state is visible"],
    content: { headline: "Discover crypto products before they trend", subheadline: "Community launches enriched with real market intelligence.", primaryAction: "Explore launches", emptyState: "No launches match this filter. Submit the first one." },
  },
  "crypto-radio": {
    productType: "AI crypto radio station",
    visualConcept: "A real audio player with show art, queue, chapters, voice selection and scheduled broadcasts.",
    primaryLoop: "Build a rundown → listen → skip or deepen a story → schedule the next episode → share the station.",
    modules: ["Now playing", "Rundown queue", "Story chapters", "Voice and schedule", "Share station"],
    screens: ["Live player", "Episode builder", "Schedule", "Archive"],
    interactions: ["Play and pause", "Skip chapter", "Open source", "Change voice", "Schedule show"],
    dropsTabUse: ["Market moves", "Unlocks", "Funding and activities", "Watchlist context"],
    dropsBotUse: ["Broadcast reminders", "Breaking-news trigger", "Telegram episode delivery"],
    acceptanceChecks: ["Browser speech actually plays", "Queue and transport state work", "Every narrated story links to research context"],
    content: { headline: "Crypto intelligence you can listen to", subheadline: "A personal market station built from DropsTab context.", primaryAction: "Start broadcast", emptyState: "Add topics to build your first radio rundown." },
  },
  "crypto-siri": {
    productType: "voice-first crypto assistant",
    visualConcept: "A focused conversational assistant with a large voice surface, sourced answer cards and one-tap alert handoffs.",
    primaryLoop: "Ask a question → receive a sourced answer → inspect DropsTab evidence → create a follow-up Drops Bot alert.",
    modules: ["Voice input", "Answer canvas", "Source cards", "Follow-up prompts", "Alert handoff"],
    screens: ["Ask", "Answer", "Research detail", "Alert confirmation"],
    interactions: ["Speak or type", "Ask follow-up", "Open source", "Create alert", "Save question"],
    dropsTabUse: ["Portfolio and coin context", "Market performance", "Unlocks and activities", "Research links"],
    dropsBotUse: ["Natural-language alert handoff", "Telegram delivery"],
    acceptanceChecks: ["Text input always works when voice is unavailable", "Answers show their data source", "Alert creation requires confirmation"],
    content: { headline: "Ask crypto. Get a sourced answer.", subheadline: "A personal voice companion built on DropsTab and Drops Bot.", primaryAction: "Ask Drops", emptyState: "Ask what moved, what unlocks next or what deserves an alert." },
  },
};

function detectLocale(prompt: string): ProjectBlueprint["locale"] {
  return /[а-яё]/i.test(prompt) ? "ru" : prompt.trim() ? "en" : "auto";
}

function isRetroWolfPrompt(prompt: string): boolean {
  return /(?:волк|wolf)/i.test(prompt) && /(?:ссср|soviet|retro|совет|ну\s*,?\s*погоди)/i.test(prompt);
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
    blueprint.screens = ["Animated title screen", "Playable catcher round", "Round result", "Daily leaderboard"];
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
  const text = prompt.toLowerCase();
  if (/game|игр|arcade|аркад|wolf|волк|tetris|тетрис/.test(text)) return "crypto-game";
  if (/radio|радио|podcast|audio|аудио/.test(text)) return "crypto-radio";
  if (/siri|voice|голос|ассистент/.test(text)) return "crypto-siri";
  if (/tamagotchi|тамагочи|pet|питом/.test(text)) return "portfolio-tamagotchi";
  if (/product hunt|launch board|каталог|запуск/.test(text)) return "crypto-product-hunt";
  if (/aggregator|агрегатор|coinmarketcap|coingecko|market cap/.test(text)) return "crypto-aggregator";
  if (/prediction|polymarket|ставк|odds|вероятност/.test(text)) return "prediction-impact";
  if (/copy|копи|wallet|кошел|smart money/.test(text)) return "smart-money-copy";
  if (/channel|канал|alpha feed|сигнал/.test(text)) return "alpha-channel";
  if (/morning|утрен|brief|дайджест/.test(text)) return "morning-alpha";
  if (/recommend|персонал|companion|лента/.test(text)) return "personal-companion";
  return "action-engine";
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
  const preset = presets.find((item) => item.id === presetId) ?? presets[0];
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
    ? { ...currentBlueprint, modules: [...currentBlueprint.modules], screens: [...currentBlueprint.screens], interactions: [...currentBlueprint.interactions], dropsTabUse: [...currentBlueprint.dropsTabUse], dropsBotUse: [...currentBlueprint.dropsBotUse], acceptanceChecks: [...currentBlueprint.acceptanceChecks], content: { ...currentBlueprint.content }, ...(currentBlueprint.game ? { game: { ...currentBlueprint.game } } : {}) }
    : createDefaultBlueprint(preset.id, prompt);
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
    ...(preset.id === "crypto-game" ? {
      experience: { archetype: "game-world", layout: "spatial", dataView: "graph", engagement: "social", audience: "Casual crypto players", primaryLoop: blueprint.primaryLoop, modules: blueprint.modules, assetSource: "ai-generated" },
      gameDirection: { genre: "catcher", artStyle: gameArtStyle, world: retroWolf ? "retro-factory" : "cyber-arcade", mascot: retroWolf ? "retro-wolf" : "coin-crew", roundSeconds: seconds ?? 45, difficulty: "normal", sound: true, assetSource: "ai-generated", gameLoop: blueprint.primaryLoop, ...blueprint.game },
    } : {}),
    model: "Fallback product compiler",
    provider: "free",
  };
}
