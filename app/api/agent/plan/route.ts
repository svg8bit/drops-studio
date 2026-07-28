import { createHmac, timingSafeEqual } from "node:crypto";
import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fallbackAgentPlan } from "@/lib/product-blueprint";
import { presets, type PresetId } from "@/lib/presets";

export const runtime = "nodejs";

const GUEST_DAILY_LIMIT = 3;
const MAX_PLAN_TOKENS = 4_500;
const GUEST_MODELS = [
  "poolside/laguna-s-2.1-free",
  "inclusionai/ling-3.0-flash-free",
  "zai/glm-4.6v-flash",
] as const;

const presetIds = presets.map((preset) => preset.id) as [PresetId, ...PresetId[]];
const planSchema = z.object({
  presetId: z.enum(presetIds),
  name: z.string().min(2).max(64),
  tagline: z.string().min(3).max(120),
  description: z.string().min(8).max(360),
  tools: z.array(z.string().min(2).max(80)).min(2).max(12),
  blueprint: z.object({
    locale: z.enum(["en", "ru", "auto"]),
    productType: z.string().min(3).max(100),
    visualConcept: z.string().min(12).max(600),
    primaryLoop: z.string().min(12).max(500),
    modules: z.array(z.string().min(2).max(80)).min(4).max(12),
    screens: z.array(z.string().min(2).max(80)).min(3).max(10),
    interactions: z.array(z.string().min(2).max(120)).min(4).max(14),
    dropsTabUse: z.array(z.string().min(2).max(140)).min(2).max(10),
    dropsBotUse: z.array(z.string().min(2).max(140)).min(1).max(10),
    acceptanceChecks: z.array(z.string().min(4).max(180)).min(3).max(10),
    content: z.object({
      headline: z.string().min(2).max(100),
      subheadline: z.string().min(3).max(180),
      primaryAction: z.string().min(2).max(64),
      emptyState: z.string().min(3).max(180),
    }),
    game: z.object({
      mechanic: z.string().min(8).max(360),
      protagonist: z.string().min(8).max(320),
      scene: z.string().min(8).max(420),
      objective: z.string().min(8).max(320),
      artDirection: z.string().min(8).max(420),
      dataUse: z.string().min(8).max(420),
    }).optional(),
  }),
  theme: z.object({
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    surface: z.string().regex(/^#[0-9a-f]{6}$/i),
    mode: z.enum(["light", "dark", "hybrid"]),
    style: z.enum(["precision", "cosmic", "editorial", "playful"]),
  }),
  design: z.object({
    kit: z.enum(["drops-precision", "neon-arena", "mascot-pop", "glass-signal", "editorial-alpha", "terminal-pro"]),
    density: z.enum(["compact", "comfortable", "cinematic"]),
    motion: z.enum(["reduced", "smooth", "expressive"]),
    radius: z.number().int().min(0).max(32),
    font: z.enum(["inter", "space-grotesk", "ibm-plex"]),
  }),
  experience: z.object({
    archetype: z.enum(["decision-cockpit", "creator-feed", "editorial-brief", "impact-map", "strategy-monitor", "market-explorer", "game-world", "discovery-companion", "character-habitat", "launch-board", "audio-studio", "voice-assistant"]),
    layout: z.enum(["focus", "split", "dashboard", "feed", "spatial"]),
    dataView: z.enum(["cards", "table", "timeline", "graph", "map"]),
    engagement: z.enum(["realtime", "scheduled", "social", "personal"]),
    audience: z.string().min(3).max(120),
    primaryLoop: z.string().min(12).max(240),
    modules: z.array(z.string().min(2).max(64)).min(4).max(12),
    assetSource: z.enum(["free-vector", "uploaded", "ai-generated"]),
  }),
  gameDirection: z.object({
    genre: z.enum(["market-race", "coin-quiz", "portfolio-battle", "unlock-dodge", "catcher"]),
    artStyle: z.enum(["3d-toy", "comic", "pixel", "neon", "retro-cartoon"]),
    world: z.enum(["cloud-city", "space-exchange", "token-island", "cyber-arcade", "retro-factory"]),
    mascot: z.enum(["coin-crew", "rocket-pets", "market-monsters", "retro-wolf", "no-mascot"]),
    gameLoop: z.string().min(8).max(240),
    mechanic: z.string().min(8).max(360),
    protagonist: z.string().min(8).max(320),
    scene: z.string().min(8).max(420),
    objective: z.string().min(8).max(320),
    artDirection: z.string().min(8).max(420),
    dataUse: z.string().min(8).max(420),
    difficulty: z.enum(["casual", "normal", "expert"]),
    roundSeconds: z.number().int().min(5).max(120),
    sound: z.boolean(),
    assetSource: z.enum(["free-vector", "uploaded", "ai-generated"]),
  }).optional(),
});

const systemPrompt = `You are Drops Director, the product architect inside Drops Studio — a vertical Replit/Lovable for real crypto products.

Convert the user's full request into a buildable, category-native product blueprint. Never reduce the request to a generic dashboard or a card with renamed text.

Mandatory foundations:
- DropsTab is the data, market intelligence, research, valuation, unlock, funding, category and source layer.
- Drops Bot is the wallet/coin/Polymarket alert, Telegram delivery and action-handoff layer.
- Do not claim an undocumented Drops Bot OAuth or write API. Describe a guided official-bot recipe when automatic provisioning is unavailable.
- Do not claim a trade was executed. Use planning, paper mode, explicit approval or an official handoff.
- Preserve the language of the user for visible product copy.

Allowed presetId values: ${presetIds.join(", ")}.

The output must describe a distinct runtime:
- channel/brief products must visibly look and behave like Telegram;
- games must have an illustrated world, character, animation, repeatable game loop, score, end state and restart;
- aggregators must have search, filtering, sorting and asset detail;
- assistants must have conversational input, sourced answers and memory controls;
- radio must have a real player, queue and browser speech;
- decision/copy/prediction tools must have evidence, rules, risk gates and audit state.

For a request resembling an existing copyrighted game or cartoon, preserve the requested mechanic and era mood but invent original characters, names and artwork.

Return one strict JSON object matching the requested schema. No markdown, no prose outside JSON.`;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function guestCookieSecret(): string {
  return process.env.DROPS_GUEST_COOKIE_SECRET
    || process.env.VERCEL_OIDC_TOKEN
    || (process.env.NODE_ENV !== "production" ? "drops-studio-local-development-only" : "");
}

function signGuestUsage(date: string, count: number): string {
  const secret = guestCookieSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(`${date}.${count}`).digest("hex");
}

function readGuestUsage(request: NextRequest): number {
  const value = request.cookies.get("drops_guest_builds")?.value ?? "";
  const [date, countText, signature] = value.split(".");
  if (date !== todayUtc() || !/^\d+$/.test(countText ?? "") || !/^[a-f0-9]{64}$/i.test(signature ?? "")) return 0;
  const count = Number(countText);
  const expected = signGuestUsage(date, count);
  if (!expected) return 0;
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer) ? count : 0;
}

function parseObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Model returned no JSON object.");
  return JSON.parse(text.slice(first, last + 1));
}

function responseWithQuota(payload: unknown, used: number, status = 200) {
  const response = NextResponse.json(payload, { status });
  const date = todayUtc();
  const signature = signGuestUsage(date, used);
  if (signature) {
    response.cookies.set("drops_guest_builds", `${date}.${used}.${signature}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 36,
      path: "/",
    });
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

async function runOpenRouter(prompt: string, key: string, model: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://drops-studio.vercel.app",
      "X-OpenRouter-Title": "Drops Studio",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: MAX_PLAN_TOKENS,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter returned ${response.status}.`);
  const plan = planSchema.parse(parseObject(payload.choices?.[0]?.message?.content ?? ""));
  return { ...plan, provider: "openrouter" as const, model };
}

type DirectProvider = "openai" | "anthropic" | "kimi";

async function runDirectProvider(prompt: string, key: string, provider: DirectProvider, model: string) {
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_PLAN_TOKENS,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => ({})) as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Anthropic returned ${response.status}.`);
    const text = payload.content?.find((part) => part.type === "text")?.text ?? "";
    return { ...planSchema.parse(parseObject(text)), provider, model };
  }

  const url = provider === "kimi"
    ? "https://api.moonshot.ai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      ...(provider === "openai" && /^gpt-5(?:\.|-|$)/i.test(model)
        ? { max_completion_tokens: MAX_PLAN_TOKENS }
        : { temperature: 0.2, max_tokens: MAX_PLAN_TOKENS }),
      ...(provider === "openai" ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `${provider} returned ${response.status}.`);
  return { ...planSchema.parse(parseObject(payload.choices?.[0]?.message?.content ?? "")), provider, model };
}

async function runGuestGateway(prompt: string, guestId: string) {
  const errors: string[] = [];
  for (const model of GUEST_MODELS) {
    try {
      const result = await generateText({
        model,
        maxOutputTokens: MAX_PLAN_TOKENS,
        maxRetries: 0,
        temperature: 0.2,
        system: systemPrompt,
        prompt,
        providerOptions: { gateway: { user: guestId, tags: ["feature:product-plan", "tier:guest"] } },
      });
      const plan = planSchema.parse(parseObject(result.text));
      return { plan: { ...plan, provider: "gateway" as const, model }, model, usage: result.usage };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { prompt?: string; model?: string; guestId?: string; provider?: string } | null;
  const prompt = body?.prompt?.trim() ?? "";
  if (prompt.length < 3) return NextResponse.json({ error: "Describe what you want to build." }, { status: 400 });
  if (prompt.length > 16_000) return NextResponse.json({ error: "Keep the product brief and edit context under 16,000 characters." }, { status: 400 });

  const openRouterKey = request.headers.get("x-openrouter-key")?.trim();
  if (openRouterKey) {
    try {
      const model = body?.model?.trim() || "openrouter/free";
      const plan = await runOpenRouter(prompt, openRouterKey, model);
      return NextResponse.json({ plan, tier: "byok", remaining: null }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "OpenRouter planning failed." }, { status: 502 });
    }
  }

  const directProvider = ["openai", "anthropic", "kimi"].includes(body?.provider ?? "") ? body?.provider as DirectProvider : null;
  const directKey = request.headers.get("x-provider-key")?.trim();
  if (directProvider && !directKey) {
    return NextResponse.json({ error: `Connect ${directProvider} with an API key before using it.` }, { status: 400 });
  }
  if (directProvider && directKey) {
    const defaults: Record<DirectProvider, string> = {
      openai: "gpt-5.2",
      anthropic: "claude-haiku-4-5-20251001",
      kimi: "kimi-k2.5",
    };
    try {
      const model = body?.model?.trim() || defaults[directProvider];
      const plan = await runDirectProvider(prompt, directKey, directProvider, model);
      return NextResponse.json({ plan, tier: "byok", remaining: null }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Connected model planning failed." }, { status: 502 });
    }
  }

  const used = readGuestUsage(request);
  if (used >= GUEST_DAILY_LIMIT) {
    return responseWithQuota({ error: "Guest AI build limit reached.", code: "GUEST_LIMIT", remaining: 0, connect: "openrouter" }, used, 429);
  }

  const guestId = (body?.guestId || request.headers.get("x-drops-guest") || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  try {
    const result = await runGuestGateway(prompt, guestId || crypto.randomUUID());
    return responseWithQuota({ plan: result.plan, tier: "guest", model: result.model, usage: result.usage, remaining: GUEST_DAILY_LIMIT - used - 1 }, used + 1);
  } catch (error) {
    const fallback = fallbackAgentPlan(prompt);
    return responseWithQuota({
      plan: fallback,
      tier: "fallback",
      model: fallback.model,
      remaining: GUEST_DAILY_LIMIT - used,
      warning: "Free AI capacity is busy. A category-aware local product compiler produced this build; retry AI or connect OpenRouter for a fresh model result.",
      detail: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
    }, used);
  }
}
