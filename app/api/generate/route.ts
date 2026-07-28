import { NextRequest, NextResponse } from "next/server";
import type { GeneratedProjectSpec } from "@/lib/project-types";
import { applyEnhancement, validateProjectSpec } from "@/lib/project-validator";

const system = `You are the bounded Experience Director inside Drops Studio. Improve an already functional crypto product while preserving its preset, DropsTab and Drops Bot foundations, data contracts, security model and executable behavior. Return JSON only. Allowed fields: {"name":"max 64 chars","tagline":"max 120 chars","description":"max 360 chars","theme":{"accent":"#RRGGBB","surface":"#RRGGBB","mode":"dark|light|hybrid","style":"precision|cosmic|editorial|playful"},"design":{"kit":"drops-precision|neon-arena|mascot-pop|glass-signal|editorial-alpha|terminal-pro","density":"compact|comfortable|cinematic","motion":"reduced|smooth|expressive","radius":0-32,"font":"inter|space-grotesk|ibm-plex"},"experience":{"layout":"focus|split|dashboard|feed|spatial","dataView":"cards|table|timeline|graph|map","engagement":"realtime|scheduled|social|personal","audience":"max 120 chars","primaryLoop":"max 240 chars","modules":["max 12 short module names"]},"gameDirection":{"genre":"market-race|coin-quiz|portfolio-battle|unlock-dodge|catcher","artStyle":"3d-toy|comic|pixel|neon|retro-cartoon","world":"cloud-city|space-exchange|token-island|cyber-arcade|retro-factory","mascot":"coin-crew|rocket-pets|market-monsters|retro-wolf|no-mascot","gameLoop":"max 240 chars","difficulty":"casual|normal|expert","roundSeconds":5-120,"sound":true}}. Omit gameDirection for non-game products. Never return HTML, JavaScript, markdown, API keys, URLs, trading promises, financial advice, or claims of automatic execution.`;

function parseEnhancement(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model did not return a project design object.");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid project design response.");
  return parsed;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    provider?: string;
    key?: string;
    model?: string;
    prompt?: string;
    spec?: unknown;
  } | null;
  const provider = body?.provider;
  const key = body?.key?.trim();
  const prompt = body?.prompt?.trim() || "Polish this product for a premium crypto audience.";
  if (!provider || !key || !body?.spec) return NextResponse.json({ error: "Provider, key and project spec are required." }, { status: 400 });
  if (prompt.length > 2_000) return NextResponse.json({ error: "Keep instructions under 2,000 characters." }, { status: 400 });
  const spec = validateProjectSpec(body.spec);
  const defaultModels: Record<string, string> = {
    openai: "gpt-5.2",
    anthropic: "claude-haiku-4-5-20251001",
    openrouter: "openrouter/free",
    kimi: "kimi-k2.5",
  };
  const effectiveModel = body.model?.trim() || defaultModels[provider] || spec.brain.model;
  const user = JSON.stringify({ instruction: prompt, product: {
    presetId: spec.presetId,
    name: spec.name,
    tagline: spec.tagline,
    description: spec.description,
    values: spec.values,
    theme: spec.theme,
    design: spec.design,
    experience: { ...spec.experience, backgroundImage: undefined },
    gameDirection: spec.gameDirection ? { ...spec.gameDirection, backgroundImage: undefined } : undefined,
  } });

  try {
    let text = "";
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: effectiveModel, max_tokens: 900, temperature: 0.25, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json().catch(() => ({})) as { content?: Array<{ text?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `Anthropic returned ${response.status}.`);
      text = payload.content?.[0]?.text ?? "";
    } else {
      const config = provider === "openai"
        ? { url: "https://api.openai.com/v1/chat/completions", headers: {} }
        : provider === "openrouter"
          ? { url: "https://openrouter.ai/api/v1/chat/completions", headers: { "HTTP-Referer": request.nextUrl.origin, "X-OpenRouter-Title": "Drops Studio" } }
          : provider === "kimi"
            ? { url: "https://api.moonshot.ai/v1/chat/completions", headers: {} }
            : null;
      if (!config) return NextResponse.json({ error: "Unsupported enhancement provider." }, { status: 400 });
      const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${key}` };
      Object.assign(headers, config.headers);
      const openAiUsesCompletionTokens = provider === "openai"
        && (/^gpt-5(?:\.|-|$)/i.test(effectiveModel) || /^o\d+(?:\.|-|$)/i.test(effectiveModel));
      const response = await fetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: effectiveModel,
          ...(openAiUsesCompletionTokens ? { max_completion_tokens: 900 } : { temperature: 0.25, max_tokens: 900 }),
          ...(provider === "openai" ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `${provider} returned ${response.status}.`);
      text = payload.choices?.[0]?.message?.content ?? "";
    }
    const enhanced = applyEnhancement({ ...spec, brain: { ...spec.brain, provider: provider as GeneratedProjectSpec["brain"]["provider"], model: effectiveModel } }, parseEnhancement(text));
    return NextResponse.json({ spec: enhanced });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI enhancement failed." }, { status: 502 });
  }
}
