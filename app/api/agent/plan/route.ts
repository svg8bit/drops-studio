import { createGateway, generateText, Output } from "ai";
import { jsonrepair } from "jsonrepair";
import { NextRequest, NextResponse } from "next/server.js";
import { z } from "zod";
import { fallbackAgentPlan, routeProductIntent, type AgentProductPlan } from "../../../../lib/product-blueprint.ts";
import { projectPresetIds, type PresetId } from "../../../../lib/presets.ts";
import {
  accessMetadata,
  createGuestUsageCookie,
  GUEST_DAILY_LIMIT,
  GUEST_IDENTITY_COOKIE,
  GUEST_USAGE_COOKIE,
  MEMBER_USAGE_COOKIE,
  platformAiReadiness,
  consumeFundedBuildQuota,
  resolveAccountCookieSecret,
  resolveGuestAccess,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../../lib/access-tier.ts";
import { consumeRequestLimitState, requestIdentity } from "../../../../lib/request-rate-limit.ts";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "../../../../lib/http-request-boundary.ts";
import { secretFreeRuntimeMessage } from "../../../../lib/project-runtime-adapter.ts";
import { readStudioConnectionSecret } from "../../../../db/studio-account-state.ts";

export const runtime = "nodejs";

const MAX_PLAN_TOKENS = 4_500;
export const PLATFORM_PLAN_MODELS = {
  guest: [
    "openai/gpt-5.6-sol",
    "inclusionai/ling-3.0-flash-free",
  ],
  member: [
    "openai/gpt-5.6-sol",
    "google/gemini-3.6-flash",
  ],
} as const;
const GUEST_IP_REQUEST_LIMIT = 12;
const PLAN_BODY_LIMIT_BYTES = 24_000;

function requestOidcToken(request: NextRequest): string | undefined {
  const value = request.headers.get("x-vercel-oidc-token")?.trim() ?? "";
  return value && value.length <= 4_096 && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function requestCredential(request: NextRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim() ?? "";
  return value && value.length <= 4_096 && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "")
      || request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    const parsed = new URL(origin).origin;
    return parsed === request.nextUrl.origin || parsed === visibleOrigin;
  } catch {
    return false;
  }
}

async function requestBody(request: NextRequest): Promise<{
  prompt?: string;
  model?: string;
  provider?: string;
} | null> {
  try {
    const raw = decodeUtf8Body(await readBoundedRequestBody(request, PLAN_BODY_LIMIT_BYTES));
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as { prompt?: string; model?: string; provider?: string }
      : null;
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      throw error;
    }
    return null;
  }
}

const presetIds = projectPresetIds as [PresetId, ...PresetId[]];
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
    revisionNotes: z.array(z.string().min(4).max(180)).max(8).optional(),
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
    archetype: z.enum(["decision-cockpit", "creator-feed", "editorial-brief", "impact-map", "strategy-monitor", "market-explorer", "game-world", "discovery-companion", "character-habitat", "launch-board", "audio-studio", "voice-assistant", "modular-crypto-app"]),
    layout: z.enum(["focus", "split", "dashboard", "feed", "spatial"]),
    dataView: z.enum(["cards", "table", "timeline", "graph", "map", "mixed"]),
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
  customGraph: z.object({
    version: z.literal(1),
    appKind: z.string().min(3).max(100),
    initialScreenId: z.string().regex(/^[a-z0-9-]{1,48}$/),
    screens: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{1,48}$/),
      title: z.string().min(2).max(72),
      route: z.string().regex(/^\/[a-z0-9/-]*$/).max(80),
      layout: z.enum(["grid", "feed", "split"]),
      componentIds: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).min(1).max(12),
    })).min(3).max(6),
    modules: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{1,48}$/),
      title: z.string().min(2).max(72),
      description: z.string().min(3).max(180),
      componentIds: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).min(1).max(12),
    })).min(3).max(10),
    components: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{1,48}$/),
      title: z.string().min(2).max(80),
      description: z.string().min(3).max(220),
      kind: z.enum(["metric-strip", "market-table", "watchlist", "research-feed", "event-timeline", "comparison", "portfolio", "alert-builder", "notes"]),
      dataSource: z.enum(["market", "unlocks", "funding", "activities", "predictions", "local"]),
      actions: z.array(z.enum(["refresh", "filter", "sort", "favorite", "compare", "save-local", "open-dropstab", "configure-dropsbot", "none"])).min(1).max(6),
      span: z.enum(["third", "half", "full"]),
    })).min(6).max(18),
  }).optional(),
  elementEdit: z.object({
    elementId: z.string().regex(/^[a-z0-9-]{3,96}$/),
    config: z.object({
      text: z.string().max(800).optional(),
      visible: z.boolean().optional(),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      backgroundColor: z.union([z.string().regex(/^#[0-9a-f]{6}$/i), z.literal("transparent")]).optional(),
      fontSize: z.number().int().min(12).max(120).optional(),
      fontWeight: z.number().int().min(300).max(950).optional(),
      textAlign: z.enum(["left", "center", "right"]).optional(),
      width: z.number().min(10).max(100).optional(),
      padding: z.number().int().min(0).max(80).optional(),
      borderRadius: z.number().int().min(0).max(80).optional(),
      translateX: z.number().int().min(-500).max(500).optional(),
      translateY: z.number().int().min(-500).max(500).optional(),
      opacity: z.number().min(0).max(1).optional(),
      zIndex: z.number().int().min(-10).max(100).optional(),
    }),
  }).optional(),
});

const systemPrompt = `You are Drops Director, the product architect inside Drops Studio — a vertical Replit/Lovable for real crypto products.

Convert the user's full request into a buildable, category-native product blueprint. Never reduce the request to a generic dashboard or a card with renamed text.

Mandatory foundations:
- DropsTab is the data, market intelligence, research, valuation, unlock, funding, category and source layer.
- Drops Bot is the wallet/coin/Polymarket alert, Telegram delivery and action-handoff layer.
- Telegram channels are created only after explicit approval through the Studio's Telegram user-account connection; a bot cannot create a channel. After creation, the configured bot may be added as administrator and publish verified posts. For exported standalone apps, describe a truthful Studio handoff or existing-channel setup when account provisioning is unavailable.
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
- requests that do not match a curated runtime must use custom-product and include a customGraph with 3-6 screens, 3-10 modules and 6-18 safe components;
- customGraph is declarative only: select the allowed component/data/action values, preserve referential integrity and never return HTML, JavaScript, URLs containing credentials, executable expressions or trade execution actions.

For a request resembling an existing copyrighted game or cartoon, preserve the requested mechanic and era mood but invent original characters, names and artwork.

When the prompt contains a selected canvas element, keep its exact elementId and return a focused elementEdit with only the requested text/style/visibility changes. Do not use elementEdit for whole-product requests and never invent an image URL.

Return one strict JSON object matching the requested schema. No markdown, no prose outside JSON.`;

function alignPlanToRequestedOutput(plan: AgentProductPlan, prompt: string): AgentProductPlan {
  const intent = routeProductIntent(prompt);
  if (plan.presetId === intent.presetId) {
    const parsed = planSchema.parse(plan);
    return { ...parsed, provider: plan.provider, model: plan.model };
  }
  const fallback = fallbackAgentPlan(prompt, intent.presetId);
  const parsed = planSchema.parse({
    ...fallback,
    theme: { ...fallback.theme, ...plan.theme },
    design: { ...fallback.design, ...plan.design },
  });
  return {
    ...parsed,
    provider: plan.provider,
    model: plan.model,
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("Model returned no JSON object.");
  const candidate = text.slice(first, last > first ? last + 1 : undefined);
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

function responseWithQuota(
  payload: unknown,
  context: ReturnType<typeof resolveGuestAccess>,
  used: number,
  status = 200,
) {
  const response = NextResponse.json(payload, { status });
  if (context.identityCookie) {
    response.cookies.set(GUEST_IDENTITY_COOKIE, context.identityCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
      path: "/",
    });
  }
  if (context.configured && context.identity) {
    response.cookies.set(GUEST_USAGE_COOKIE, createGuestUsageCookie({
      date: todayUtc(),
      count: used,
      identity: context.identity,
    }, context.secret), {
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

function responseWithMemberQuota(
  payload: unknown,
  account: NonNullable<ReturnType<typeof resolveStudioAccount>>,
  used: number,
  status = 200,
) {
  const response = NextResponse.json(payload, { status });
  const secret = resolveAccountCookieSecret();
  if (secret) {
    response.cookies.set(MEMBER_USAGE_COOKIE, createGuestUsageCookie({
      date: todayUtc(),
      count: used,
      identity: account.identity,
    }, secret), {
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

async function runGuestGateway(
  prompt: string,
  guestId: string,
  tier: "guest" | "member" = "guest",
  requestGatewayToken?: string,
) {
  const gatewayToken = requestGatewayToken || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) throw new Error("Platform AI Gateway is not configured.");
  const guestGateway = createGateway({ apiKey: gatewayToken });
  const errors: string[] = [];
  for (const model of PLATFORM_PLAN_MODELS[tier]) {
    try {
      if (model === "openai/gpt-5.6-sol") {
        const result = await generateText({
          model: guestGateway(model),
          output: Output.object({
            schema: planSchema,
            name: "drops_product_plan",
            description: "A complete, category-native DropsTab and Drops Bot product blueprint.",
          }),
          maxOutputTokens: MAX_PLAN_TOKENS,
          maxRetries: 0,
          system: systemPrompt,
          prompt,
          abortSignal: AbortSignal.timeout(18_000),
          providerOptions: { gateway: { user: guestId, tags: ["feature:product-plan", `tier:${tier}`] } },
        });
        return { plan: { ...result.output, provider: "gateway" as const, model }, model, usage: result.usage };
      }
      const result = await generateText({
        model: guestGateway(model),
        maxOutputTokens: MAX_PLAN_TOKENS,
        maxRetries: 0,
        temperature: 0.2,
        system: systemPrompt,
        prompt,
        abortSignal: AbortSignal.timeout(18_000),
        providerOptions: { gateway: { user: guestId, tags: ["feature:product-plan", `tier:${tier}`] } },
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
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin planning requests are not allowed." }, { status: 403 });
  }
  if (!hasJsonMediaType(request)) {
    return NextResponse.json({ error: "Planning requests require application/json." }, { status: 415 });
  }
  let body: Awaited<ReturnType<typeof requestBody>>;
  try {
    body = await requestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError) {
      return NextResponse.json({ error: "Planning request exceeds the bounded request size." }, { status: 413 });
    }
    return NextResponse.json({ error: "Planning request is invalid." }, { status: 400 });
  }
  const prompt = body?.prompt?.trim() ?? "";
  if (prompt.length < 3) return NextResponse.json({ error: "Describe what you want to build." }, { status: 400 });
  if (prompt.length > 16_000) return NextResponse.json({ error: "Keep the product brief and edit context under 16,000 characters." }, { status: 400 });
  const gatewayToken = requestOidcToken(request);
  const readinessEnvironment = gatewayToken
    ? { ...process.env, VERCEL_OIDC_TOKEN: gatewayToken }
    : process.env;

  const account = resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);

  const rememberedProvider = body?.provider === "openrouter" && account
    ? await readStudioConnectionSecret(account.identity, "openrouter").catch(() => null)
    : null;
  const openRouterKey = requestCredential(request, "x-openrouter-key")
    || rememberedProvider?.credential;
  if (openRouterKey) {
    try {
      const model = body?.model?.trim() || "openrouter/free";
      const plan = alignPlanToRequestedOutput(await runOpenRouter(prompt, openRouterKey, model), prompt);
      return NextResponse.json({
        plan,
        tier: "byok",
        remaining: null,
        access: accessMetadata({ tier: "byok", used: 0, account }),
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return NextResponse.json({
        error: secretFreeRuntimeMessage(error, "OpenRouter planning failed."),
      }, { status: 502 });
    }
  }

  const directProvider = ["openai", "anthropic", "kimi"].includes(body?.provider ?? "") ? body?.provider as DirectProvider : null;
  const rememberedDirect = directProvider && account
    ? await readStudioConnectionSecret(account.identity, directProvider).catch(() => null)
    : null;
  const directKey = requestCredential(request, "x-provider-key")
    || rememberedDirect?.credential;
  if (directProvider && !directKey) {
    return NextResponse.json({ error: `Connect ${directProvider} with an API key before using it.` }, { status: 400 });
  }
  if (directProvider && directKey) {
    const defaults: Record<DirectProvider, string> = {
      openai: "gpt-5.6-sol",
      anthropic: "claude-sonnet-5",
      kimi: "kimi-k3",
    };
    try {
      const model = body?.model?.trim() || defaults[directProvider];
      const plan = alignPlanToRequestedOutput(await runDirectProvider(prompt, directKey, directProvider, model), prompt);
      return NextResponse.json({
        plan,
        tier: "byok",
        remaining: null,
        access: accessMetadata({ tier: "byok", used: 0, account }),
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return NextResponse.json({
        error: secretFreeRuntimeMessage(error, "Connected model planning failed."),
      }, { status: 502 });
    }
  }

  if (account) {
    const readiness = platformAiReadiness("member", readinessEnvironment);
    if (!readiness.available) {
      const fallback = fallbackAgentPlan(prompt);
      return responseWithMemberQuota({
        plan: fallback,
        tier: "fallback",
        model: fallback.model,
        remaining: null,
        access: accessMetadata({ tier: "fallback", used: 0, account }),
        warning: "Signed-in platform AI is not fully configured. The local product compiler created this build without consuming a model allowance.",
      }, account, 0);
    }
    const quota = await consumeFundedBuildQuota({ kind: "account", account });
    const memberTier = quota.tier;
    const memberLimit = quota.limit;
    if (quota.status === "limited") {
      return responseWithMemberQuota({
        error: "Signed-in AI build limit reached.",
        code: "MEMBER_LIMIT",
        remaining: 0,
        connect: "openrouter",
        tier: memberTier,
        access: accessMetadata({
          tier: memberTier,
          used: quota.count ?? memberLimit,
          account,
          platformLimit: memberLimit,
        }),
      }, account, quota.count ?? memberLimit, 429);
    }
    if (quota.status === "unavailable" || quota.count === null) {
      const fallback = fallbackAgentPlan(prompt);
      return responseWithMemberQuota({
        plan: fallback,
        tier: "fallback",
        model: fallback.model,
        remaining: null,
        access: accessMetadata({ tier: "fallback", used: 0, account }),
        warning: "The durable signed-in quota service is temporarily unavailable. The local compiler created this build and no platform model was called.",
      }, account, 0);
    }
    try {
      const result = await runGuestGateway(prompt, account.identity, "member", gatewayToken);
      const plan = alignPlanToRequestedOutput(result.plan, prompt);
      return responseWithMemberQuota({
        plan,
        tier: memberTier,
        model: result.model,
        usage: result.usage,
        remaining: quota.remaining,
        access: accessMetadata({
          tier: memberTier,
          used: quota.count,
          account,
          platformLimit: memberLimit,
        }),
      }, account, quota.count);
    } catch (error) {
      const fallback = fallbackAgentPlan(prompt);
      return responseWithMemberQuota({
        plan: fallback,
        tier: "fallback",
        model: fallback.model,
        remaining: null,
        access: accessMetadata({ tier: "fallback", used: quota.count, account }),
        warning: "Signed-in AI capacity is busy. The local compiler created this build; retry later or use your connected OpenRouter key.",
        detail: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      }, account, quota.count);
    }
  }

  const guest = resolveGuestAccess({
    identityCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
    usageCookie: request.cookies.get(GUEST_USAGE_COOKIE)?.value,
    date: todayUtc(),
  });
  const used = guest.used;
  if (used >= GUEST_DAILY_LIMIT) {
    return responseWithQuota({
      error: "Guest AI build limit reached.",
      code: "GUEST_LIMIT",
      remaining: 0,
      connect: "openrouter",
      access: accessMetadata({ tier: "guest", used }),
    }, guest, used, 429);
  }

  const readiness = platformAiReadiness("guest", readinessEnvironment);
  if (!guest.configured || !guest.identity || !readiness.available) {
    const fallback = fallbackAgentPlan(prompt);
    return responseWithQuota({
      plan: fallback,
      tier: "fallback",
      model: fallback.model,
      remaining: guest.configured ? GUEST_DAILY_LIMIT - used : null,
      access: accessMetadata({ tier: "fallback", used }),
      warning: "Platform-funded AI is not fully configured. The category-aware local compiler still produced a working product; connect your own model to use BYOK.",
    }, guest, used);
  }

  const ipLimit = await consumeRequestLimitState({
    identity: requestIdentity(request),
    namespace: "guest-ai-plan-ip",
    max: GUEST_IP_REQUEST_LIMIT,
    windowMs: 60 * 60 * 1_000,
  });
  if (ipLimit.status !== "allowed") {
    const fallback = fallbackAgentPlan(prompt);
    return responseWithQuota({
      plan: fallback,
      tier: "fallback",
      model: fallback.model,
      remaining: GUEST_DAILY_LIMIT - used,
      access: accessMetadata({ tier: "guest", used }),
      warning: ipLimit.status === "limited"
        ? "This network reached the free AI request ceiling. The local compiler created this build without calling a model."
        : "The free AI request limiter is temporarily unavailable. The local compiler created this build without calling a model.",
    }, guest, used);
  }

  const quota = await consumeFundedBuildQuota({
    kind: "guest",
    identity: guest.identity,
  });
  if (quota.status === "limited") {
    return responseWithQuota({
      error: "Guest AI build limit reached.",
      code: "GUEST_LIMIT",
      remaining: 0,
      connect: "openrouter",
      access: accessMetadata({ tier: "guest", used: GUEST_DAILY_LIMIT }),
    }, guest, GUEST_DAILY_LIMIT, 429);
  }
  if (quota.status === "unavailable" || quota.count === null) {
    const fallback = fallbackAgentPlan(prompt);
    return responseWithQuota({
      plan: fallback,
      tier: "fallback",
      model: fallback.model,
      remaining: GUEST_DAILY_LIMIT - used,
      access: accessMetadata({ tier: "guest", used }),
      warning: "The free AI allowance could not be reserved safely. The local compiler created this build without calling a model.",
    }, guest, used);
  }
  const consumedUsed = Math.min(GUEST_DAILY_LIMIT, quota.count);

  try {
    const result = await runGuestGateway(prompt, guest.identity, "guest", gatewayToken);
    const plan = alignPlanToRequestedOutput(result.plan, prompt);
    return responseWithQuota({
      plan,
      tier: "guest",
      model: result.model,
      usage: result.usage,
      remaining: quota.remaining,
      access: accessMetadata({ tier: "guest", used: consumedUsed }),
    }, guest, consumedUsed);
  } catch (error) {
    const fallback = fallbackAgentPlan(prompt);
    return responseWithQuota({
      plan: fallback,
      tier: "fallback",
      model: fallback.model,
      remaining: quota.remaining,
      access: accessMetadata({ tier: "guest", used: consumedUsed }),
      warning: "Free AI capacity is busy. A category-aware local product compiler produced this build; retry AI or connect OpenRouter for a fresh model result.",
      detail: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
    }, guest, consumedUsed);
  }
}
