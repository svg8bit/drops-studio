import { getProjectPreset, type PresetId } from "@/lib/presets";
import { createDefaultBlueprint, createDefaultCustomGraph } from "@/lib/product-blueprint";
import type { GeneratedProjectSpec, ProjectMarketCoin, ProjectPrediction, ProjectProvider } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54);
}

const themes: Record<PresetId, GeneratedProjectSpec["theme"]> = {
  "action-engine": { accent: "#316cff", surface: "#071326", mode: "dark", style: "precision" },
  "alpha-channel": { accent: "#7c4dff", surface: "#0b1025", mode: "dark", style: "editorial" },
  "morning-alpha": { accent: "#2f6df6", surface: "#07182b", mode: "hybrid", style: "editorial" },
  "prediction-impact": { accent: "#0f9f76", surface: "#061a1a", mode: "dark", style: "precision" },
  "smart-money-copy": { accent: "#ff6b35", surface: "#17100e", mode: "dark", style: "precision" },
  "crypto-aggregator": { accent: "#1d7cf2", surface: "#061426", mode: "hybrid", style: "precision" },
  "crypto-game": { accent: "#ee4f9b", surface: "#080d26", mode: "dark", style: "cosmic" },
  "personal-companion": { accent: "#6f5df6", surface: "#10102a", mode: "hybrid", style: "editorial" },
  "portfolio-tamagotchi": { accent: "#15a67a", surface: "#071b1c", mode: "dark", style: "playful" },
  "crypto-product-hunt": { accent: "#f05a35", surface: "#17110e", mode: "hybrid", style: "editorial" },
  "crypto-radio": { accent: "#e6427a", surface: "#190a1b", mode: "dark", style: "cosmic" },
  "crypto-siri": { accent: "#4477f2", surface: "#070d27", mode: "dark", style: "cosmic" },
  "custom-product": { accent: "#316cff", surface: "#071326", mode: "dark", style: "precision" },
};

export function gameRoundSeconds(value: string): number {
  if (/\b5\s*minutes?\b/i.test(value)) return 15;
  if (/\b1\s*hours?\b/i.test(value)) return 20;
  if (/\b7\s*days?\b/i.test(value)) return 45;
  return 30;
}

const gameGenres: Record<string, NonNullable<GeneratedProjectSpec["gameDirection"]>["genre"]> = {
  "Beat the Market": "market-race",
  "Guess the Coin": "coin-quiz",
  "Portfolio Battle": "portfolio-battle",
  "Unlock Dodge": "unlock-dodge",
};

/**
 * Applies a recipe field to both the visible value and the native runtime
 * contract that actually drives behavior. Category-specific fields must never
 * become label-only metadata in Project Studio.
 */
export function applyPresetFieldValue(
  spec: GeneratedProjectSpec,
  fieldId: string,
  value: string,
): GeneratedProjectSpec {
  const next: GeneratedProjectSpec = {
    ...spec,
    values: { ...spec.values, [fieldId]: value },
  };
  const updateExperience = (patch: Partial<GeneratedProjectSpec["experience"]>) => {
    next.experience = { ...next.experience, ...patch };
  };

  switch (spec.presetId) {
    case "action-engine":
      if (fieldId === "signal") {
        updateExperience({
          audience: value === "Custom thesis" ? "Custom thesis operators" : "Active crypto operators",
          dataView: value === "Custom thesis" ? "cards" : "graph",
        });
      }
      if (fieldId === "action") updateExperience({ layout: value === "Build basket" ? "dashboard" : "split" });
      break;
    case "alpha-channel":
      if (fieldId === "niche") updateExperience({ audience: `${value} Telegram creators` });
      if (fieldId === "sources") updateExperience({ dataView: value === "Everything curated" ? "mixed" : "timeline" });
      if (fieldId === "earn") updateExperience({ engagement: "social" });
      break;
    case "morning-alpha":
      if (fieldId === "assets") updateExperience({ audience: `${value} daily readers` });
      if (fieldId === "time") updateExperience({ engagement: "scheduled" });
      if (fieldId === "sections") updateExperience({ dataView: value === "My custom sections" ? "mixed" : "cards" });
      break;
    case "prediction-impact":
      if (fieldId === "impact") updateExperience({ dataView: value === "My basket" ? "cards" : "map" });
      if (fieldId === "action") updateExperience({ layout: value === "Reversal strategy" ? "focus" : "split" });
      break;
    case "smart-money-copy":
      if (fieldId === "wallets") updateExperience({ audience: `${value} strategy operators` });
      if (fieldId === "execute") {
        updateExperience({ engagement: value === "Research only" ? "personal" : "realtime" });
      }
      break;
    case "crypto-aggregator":
      if (fieldId === "universe") updateExperience({ audience: `${value} market explorers` });
      if (fieldId === "modules") updateExperience({ dataView: value === "Full research" ? "mixed" : "table" });
      if (fieldId === "publish") {
        updateExperience({ engagement: value === "Private dashboard" ? "personal" : value === "Telegram mini app" ? "social" : "realtime" });
      }
      break;
    case "crypto-game":
      if (spec.gameDirection) {
        next.gameDirection = {
          ...spec.gameDirection,
          ...(fieldId === "game" && gameGenres[value] ? { genre: gameGenres[value] } : {}),
          ...(fieldId === "round" ? { roundSeconds: gameRoundSeconds(value) } : {}),
        };
      }
      if (fieldId === "assets") updateExperience({ audience: `${value} game players` });
      if (fieldId === "social") updateExperience({ engagement: value === "No leaderboard" ? "personal" : "social" });
      break;
    case "personal-companion":
      if (fieldId === "profile") updateExperience({ audience: `${value} crypto explorers` });
      if (fieldId === "discover") updateExperience({ dataView: value === "Upcoming catalysts" ? "timeline" : "cards" });
      if (fieldId === "learn") updateExperience({ engagement: "personal" });
      break;
    case "portfolio-tamagotchi":
      if (fieldId === "personality") updateExperience({ audience: `${value} portfolio holders` });
      if (fieldId === "care") {
        updateExperience({ engagement: value === "On big moves" || value === "When it gets sick" ? "realtime" : "scheduled" });
      }
      break;
    case "crypto-product-hunt":
      if (fieldId === "scope") updateExperience({ audience: `${value} product builders` });
      if (fieldId === "rank" && value === "Manual review") updateExperience({ dataView: "cards" });
      if (fieldId === "submit") updateExperience({ engagement: value === "Private drafts" ? "personal" : "social" });
      break;
    case "crypto-radio":
      if (fieldId === "show") updateExperience({ audience: `${value} listeners` });
      if (fieldId === "source") updateExperience({ dataView: "timeline" });
      if (fieldId === "air") updateExperience({ engagement: value === "Telegram handoff" ? "social" : "scheduled" });
      break;
    case "crypto-siri":
      if (fieldId === "language") updateExperience({ audience: `${value} voice users` });
      if (fieldId === "answer") updateExperience({ dataView: value === "Voice + cards" ? "mixed" : "cards" });
      if (fieldId === "commands") updateExperience({ engagement: value === "Research only" ? "personal" : "realtime" });
      break;
    case "custom-product":
      if (fieldId === "audience") updateExperience({ audience: value });
      if (fieldId === "primary-view") {
        updateExperience({
          layout: value === "Research feed" ? "feed" : value === "Personal dashboard" ? "dashboard" : "dashboard",
          dataView: value === "Research feed" ? "timeline" : value === "Market explorer" ? "table" : value === "Personal dashboard" ? "cards" : "mixed",
        });
      }
      if (fieldId === "automation") updateExperience({ engagement: value === "Research only" || value === "No automation" ? "personal" : "realtime" });
      break;
  }
  return validateProjectSpec(next);
}

export function createProjectSpec(options: {
  presetId: PresetId;
  values: Record<string, string>;
  prompt: string;
  tools: string[];
  provider: ProjectProvider;
  model: string;
  market: ProjectMarketCoin[];
  prediction: ProjectPrediction;
  origin: string;
}): GeneratedProjectSpec {
  const preset = getProjectPreset(options.presetId);
  const promptName = options.prompt.trim().split(/[.!?\n]/)[0]?.trim();
  const name = promptName && promptName.length >= 4 && promptName.length <= 54 ? promptName : preset.shortTitle;
  const now = new Date().toISOString();
  const blueprint = createDefaultBlueprint(preset.id, options.prompt);

  const base = validateProjectSpec({
    schemaVersion: 1,
    presetId: preset.id,
    name,
    slug: slugify(name) || preset.id,
    tagline: preset.tagline,
    description: options.prompt.trim() || preset.description,
    prompt: options.prompt,
    values: options.values,
    tools: options.tools.length ? options.tools : preset.tools,
    brain: { provider: "free", model: "Free compiler", enhanced: false },
    theme: themes[preset.id],
    design: {
      kit: preset.id === "crypto-game" ? "neon-arena" : preset.id === "portfolio-tamagotchi" ? "mascot-pop" : "drops-precision",
      density: preset.id === "crypto-game" ? "cinematic" : "comfortable",
      motion: preset.id === "crypto-game" ? "expressive" : "smooth",
      radius: preset.id === "crypto-game" ? 22 : 16,
      font: preset.id === "crypto-game" ? "space-grotesk" : "inter",
    },
    blocks: {},
    blueprint,
    ...(preset.id === "custom-product" ? { customGraph: createDefaultCustomGraph(options.prompt) } : {}),
    ...(preset.id === "crypto-game" ? {
      gameDirection: {
        genre: gameGenres[options.values.game] ?? "market-race",
        artStyle: blueprint.visualConcept.includes("1970s") ? "retro-cartoon" : "3d-toy",
        world: blueprint.visualConcept.includes("1970s") ? "retro-factory" : "cloud-city",
        mascot: blueprint.visualConcept.includes("wolf") ? "retro-wolf" : "coin-crew",
        gameLoop: blueprint.primaryLoop,
        mechanic: blueprint.game?.mechanic ?? "Choose a coin hero, lock a live-market prediction and react to the animated round.",
        protagonist: blueprint.game?.protagonist ?? "An original coin hero.",
        scene: blueprint.game?.scene ?? "A polished animated crypto game world.",
        objective: blueprint.game?.objective ?? "Finish the round with the highest market-informed score.",
        artDirection: blueprint.game?.artDirection ?? blueprint.visualConcept,
        dataUse: blueprint.game?.dataUse ?? blueprint.dropsTabUse.join(" · "),
        difficulty: "normal",
        roundSeconds: gameRoundSeconds(options.values.round ?? "24 hours"),
        sound: true,
        assetSource: blueprint.visualConcept.includes("1970s") ? "ai-generated" : "free-vector",
      },
    } : {}),
    market: options.market,
    prediction: options.prediction,
    dataEndpoint: `${options.origin.replace(/\/$/, "")}/api/public-data`,
    createdAt: now,
  });
  return Object.entries(options.values).reduce(
    (current, [fieldId, value]) => applyPresetFieldValue(current, fieldId, value),
    base,
  );
}
