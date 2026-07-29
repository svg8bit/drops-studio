export type PresetId =
  | "action-engine"
  | "alpha-channel"
  | "morning-alpha"
  | "prediction-impact"
  | "smart-money-copy"
  | "crypto-aggregator"
  | "crypto-game"
  | "personal-companion"
  | "portfolio-tamagotchi"
  | "crypto-product-hunt"
  | "crypto-radio"
  | "crypto-siri";

export type PreviewKind =
  | "engine"
  | "channel"
  | "brief"
  | "prediction"
  | "copy"
  | "aggregator"
  | "game"
  | "companion"
  | "tamagotchi"
  | "hunt"
  | "radio"
  | "siri";

export interface PresetField {
  id: string;
  label: string;
  value: string;
  options: string[];
}

export interface Preset {
  id: PresetId;
  title: string;
  shortTitle: string;
  tagline: string;
  description: string;
  category: string;
  badge?: string;
  icon: string;
  accent: string;
  tint: string;
  cta: string;
  output: string;
  eta: string;
  preview: PreviewKind;
  fields: PresetField[];
  tools: string[];
  actions: string[];
}

export const presets: Preset[] = [
  {
    id: "action-engine",
    title: "Intelligence-to-Action Engine",
    shortTitle: "Action Engine",
    tagline: "Turn a thesis into a live decision system",
    description:
      "DropsTab explains why an asset may move. Drops Bot catches when it happens. Your engine decides what comes next.",
    category: "Flagship",
    badge: "CORE",
    icon: "Zap",
    accent: "#316cff",
    tint: "#eaf1ff",
    cta: "Build my action engine",
    output: "Decision engine",
    eta: "4 min",
    preview: "engine",
    fields: [
      { id: "signal", label: "WHY", value: "Unlock + catalyst", options: ["Unlock + catalyst", "Funding + investor", "Market anomaly", "Custom thesis"] },
      { id: "trigger", label: "WHEN", value: "Whale move confirms", options: ["Whale move confirms", "Price breaks out", "Funding flips", "Polymarket moves"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
      { id: "action", label: "ACTION", value: "Alert + trade plan", options: ["Alert + trade plan", "Buy token", "Build basket", "Hedge + monitor"] },
    ],
    tools: ["DropsTab market context", "Drops Bot triggers", "AI explanation", "Action rules"],
    actions: ["BUY", "HEDGE", "WAIT", "REVERSAL ALERT"],
  },
  {
    id: "alpha-channel",
    title: "Alpha Channel Money Machine",
    shortTitle: "Alpha Channel",
    tagline: "Build and connect a sourced Telegram alpha feed",
    description:
      "Pick a niche, sources and voice, compose sourced posts, preview the exact Telegram layout and verify delivery to an existing channel.",
    category: "Creator",
    badge: "REVENUE",
    icon: "Megaphone",
    accent: "#7c4dff",
    tint: "#f2edff",
    cta: "Build my channel setup",
    output: "Telegram publishing setup",
    eta: "5 min",
    preview: "channel",
    fields: [
      { id: "niche", label: "NICHE", value: "Solana smart money", options: ["Solana smart money", "AI tokens", "Token launches", "Polymarket alpha"] },
      { id: "sources", label: "SOURCES", value: "Wallets + swaps", options: ["Wallets + swaps", "Catalysts + prices", "Funding + unlocks", "Everything curated"] },
      { id: "voice", label: "VOICE", value: "Sharp & sourced", options: ["Sharp & sourced", "Degen but honest", "Institutional", "My custom prompt"] },
      { id: "earn", label: "GOAL", value: "Free growth", options: ["Free growth", "Caller-link plan", "Paid-channel plan", "Sponsor-slot plan"] },
    ],
    tools: ["Drops Bot setup recipe", "DropsTab context", "Telegram post composer", "Verified bot delivery"],
    actions: ["COMPOSE", "VERIFY CHANNEL", "SEND TEST", "SHARE PREVIEW"],
  },
  {
    id: "morning-alpha",
    title: "AI Morning Alpha",
    shortTitle: "Morning Alpha",
    tagline: "Wake up to decisions, not noise",
    description:
      "A personal daily brief with market moves, catalysts, unlocks, funding and a concise action list for your watchlist.",
    category: "Daily",
    badge: "POPULAR",
    icon: "Sun",
    accent: "#2f6df6",
    tint: "#edf4ff",
    cta: "Build my morning brief",
    output: "Telegram brief",
    eta: "3 min",
    preview: "brief",
    fields: [
      { id: "assets", label: "TRACK", value: "BTC, ETH, SOL", options: ["BTC, ETH, SOL", "My portfolio", "Top 20", "Custom watchlist"] },
      { id: "time", label: "DELIVER", value: "08:00 UTC", options: ["07:00 UTC", "08:00 UTC", "09:00 UTC", "After I wake up"] },
      { id: "sections", label: "INCLUDE", value: "Moves + unlocks + funding", options: ["Moves + unlocks + funding", "Only actionable", "Full market map", "My custom sections"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
    ],
    tools: ["DropsTab coins", "Unlock schedules", "Funding rounds", "Telegram delivery"],
    actions: ["OPEN IN DROPSTAB", "SET ALERT", "ADD TO WATCHLIST"],
  },
  {
    id: "prediction-impact",
    title: "Prediction-to-Crypto Impact Trader",
    shortTitle: "Prediction Impact",
    tagline: "See what an odds move means for crypto",
    description:
      "Map Polymarket probability shifts to a transparent research basket, current market reactions and a reviewable trade or hedge plan.",
    category: "Trader",
    badge: "LIVE",
    icon: "ChartNoAxesCombined",
    accent: "#0f9f76",
    tint: "#e9faf4",
    cta: "Build my impact trader",
    output: "Impact terminal",
    eta: "5 min",
    preview: "prediction",
    fields: [
      { id: "event", label: "EVENT", value: "SOL ETF approval", options: ["SOL ETF approval", "Fed rate decision", "US crypto bill", "Paste Polymarket URL"] },
      { id: "trigger", label: "TRIGGER", value: "+15¢ probability", options: ["+15¢ probability", "Odds cross 60%", "$100K whale bet", "Volume doubles"] },
      { id: "impact", label: "MAP", value: "Tokens + category", options: ["Tokens + category", "Only majors", "Full ecosystem", "My basket"] },
      { id: "action", label: "ACTION", value: "Trade + hedge", options: ["Trade + hedge", "Alert only", "Build basket", "Reversal strategy"] },
    ],
    tools: ["Polymarket event feed", "DropsTab market context", "Heuristic asset map", "Action planner"],
    actions: ["OPEN MARKET", "RESEARCH BASKET", "SET REVERSAL"],
  },
  {
    id: "smart-money-copy",
    title: "Smart Money Copy Strategy",
    shortTitle: "Smart Money Copy",
    tagline: "Copy the rule, not the hype",
    description:
      "Add public wallet addresses, define market-context confirmation and turn verified alerts into a capped, explainable paper strategy.",
    category: "Trader",
    badge: "PRO",
    icon: "UsersRound",
    accent: "#ff6b35",
    tint: "#fff1eb",
    cta: "Build my copy strategy",
    output: "Strategy monitor",
    eta: "5 min",
    preview: "copy",
    fields: [
      { id: "wallets", label: "FOLLOW", value: "Add addresses", options: ["Add addresses", "Polymarket addresses", "Hyperliquid addresses", "My public list"] },
      { id: "confirm", label: "CONFIRM", value: "Volume + price", options: ["Volume + price", "No confirmation", "Unlock risk check", "AI score > 75"] },
      { id: "size", label: "MAX SIZE", value: "2% per position", options: ["1% per position", "2% per position", "5% per position", "Alert only"] },
      { id: "execute", label: "MODE", value: "Paper trade", options: ["Paper trade", "Telegram alert", "Approval plan", "Research only"] },
    ],
    tools: ["Drops Bot wallet-alert recipe", "DropsTab token context", "Local risk rules", "Paper ledger"],
    actions: ["PAPER SCENARIO", "SKIP", "CONFIGURE ALERT", "MUTE WALLET"],
  },
  {
    id: "crypto-aggregator",
    title: "Create Your Crypto Aggregator",
    shortTitle: "Crypto Aggregator",
    tagline: "Your own CoinMarketCap in minutes",
    description:
      "Create a branded market explorer powered by DropsTab prices, rankings, FDV, categories, history and unlock data.",
    category: "Builder",
    badge: "NO-CODE",
    icon: "TableProperties",
    accent: "#1d7cf2",
    tint: "#eaf5ff",
    cta: "Build my aggregator",
    output: "Live website",
    eta: "4 min",
    preview: "aggregator",
    fields: [
      { id: "universe", label: "UNIVERSE", value: "Top 100 coins", options: ["Top 100 coins", "Solana ecosystem", "AI tokens", "My custom list"] },
      { id: "ranking", label: "RANK BY", value: "Market cap", options: ["Market cap", "24h movers", "Volume", "FDV gap"] },
      { id: "modules", label: "MODULES", value: "Markets + unlocks", options: ["Markets + unlocks", "Markets only", "Funding + investors", "Full research"] },
      { id: "publish", label: "PUBLISH", value: "Public live page", options: ["Public live page", "Private dashboard", "Embeddable widget", "Telegram mini app"] },
    ],
    tools: ["DropsTab coins API", "Historical charts", "Unlock data", "Search + filters"],
    actions: ["VIEW COIN", "COMPARE", "ADD ALERT", "SHARE"],
  },
  {
    id: "crypto-game",
    title: "Build Your Crypto Game",
    shortTitle: "Crypto Game",
    tagline: "Make live markets playable",
    description:
      "Turn real DropsTab market data into a prediction, portfolio or arcade game with daily challenges and shareable scores.",
    category: "Viral",
    badge: "FUN",
    icon: "Gamepad2",
    accent: "#ee4f9b",
    tint: "#fff0f7",
    cta: "Build my crypto game",
    output: "Playable web game",
    eta: "5 min",
    preview: "game",
    fields: [
      { id: "game", label: "GAME", value: "Beat the Market", options: ["Beat the Market", "Guess the Coin", "Portfolio Battle", "Unlock Dodge"] },
      { id: "assets", label: "ASSETS", value: "Top 20", options: ["Top 20", "Memecoins", "Solana only", "My watchlist"] },
      { id: "round", label: "ROUND", value: "24 hours", options: ["5 minutes", "1 hour", "24 hours", "7 days"] },
      { id: "social", label: "SOCIAL", value: "Leaderboard + share", options: ["Leaderboard + share", "Private challenge", "Telegram group", "No leaderboard"] },
    ],
    tools: ["DropsTab market data", "Live price history", "Local game engine", "Share cards"],
    actions: ["PLAY", "CHALLENGE", "SHARE SCORE", "REMATCH"],
  },
  {
    id: "personal-companion",
    title: "Create Your Personal Crypto Companion",
    shortTitle: "Crypto Companion",
    tagline: "A feed that learns what you care about",
    description:
      "A local-first discovery stream that reorders the current market universe from your explicit likes, dismissals and saved topics.",
    category: "Personal",
    badge: "AI",
    icon: "Sparkles",
    accent: "#6f5df6",
    tint: "#f1efff",
    cta: "Create my companion",
    output: "Personal AI feed",
    eta: "4 min",
    preview: "companion",
    fields: [
      { id: "profile", label: "PROFILE", value: "Balanced explorer", options: ["Balanced explorer", "Degen scout", "Long-term investor", "Research analyst"] },
      { id: "learn", label: "LEARN FROM", value: "Manual topics", options: ["Manual topics", "Local likes + clicks", "Imported watchlist", "Connected data"] },
      { id: "discover", label: "DISCOVER", value: "Related themes", options: ["Related themes", "Hidden gems", "Safer alternatives", "Upcoming catalysts"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
    ],
    tools: ["DropsTab market universe", "Local preference memory", "Explainable ranking", "Optional connected AI"],
    actions: ["MORE LIKE THIS", "LESS LIKE THIS", "EXPLAIN", "TRACK"],
  },
  {
    id: "portfolio-tamagotchi",
    title: "Build Your Portfolio Tamagotchi",
    shortTitle: "Portfolio Tamagotchi",
    tagline: "Keep your portfolio creature alive",
    description:
      "Enter portfolio weights and get a living character whose explainable mood reflects diversification, concentration and current market movement.",
    category: "Viral",
    badge: "MEME",
    icon: "HeartPulse",
    accent: "#15a67a",
    tint: "#ebfbf5",
    cta: "Hatch my portfolio",
    output: "Interactive companion",
    eta: "3 min",
    preview: "tamagotchi",
    fields: [
      { id: "portfolio", label: "PORTFOLIO", value: "Enter holdings", options: ["Enter holdings", "Import CSV later", "Connect wallet later", "DropsTab watchlist later"] },
      { id: "personality", label: "PERSONALITY", value: "Calm quant", options: ["Calm quant", "Degen goblin", "Diamond hands", "Risk therapist"] },
      { id: "health", label: "HEALTH", value: "Movement + diversification", options: ["Movement + diversification", "Diversification", "Concentration", "Connected risk data"] },
      { id: "care", label: "CHECK-IN", value: "Daily", options: ["Morning", "Daily", "On big moves", "When it gets sick"] },
    ],
    tools: ["DropsTab market prices", "Explainable health formula", "Local state", "Drops Bot alert recipe"],
    actions: ["ADD HOLDINGS", "CALCULATE", "ALERT SETUP", "SHARE PET"],
  },
  {
    id: "crypto-product-hunt",
    title: "Build Your Crypto Product Hunt",
    shortTitle: "Crypto Product Hunt",
    tagline: "Research and organize crypto launches",
    description:
      "A private launch research board with local drafts, search and saves, ready for DropsTab context and an optional community backend.",
    category: "Community",
    badge: "DISCOVER",
    icon: "Rocket",
    accent: "#f05a35",
    tint: "#fff1ec",
    cta: "Build my launch board",
    output: "Private launch board",
    eta: "5 min",
    preview: "hunt",
    fields: [
      { id: "scope", label: "SCOPE", value: "New crypto products", options: ["New crypto products", "Pre-TGE projects", "Telegram apps", "AI x crypto"] },
      { id: "rank", label: "ORGANIZE", value: "Local saves", options: ["Local saves", "Funding after connection", "Market performance", "Manual priority"] },
      { id: "context", label: "CONTEXT", value: "Market links", options: ["Market links", "Funding after connection", "Token status", "Custom notes"] },
      { id: "submit", label: "SUBMISSIONS", value: "Private drafts", options: ["Private drafts", "Team backend later", "Invite-only later", "Public backend later"] },
    ],
    tools: ["DropsTab research links", "Local submissions", "Local saves", "Optional auth + database"],
    actions: ["SAVE LOCALLY", "OPEN RESEARCH", "ADD DRAFT", "SEARCH"],
  },
  {
    id: "crypto-radio",
    title: "Build Your Crypto Radio",
    shortTitle: "Crypto Radio",
    tagline: "Turn market intelligence into audio",
    description:
      "A browser audio briefing that narrates the current market snapshot and only adds unlock, funding or AI stories after those sources are connected.",
    category: "Media",
    badge: "AUDIO",
    icon: "Radio",
    accent: "#e6427a",
    tint: "#fff0f5",
    cta: "Build my audio brief",
    output: "Browser audio briefing",
    eta: "4 min",
    preview: "radio",
    fields: [
      { id: "show", label: "SHOW", value: "Market in 5", options: ["Market in 5", "My watchlist", "Launch research", "Degen drive time"] },
      { id: "source", label: "SOURCE", value: "Top moves + catalysts", options: ["Top moves + catalysts", "My watchlist", "Funding + unlocks", "Custom rundown"] },
      { id: "voice", label: "VOICE", value: "Calm analyst", options: ["Calm analyst", "Fast trader", "Friendly companion", "System voice"] },
      { id: "air", label: "PLAY", value: "Play now", options: ["Play now", "Reminder setup", "Export rundown", "Telegram handoff"] },
    ],
    tools: ["DropsTab market adapter", "Browser speech", "Local queue", "Optional AI script"],
    actions: ["PLAY", "PAUSE", "SKIP STORY", "SHARE SHOW"],
  },
  {
    id: "crypto-siri",
    title: "Build Your Crypto Siri",
    shortTitle: "Crypto Siri",
    tagline: "Ask the market, out loud",
    description:
      "A voice-first crypto assistant that answers supported market questions from the current data and prepares Drops Bot alert recipes for confirmation.",
    category: "Assistant",
    badge: "VOICE",
    icon: "AudioLines",
    accent: "#4477f2",
    tint: "#edf2ff",
    cta: "Build my crypto Siri",
    output: "Voice assistant",
    eta: "4 min",
    preview: "siri",
    fields: [
      { id: "language", label: "LANGUAGE", value: "English + Russian", options: ["English + Russian", "English", "Russian", "Auto detect"] },
      { id: "answer", label: "ANSWER", value: "Short + actionable", options: ["Short + actionable", "Deep research", "Voice only", "Voice + cards"] },
      { id: "commands", label: "COMMANDS", value: "Ask + prepare alerts", options: ["Ask + prepare alerts", "Research only", "Portfolio after input", "Full Action Engine plan"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
    ],
    tools: ["DropsTab search", "Market context", "Web Speech API", "Drops Bot deep links"],
    actions: ["ASK", "LISTEN", "PREPARE ALERT", "OPEN DROPSTAB"],
  },
];

export const defaultPresetId: PresetId = "morning-alpha";
