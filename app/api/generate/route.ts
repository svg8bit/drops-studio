import { NextRequest, NextResponse } from "next/server";
import {
  runBuildRun,
  runValidatedBuild,
  type BuildRunModelCall,
} from "@/lib/build-run";
import type { GeneratedProjectSpec, ProjectProvider } from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import {
  consumeRequestLimit,
  requestIdentity,
} from "@/lib/request-rate-limit";

const system = `You are the bounded Experience Director inside Drops Studio. Improve an already functional crypto product while preserving its preset, DropsTab and Drops Bot foundations, data contracts, security model and executable behavior. When the task is repair, fix only the reported release-inspection failures. Return JSON only. Allowed fields: {"name":"max 64 chars","tagline":"max 120 chars","description":"max 360 chars","theme":{"accent":"#RRGGBB","surface":"#RRGGBB","mode":"dark|light|hybrid","style":"precision|cosmic|editorial|playful"},"design":{"kit":"drops-precision|neon-arena|mascot-pop|glass-signal|editorial-alpha|terminal-pro","density":"compact|comfortable|cinematic","motion":"reduced|smooth|expressive","radius":0-32,"font":"inter|space-grotesk|ibm-plex"},"experience":{"layout":"focus|split|dashboard|feed|spatial","dataView":"cards|table|timeline|graph|map","engagement":"realtime|scheduled|social|personal","audience":"max 120 chars","primaryLoop":"max 240 chars","modules":["max 12 short module names"]},"gameDirection":{"genre":"market-race|coin-quiz|portfolio-battle|unlock-dodge|catcher","artStyle":"3d-toy|comic|pixel|neon|retro-cartoon","world":"cloud-city|space-exchange|token-island|cyber-arcade|retro-factory","mascot":"coin-crew|rocket-pets|market-monsters|retro-wolf|no-mascot","gameLoop":"max 240 chars","difficulty":"casual|normal|expert","roundSeconds":5-120,"sound":true}}. Omit gameDirection for non-game products. Never return HTML, JavaScript, markdown, API keys, URLs, trading promises, financial advice, or claims of automatic execution.`;

const supportedProviders = new Set<ProjectProvider>(["openai", "anthropic", "openrouter", "kimi"]);
const MAX_GENERATE_BODY_BYTES = 512 * 1_024;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .replace(/:$/, "");
    const protocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, "");
    const requestHostOrigin = host ? `${protocol}://${host}` : null;

    // Next can canonicalize `nextUrl` to localhost in a local production
    // server even when the browser reached the same server through 127.0.0.1.
    // The received Host header represents the browser-visible origin and keeps
    // the CSRF boundary intact: a foreign Origin still cannot match it.
    return (
      originUrl.origin === request.nextUrl.origin ||
      originUrl.origin === requestHostOrigin
    );
  } catch {
    return false;
  }
}

function safeProviderFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Model build failed.";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 180) || "Model build failed.";
}

function parseEnhancement(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model did not return a project design object.");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid project design response.");
  return parsed;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin build requests are not allowed." }, 403);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATE_BODY_BYTES) {
    return json({ error: "Build request is too large." }, 413);
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_GENERATE_BODY_BYTES) {
    return json({ error: "Build request is too large." }, 413);
  }
  const body = (() => {
    try {
      return JSON.parse(rawBody) as {
    provider?: string;
    key?: string;
    model?: string;
    prompt?: string;
    spec?: unknown;
      };
    } catch {
      return null;
    }
  })();
  if (!body?.spec) return json({ error: "A validated project spec is required." }, 400);
  const provider = body?.provider;
  const key = body?.key?.trim();
  const prompt = body?.prompt?.trim() || "Polish this product for a premium crypto audience.";
  if (prompt.length > 2_000) return json({ error: "Keep instructions under 2,000 characters." }, 400);
  let spec: GeneratedProjectSpec;
  try {
    spec = validateProjectSpec(body.spec);
  } catch {
    return json({ error: "Project spec must be a valid object." }, 400);
  }

  const limit = await consumeRequestLimit({
    identity: requestIdentity(request),
    namespace: "project-build-run",
    max: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL ? 300 : 60,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return json({ error: "Too many build runs. Try again shortly." }, 429);
  }
  if (limit === "unavailable" && process.env.NODE_ENV === "production") {
    return json({ error: "The secure build runner is temporarily unavailable." }, 503);
  }

  if (!provider || provider === "free" || provider === "gateway") {
    try {
      const result = await runValidatedBuild({ spec });
      return json({
        spec: result.spec,
        quality: result.quality,
        run: result.run,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    } catch (error) {
      return json({ error: safeProviderFailure(error) }, 422);
    }
  }
  if (!supportedProviders.has(provider as ProjectProvider)) return json({ error: "Unsupported enhancement provider." }, 400);
  if (!key || key.length > 4_096) return json({ error: "A valid provider API key is required." }, 400);
  const selectedProvider = provider as ProjectProvider;
  const defaultModels: Record<string, string> = {
    openai: "gpt-5.6-sol",
    anthropic: "claude-sonnet-5",
    openrouter: "openrouter/free",
    kimi: "kimi-k3",
  };
  const effectiveModel = body.model?.trim() || defaultModels[provider] || spec.brain.model;

  try {
    const callModel = async ({ mode, spec: currentSpec, criticalFailures, signal }: BuildRunModelCall): Promise<Record<string, unknown>> => {
      const user = JSON.stringify({
        task: mode,
        instruction: prompt,
        ...(mode === "repair" ? {
          releaseInspection: {
            failedChecks: criticalFailures,
            directive: "Repair the failed checks without changing the product category, data contracts or approval boundaries.",
          },
        } : {}),
        product: {
          presetId: currentSpec.presetId,
          name: currentSpec.name,
          tagline: currentSpec.tagline,
          description: currentSpec.description,
          values: currentSpec.values,
          theme: currentSpec.theme,
          design: currentSpec.design,
          experience: { ...currentSpec.experience, backgroundImage: undefined },
          gameDirection: currentSpec.gameDirection ? { ...currentSpec.gameDirection, backgroundImage: undefined } : undefined,
        },
      });
      let text = "";
      if (selectedProvider === "anthropic") {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: effectiveModel, max_tokens: 900, temperature: 0.25, system, messages: [{ role: "user", content: user }] }),
          signal,
        });
        const payload = await response.json().catch(() => ({})) as { content?: Array<{ text?: string }>; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? `Anthropic returned ${response.status}.`);
        text = payload.content?.[0]?.text ?? "";
      } else {
        const config = selectedProvider === "openai"
          ? { url: "https://api.openai.com/v1/chat/completions", headers: {} }
          : selectedProvider === "openrouter"
            ? { url: "https://openrouter.ai/api/v1/chat/completions", headers: { "HTTP-Referer": request.nextUrl.origin, "X-OpenRouter-Title": "Drops Studio" } }
            : { url: "https://api.moonshot.ai/v1/chat/completions", headers: {} };
        const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${key}` };
        Object.assign(headers, config.headers);
        const openAiUsesCompletionTokens = selectedProvider === "openai"
          && (/^gpt-5(?:\.|-|$)/i.test(effectiveModel) || /^o\d+(?:\.|-|$)/i.test(effectiveModel));
        const response = await fetch(config.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: effectiveModel,
            ...(openAiUsesCompletionTokens ? { max_completion_tokens: 900 } : { temperature: 0.25, max_tokens: 900 }),
            ...(selectedProvider === "openai" ? { response_format: { type: "json_object" } } : {}),
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }),
          signal,
        });
        const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? `${selectedProvider} returned ${response.status}.`);
        text = payload.choices?.[0]?.message?.content ?? "";
      }
      return parseEnhancement(text);
    };

    const result = await runBuildRun({
      spec,
      prompt,
      provider: selectedProvider,
      model: effectiveModel,
      callModel,
    });
    return json({
      spec: result.spec,
      quality: result.quality,
      run: result.run,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    return json({ error: safeProviderFailure(error) }, 502);
  }
}
