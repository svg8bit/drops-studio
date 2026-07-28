import { presets, type PresetId } from "@/lib/presets";
import { createDefaultBlueprint } from "@/lib/product-blueprint";
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
};

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
  const preset = presets.find((item) => item.id === options.presetId) ?? presets[0];
  const promptName = options.prompt.trim().split(/[.!?\n]/)[0]?.trim();
  const name = promptName && promptName.length >= 4 && promptName.length <= 54 ? promptName : preset.shortTitle;
  const now = new Date().toISOString();
  const blueprint = createDefaultBlueprint(preset.id, options.prompt);

  return validateProjectSpec({
    schemaVersion: 1,
    presetId: preset.id,
    name,
    slug: slugify(name) || preset.id,
    tagline: preset.tagline,
    description: options.prompt.trim() || preset.description,
    prompt: options.prompt,
    values: options.values,
    tools: options.tools.length ? options.tools : preset.tools,
    brain: { provider: options.provider, model: options.model || "Free Auto", enhanced: options.provider !== "free" },
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
    ...(preset.id === "crypto-game" ? {
      gameDirection: {
        genre: options.values.game === "Guess the Coin" ? "coin-quiz" : options.values.game === "Portfolio Battle" ? "portfolio-battle" : options.values.game === "Unlock Dodge" ? "unlock-dodge" : blueprint.game?.mechanic.toLowerCase().includes("catch") ? "catcher" : "market-race",
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
        roundSeconds: blueprint.visualConcept.includes("1970s") ? 45 : 30,
        sound: true,
        assetSource: blueprint.visualConcept.includes("1970s") ? "ai-generated" : "free-vector",
      },
    } : {}),
    market: options.market,
    prediction: options.prediction,
    dataEndpoint: `${options.origin.replace(/\/$/, "")}/api/public-data`,
    createdAt: now,
  });
}
