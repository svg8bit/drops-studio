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
    tagline: "Launch a sourced Telegram alpha feed",
    description:
      "Pick a niche, sources and voice. Publish contextual signals automatically and monetize with Drops Bot Caller links.",
    category: "Creator",
    badge: "REVENUE",
    icon: "Megaphone",
    accent: "#7c4dff",
    tint: "#f2edff",
    cta: "Launch my alpha channel",
    output: "Telegram channel",
    eta: "5 min",
    preview: "channel",
    fields: [
      { id: "niche", label: "NICHE", value: "Solana smart money", options: ["Solana smart money", "AI tokens", "Token launches", "Polymarket alpha"] },
      { id: "sources", label: "SOURCES", value: "Wallets + swaps", options: ["Wallets + swaps", "Catalysts + prices", "Funding + unlocks", "Everything curated"] },
      { id: "voice", label: "VOICE", value: "Sharp & sourced", options: ["Sharp & sourced", "Degen but honest", "Institutional", "My custom prompt"] },
      { id: "earn", label: "EARN", value: "Caller links", options: ["Caller links", "Paid channel", "Free growth", "Sponsor slots"] },
    ],
    tools: ["Drops Bot profiles", "Caller Mode", "DropsTab context", "Telegram publishing"],
    actions: ["PUBLISH", "TRACK", "BUY IN DROPS", "SHARE"],
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
      "Map Polymarket probability shifts to related assets, historical reactions and a trade or hedge plan.",
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
    tools: ["Drops Bot Polymarket", "DropsTab categories", "Price history", "Action planner"],
    actions: ["TRADE MARKET", "BUY BASKET", "SET REVERSAL"],
  },
  {
    id: "smart-money-copy",
    title: "Smart Money Copy Strategy",
    shortTitle: "Smart Money Copy",
    tagline: "Copy the rule, not the hype",
    description:
      "Choose public wallets, add market-context confirmation and turn their moves into a capped, explainable strategy.",
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
      { id: "wallets", label: "FOLLOW", value: "3 verified wallets", options: ["3 verified wallets", "Polymarket leaders", "Hyperliquid traders", "Add addresses"] },
      { id: "confirm", label: "CONFIRM", value: "Volume + price", options: ["Volume + price", "No confirmation", "Unlock risk check", "AI score > 75"] },
      { id: "size", label: "MAX SIZE", value: "2% per position", options: ["1% per position", "2% per position", "5% per position", "Alert only"] },
      { id: "execute", label: "MODE", value: "One-tap approve", options: ["One-tap approve", "Paper trade", "Auto with limits", "Telegram alert"] },
    ],
    tools: ["Drops Bot wallet webhooks", "DropsTab token context", "Risk rules", "Solana trading"],
    actions: ["COPY", "SKIP", "PAPER TRADE", "MUTE WALLET"],
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
      "A personalized discovery stream that recommends related assets, events and research from your behavior and portfolio.",
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
      { id: "learn", label: "LEARN FROM", value: "Watchlist + clicks", options: ["Watchlist + clicks", "Portfolio", "Manual topics", "Everything"] },
      { id: "discover", label: "DISCOVER", value: "Related themes", options: ["Related themes", "Hidden gems", "Safer alternatives", "Upcoming catalysts"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
    ],
    tools: ["DropsTab categories", "Crypto activities", "Preference memory", "AI recommendations"],
    actions: ["MORE LIKE THIS", "LESS LIKE THIS", "EXPLAIN", "TRACK"],
  },
  {
    id: "portfolio-tamagotchi",
    title: "Build Your Portfolio Tamagotchi",
    shortTitle: "Portfolio Tamagotchi",
    tagline: "Keep your portfolio creature alive",
    description:
      "Your portfolio becomes a living character whose mood reflects diversification, volatility, unlock risk and market health.",
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
      { id: "portfolio", label: "PORTFOLIO", value: "Connect wallet", options: ["Connect wallet", "Enter holdings", "Demo portfolio", "DropsTab watchlist"] },
      { id: "personality", label: "PERSONALITY", value: "Calm quant", options: ["Calm quant", "Degen goblin", "Diamond hands", "Risk therapist"] },
      { id: "health", label: "HEALTH", value: "Risk + diversification", options: ["Risk + diversification", "Performance", "Unlock exposure", "All signals"] },
      { id: "care", label: "CHECK-IN", value: "Daily", options: ["Morning", "Daily", "On big moves", "When it gets sick"] },
    ],
    tools: ["DropsTab portfolio prices", "Unlock exposure", "Local game state", "Drops Bot alerts"],
    actions: ["FEED", "REBALANCE", "CHECK HEALTH", "SHARE PET"],
  },
  {
    id: "crypto-product-hunt",
    title: "Build Your Crypto Product Hunt",
    shortTitle: "Crypto Product Hunt",
    tagline: "Discover launches before they trend",
    description:
      "A community launch board enriched with DropsTab projects, funding, investor context, token status and live market follow-up.",
    category: "Community",
    badge: "DISCOVER",
    icon: "Rocket",
    accent: "#f05a35",
    tint: "#fff1ec",
    cta: "Build my launch board",
    output: "Community website",
    eta: "5 min",
    preview: "hunt",
    fields: [
      { id: "scope", label: "SCOPE", value: "New crypto products", options: ["New crypto products", "Pre-TGE projects", "Telegram apps", "AI x crypto"] },
      { id: "rank", label: "RANK", value: "Community + traction", options: ["Community + traction", "Funding", "Twitter performance", "Market performance"] },
      { id: "context", label: "CONTEXT", value: "Funding + investors", options: ["Funding + investors", "Token status", "Market data", "Everything"] },
      { id: "submit", label: "SUBMISSIONS", value: "Open with moderation", options: ["Open with moderation", "Invite only", "Team curated", "AI reviewed"] },
    ],
    tools: ["DropsTab project search", "Funding rounds", "Crypto activities", "Community voting"],
    actions: ["UPVOTE", "FOLLOW LAUNCH", "OPEN PROJECT", "SUBMIT"],
  },
  {
    id: "crypto-radio",
    title: "Build Your Crypto Radio",
    shortTitle: "Crypto Radio",
    tagline: "Turn market intelligence into audio",
    description:
      "A live or scheduled AI radio station that narrates market moves, unlocks, launches and personalized portfolio updates.",
    category: "Media",
    badge: "AUDIO",
    icon: "Radio",
    accent: "#e6427a",
    tint: "#fff0f5",
    cta: "Start my crypto radio",
    output: "Live audio station",
    eta: "4 min",
    preview: "radio",
    fields: [
      { id: "show", label: "SHOW", value: "Market in 5", options: ["Market in 5", "My portfolio live", "Launch radio", "Degen drive time"] },
      { id: "source", label: "SOURCE", value: "Top moves + catalysts", options: ["Top moves + catalysts", "My watchlist", "Funding + unlocks", "Custom rundown"] },
      { id: "voice", label: "VOICE", value: "Calm analyst", options: ["Calm analyst", "Fast trader", "Friendly companion", "System voice"] },
      { id: "air", label: "AIR", value: "Daily at 08:00", options: ["Play now", "Daily at 08:00", "Every 4 hours", "On major moves"] },
    ],
    tools: ["DropsTab market feed", "AI script", "Browser speech", "Telegram audio"],
    actions: ["PLAY", "PAUSE", "SKIP STORY", "SHARE SHOW"],
  },
  {
    id: "crypto-siri",
    title: "Build Your Crypto Siri",
    shortTitle: "Crypto Siri",
    tagline: "Ask the market, out loud",
    description:
      "A voice-first crypto assistant that answers with DropsTab data and creates Drops Bot alerts from natural language.",
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
      { id: "commands", label: "COMMANDS", value: "Ask + create alerts", options: ["Ask + create alerts", "Research only", "Portfolio assistant", "Full Action Engine"] },
      { id: "brain", label: "BRAIN", value: "Free Auto", options: ["Free Auto", "My OpenAI", "My Claude", "OpenRouter"] },
    ],
    tools: ["DropsTab search", "Market context", "Web Speech API", "Drops Bot deep links"],
    actions: ["ASK", "LISTEN", "CREATE ALERT", "OPEN DROPSTAB"],
  },
];

export const defaultPresetId: PresetId = "morning-alpha";
