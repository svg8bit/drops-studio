import type { PresetId } from "./presets.ts";

export interface ProductIntentRoute {
  presetId: PresetId;
  secondary: PresetId[];
  evidence: string[];
}

const presetIds = new Set<PresetId>([
  "action-engine", "alpha-channel", "morning-alpha", "prediction-impact", "smart-money-copy", "crypto-aggregator",
  "crypto-game", "personal-companion", "portfolio-tamagotchi", "crypto-product-hunt", "crypto-radio", "crypto-siri", "custom-product",
]);

export function routeProductIntent(prompt: string): ProductIntentRoute {
  const text = prompt.toLowerCase();
  const revisionCategory = text.match(/category\s*\(([^)]+)\)/)?.[1]?.trim() as PresetId | undefined;
  if (revisionCategory && presetIds.has(revisionCategory)) {
    return { presetId: revisionCategory, secondary: [], evidence: ["locked revision category"] };
  }

  const scores = new Map<PresetId, { score: number; evidence: string[] }>();
  const add = (id: PresetId, score: number, label: string) => {
    const current = scores.get(id) ?? { score: 0, evidence: [] };
    current.score += score;
    current.evidence.push(label);
    scores.set(id, current);
  };
  const match = (pattern: RegExp, id: PresetId, score: number, label: string) => {
    if (pattern.test(text)) add(id, score, label);
  };

  match(/game|игр|arcade|аркад|wolf|волк|tetris|тетрис|геймпле/i, "crypto-game", 140, "playable game output");
  match(/radio|радио|podcast|подкаст|audio station|аудио/i, "crypto-radio", 130, "audio product output");
  match(/crypto siri|siri|voice assistant|голосов(?:ой|ого) ассистент|спросить голосом/i, "crypto-siri", 130, "voice assistant output");
  match(/tamagotchi|тамагочи|portfolio pet|питом/i, "portfolio-tamagotchi", 130, "character product output");
  match(/product hunt|launch board|доска запусков|каталог крипто проект/i, "crypto-product-hunt", 125, "launch community output");
  match(/aggregator|агрегатор|coinmarketcap|coingecko|market explorer|рейтинг монет/i, "crypto-aggregator", 125, "market site output");
  match(/morning|утрен|daily brief|ежедневн(?:ый|ого) (?:brief|дайджест)|дайджест/i, "morning-alpha", 115, "scheduled brief output");
  match(/(?:build|create|launch|make|созда(?:й|ть)|сдела(?:й|ть)|запусти(?:ть)?)[\s\S]{0,90}(?:channel|канал)/i, "alpha-channel", 175, "explicitly requested channel product");
  match(/(?:build|create|launch|make|созда(?:й|ть)|сдела(?:й|ть)|запусти(?:ть)?)\s+(?:an?\s+|свой\s+|автоматизированн(?:ый|ого)\s+)?(?:telegram|tg|телеграм)?\s*(?:alert\s+|alpha\s+|крипто\s+)?(?:channel|канал)/i, "alpha-channel", 150, "explicit channel output");
  match(/telegram channel|tg channel|телеграм(?:м)?\s*канал|alpha channel|канал с алерт/i, "alpha-channel", 125, "Telegram channel output");
  match(/prediction|polymarket|odds|вероятност|рынок предсказан/i, "prediction-impact", 115, "prediction impact output");
  match(/copy\s*(?:trad|strategy)|копитрейд|копи[- ]?стратег|повторять сделк/i, "smart-money-copy", 145, "copy strategy output");
  match(/smart money|wallet tracking|wallet monitor|кошельк|китов|whale/i, "smart-money-copy", 48, "wallet intelligence capability");
  match(/personal companion|персональн(?:ый|ого) помощник|recommend|рекомендац|лента интерес/i, "personal-companion", 110, "personal discovery output");
  match(/action engine|decision engine|intelligence.to.action|движок решен/i, "action-engine", 120, "decision engine output");
  match(/telegram|телеграм|tg\b/i, "alpha-channel", 24, "Telegram delivery");
  match(/alert|алерт|уведомлен|trigger|триггер/i, "action-engine", 12, "alert capability");

  const ordered = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const primary = ordered[0]?.[0] ?? "custom-product";
  return {
    presetId: primary,
    secondary: ordered.slice(1).filter(([, value]) => value.score >= 24).map(([id]) => id),
    evidence: ordered[0]?.[1].evidence ?? ["free-form crypto product request"],
  };
}
