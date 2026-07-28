import type { GeneratedProjectSpec, ProjectDesignKit } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";

export interface DirectorProposal {
  label: string;
  summary: string[];
  spec: GeneratedProjectSpec;
  affected: string[];
}

export const DESIGN_DIRECTIONS: Array<{
  id: ProjectDesignKit;
  name: string;
  copy: string;
  palette: string[];
  bestFor: string;
}> = [
  { id: "neon-arena", name: "Neon Arena", copy: "Cinematic game world, luminous HUD and expressive motion.", palette: ["#071326", "#7657ff", "#ef4fa7"], bestFor: "Games · viral products" },
  { id: "mascot-pop", name: "Mascot Pop", copy: "Friendly illustrated characters, soft shapes and social energy.", palette: ["#11102d", "#ffbd59", "#ff5dac"], bestFor: "Companions · communities" },
  { id: "drops-precision", name: "Drops Precision", copy: "Clear crypto intelligence with high-trust action surfaces.", palette: ["#061426", "#316cff", "#35e3a3"], bestFor: "Research · automation" },
  { id: "glass-signal", name: "Glass Signal", copy: "Layered glass panels for rich data without visual weight.", palette: ["#06162c", "#31c9ff", "#6c5cff"], bestFor: "Dashboards · assistants" },
  { id: "editorial-alpha", name: "Editorial Alpha", copy: "Publication-like hierarchy for briefs, feeds and media.", palette: ["#11172a", "#3877ff", "#f3f6ff"], bestFor: "Briefs · channels · radio" },
  { id: "terminal-pro", name: "Terminal Pro", copy: "Dense and restrained workspace for professional operators.", palette: ["#050b14", "#19c98f", "#b8c8df"], bestFor: "Trading · monitoring" },
];

function includesAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function nextKit(current: ProjectDesignKit): ProjectDesignKit {
  const order = DESIGN_DIRECTIONS.map((item) => item.id);
  return order[(order.indexOf(current) + 1) % order.length];
}

export function createFreeDirectorProposal(current: GeneratedProjectSpec, instruction: string, selectedBlock?: string): DirectorProposal {
  const value = instruction.trim();
  const query = value.toLowerCase();
  const draft = structuredClone(current);
  const summary: string[] = [];
  const affected = new Set<string>();
  const touch = (area: string, message: string) => { affected.add(area); summary.push(message); };

  const hex = value.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) {
    draft.theme.accent = hex.toLowerCase();
    touch("Design tokens", `Set the primary accent to ${hex.toLowerCase()}.`);
  } else if (includesAny(query, ["pink", "розов", "magenta"])) {
    draft.theme.accent = "#ef4fa7";
    touch("Design tokens", "Shifted the accent to energetic magenta.");
  } else if (includesAny(query, ["green", "зелен", "emerald"])) {
    draft.theme.accent = "#23d59b";
    touch("Design tokens", "Shifted the accent to market green.");
  } else if (includesAny(query, ["orange", "оранж", "bitcoin color"])) {
    draft.theme.accent = "#ff9636";
    touch("Design tokens", "Shifted the accent to warm crypto orange.");
  } else if (includesAny(query, ["blue", "син", "drops blue"])) {
    draft.theme.accent = "#316cff";
    touch("Design tokens", "Applied the Drops blue accent.");
  }

  if (includesAny(query, ["cartoon", "мульт", "mascot", "персонаж", "cute", "мил"] )) {
    draft.design.kit = "mascot-pop";
    draft.design.motion = "expressive";
    draft.design.radius = 24;
    if (draft.gameDirection) {
      draft.gameDirection.artStyle = "comic";
      draft.gameDirection.mascot = "coin-crew";
      draft.gameDirection.world = "token-island";
    }
    touch("Art direction", "Applied a cartoon mascot direction with expressive motion.");
  }
  if (includesAny(query, ["3d", "toy", "игруш", "pixar"])) {
    draft.design.kit = "neon-arena";
    if (draft.gameDirection) draft.gameDirection.artStyle = "3d-toy";
    touch("Art direction", "Applied a polished 3D-toy game direction.");
  }
  if (includesAny(query, ["pixel", "пиксел", "8-bit", "8bit"])) {
    draft.design.kit = "neon-arena";
    draft.design.radius = 6;
    if (draft.gameDirection) {
      draft.gameDirection.artStyle = "pixel";
      draft.gameDirection.world = "cyber-arcade";
    }
    touch("Art direction", "Converted the game world to a pixel cyber arcade.");
  }
  if (includesAny(query, ["cyber", "кибер", "neon", "неон", "arcade", "аркад"])) {
    draft.design.kit = "neon-arena";
    draft.design.motion = "expressive";
    if (draft.gameDirection) {
      draft.gameDirection.artStyle = "neon";
      draft.gameDirection.world = "cyber-arcade";
    }
    touch("Art direction", "Applied a neon arcade world and expressive motion.");
  }
  if (includesAny(query, ["terminal", "терминал", "professional", "професси", "trader"])) {
    draft.design.kit = "terminal-pro";
    draft.design.density = "compact";
    draft.design.radius = 6;
    draft.design.font = "ibm-plex";
    touch("Design system", "Applied a compact professional terminal system.");
  }
  if (includesAny(query, ["editorial", "журнал", "magazine", "новост"] )) {
    draft.design.kit = "editorial-alpha";
    draft.design.density = "comfortable";
    touch("Design system", "Applied an editorial intelligence hierarchy.");
  }
  if (includesAny(query, ["glass", "стекл", "blur"])) {
    draft.design.kit = "glass-signal";
    touch("Design system", "Applied layered glass surfaces.");
  }

  if (includesAny(query, ["compact", "компакт", "smaller", "меньше"])) {
    draft.design.density = "compact";
    touch("Layout", "Reduced spacing and increased information density.");
  }
  if (includesAny(query, ["cinematic", "кинематограф", "immersive", "на весь экран"])) {
    draft.design.density = "cinematic";
    touch("Layout", "Expanded the primary experience into a cinematic layout.");
  }
  if (includesAny(query, ["rounded", "кругл", "мягк"] )) {
    draft.design.radius = 26;
    touch("Design tokens", "Increased corner radius for a softer interface.");
  }
  if (includesAny(query, ["sharp", "углов", "без скруг"] )) {
    draft.design.radius = 2;
    touch("Design tokens", "Reduced corner radius for a sharper system.");
  }
  if (includesAny(query, ["less animation", "без анима", "reduced motion"])) {
    draft.design.motion = "reduced";
    touch("Motion", "Reduced non-essential animation.");
  }

  if (includesAny(query, ["dashboard", "дашборд", "control room", "cockpit"])) {
    draft.experience.layout = "dashboard";
    touch("Experience", "Reframed the product as a multi-module command dashboard.");
  } else if (includesAny(query, ["feed", "лента", "timeline", "таймлайн"])) {
    draft.experience.layout = "feed";
    draft.experience.dataView = "timeline";
    touch("Experience", "Reframed the primary experience as a continuously scannable feed.");
  } else if (includesAny(query, ["split", "две колон", "side by side"])) {
    draft.experience.layout = "split";
    touch("Experience", "Applied a focused two-pane workflow.");
  } else if (includesAny(query, ["focus", "минимал", "one thing", "один экран"])) {
    draft.experience.layout = "focus";
    touch("Experience", "Reduced the experience to one dominant user task.");
  }

  if (includesAny(query, ["heatmap", "теплов", "map view", "карта связей"])) {
    draft.experience.dataView = "map";
    touch("Data presentation", "Changed the primary data view to a visual relationship map.");
  } else if (includesAny(query, ["table", "таблиц", "ranking", "рейтинг"])) {
    draft.experience.dataView = "table";
    touch("Data presentation", "Changed the primary data view to a sortable table.");
  } else if (includesAny(query, ["graph", "граф", "node", "связ"] )) {
    draft.experience.dataView = "graph";
    touch("Data presentation", "Changed the primary data view to a connected graph.");
  } else if (includesAny(query, ["cards", "карточ"] )) {
    draft.experience.dataView = "cards";
    touch("Data presentation", "Changed the primary data view to modular cards.");
  }

  if (includesAny(query, ["social", "социал", "viral", "вирус", "share loop"])) {
    draft.experience.engagement = "social";
    touch("Growth loop", "Added social sharing as the primary engagement loop.");
  } else if (includesAny(query, ["scheduled", "расписан", "каждое утро", "daily"])) {
    draft.experience.engagement = "scheduled";
    touch("Delivery", "Set the product around a scheduled recurring loop.");
  } else if (includesAny(query, ["personal", "личн", "for me", "для меня"])) {
    draft.experience.engagement = "personal";
    touch("Personalization", "Made personalization the primary engagement model.");
  } else if (includesAny(query, ["real-time", "realtime", "реалтайм", "в реальном времени"])) {
    draft.experience.engagement = "realtime";
    touch("Live behavior", "Set the experience to a real-time monitoring loop.");
  }

  if (draft.gameDirection) {
    if (includesAny(query, ["race", "гонк", "racing"])) {
      draft.gameDirection.genre = "market-race";
      draft.values.game = "Beat the Market";
      touch("Game loop", "Set the core loop to an animated live-market race.");
    } else if (includesAny(query, ["quiz", "виктор", "guess", "угадай"])) {
      draft.gameDirection.genre = "coin-quiz";
      draft.values.game = "Guess the Coin";
      touch("Game loop", "Set the core loop to a coin identity quiz.");
    } else if (includesAny(query, ["battle", "битв", "versus", "vs"])) {
      draft.gameDirection.genre = "portfolio-battle";
      draft.values.game = "Portfolio Battle";
      touch("Game loop", "Set the core loop to a portfolio-versus battle.");
    } else if (includesAny(query, ["dodge", "уклон", "unlock game"])) {
      draft.gameDirection.genre = "unlock-dodge";
      draft.values.game = "Unlock Dodge";
      touch("Game loop", "Set the core loop to an unlock-dodging arcade challenge.");
    }
    const seconds = query.match(/(?:round|раунд|таймер)[^0-9]{0,12}(\d{1,3})/)?.[1];
    if (seconds) {
      draft.gameDirection.roundSeconds = Math.min(120, Math.max(5, Number(seconds)));
      touch("Game rules", `Set the playable demo round to ${draft.gameDirection.roundSeconds} seconds.`);
    }
    if (includesAny(query, ["hard", "сложн", "expert"])) {
      draft.gameDirection.difficulty = "expert";
      touch("Game rules", "Raised difficulty to expert.");
    } else if (includesAny(query, ["easy", "легк", "casual"])) {
      draft.gameDirection.difficulty = "casual";
      touch("Game rules", "Set difficulty to casual.");
    }
    if (includesAny(query, ["mute", "без звук", "sound off"])) {
      draft.gameDirection.sound = false;
      touch("Game audio", "Disabled game sound cues.");
    }
  }

  const block = selectedBlock || (includesAny(query, ["header", "шапк"]) ? "project-header" : includesAny(query, ["footer", "футер"]) ? "footer" : undefined);
  if (block && includesAny(query, ["hide", "убери", "скрой", "remove"])) {
    draft.blocks[block] = { ...(draft.blocks[block] ?? { variant: "default" }), visible: false };
    touch("Selected block", `Hide ${block.replace(/-/g, " ")}.`);
  } else if (block && includesAny(query, ["show", "покажи", "верни"])) {
    draft.blocks[block] = { ...(draft.blocks[block] ?? { variant: "default" }), visible: true };
    touch("Selected block", `Show ${block.replace(/-/g, " ")}.`);
  } else if (block && includesAny(query, ["wide", "широк", "spotlight", "главн"])) {
    draft.blocks[block] = { visible: true, variant: includesAny(query, ["spotlight", "главн"]) ? "spotlight" : "wide" };
    touch("Selected block", `Changed ${block.replace(/-/g, " ")} to a stronger layout variant.`);
  }

  const rename = value.match(/(?:call it|rename to|назови|переименуй(?: в)?)\s+["«]?([^"»\n]{3,64})/i)?.[1]?.trim();
  if (rename) {
    draft.name = rename.replace(/[.!?]+$/, "");
    touch("Project identity", `Renamed the product to ${draft.name}.`);
  }

  if (!summary.length) {
    draft.prompt = value;
    draft.design.kit = nextKit(draft.design.kit);
    touch("Director brief", "Saved the new product direction and prepared an alternative visual system for review.");
  }

  return {
    label: draft.presetId === "crypto-game" ? "Game Director proposal" : "Drops Director proposal",
    summary: summary.slice(0, 8),
    affected: Array.from(affected),
    spec: validateProjectSpec(draft),
  };
}
