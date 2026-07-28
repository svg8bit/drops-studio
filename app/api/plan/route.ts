import { NextRequest, NextResponse } from "next/server";

const presetIds = ["action-engine", "alpha-channel", "morning-alpha", "prediction-impact", "smart-money-copy", "crypto-aggregator", "crypto-game", "personal-companion", "portfolio-tamagotchi", "crypto-product-hunt", "crypto-radio", "crypto-siri"] as const;
const toolIds = ["prices", "unlocks", "wallets", "polymarket", "telegram", "voice"] as const;

const system = `You are the planning brain inside Drops Studio. Map the user's crypto product idea to one useful editable blueprint. Return JSON only, with this exact shape: {"presetId":"one allowed id","tools":["allowed tool ids"]}. Allowed presetId values: ${presetIds.join(", ")}. Allowed tools: ${toolIds.join(", ")}. Use only tools needed for the idea. Never include prose, markdown, trading advice, returns, or claims of execution.`;

function parsePlan(text: string) {
  const object = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { presetId?: string; tools?: string[] };
  if (!presetIds.includes(object.presetId as typeof presetIds[number])) throw new Error("Invalid preset");
  return {
    presetId: object.presetId,
    tools: Array.isArray(object.tools) ? object.tools.filter((tool) => toolIds.includes(tool as typeof toolIds[number])) : [],
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { provider?: string; key?: string; model?: string | null; prompt?: string } | null;
  const provider = body?.provider;
  const key = body?.key?.trim();
  const prompt = body?.prompt?.trim();
  if (!provider || !key || !prompt) return NextResponse.json({ error: "Provider, key and prompt are required." }, { status: 400 });
  if (prompt.length > 2_000) return NextResponse.json({ error: "Keep the project description under 2,000 characters." }, { status: 400 });

  try {
    let response: Response;
    if (provider === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: body?.model || "claude-haiku-4-5-20251001", max_tokens: 220, temperature: 0.1, system, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({})) as { content?: Array<{ text?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? `Anthropic returned ${response.status}.`);
      return NextResponse.json({ plan: parsePlan(payload.content?.[0]?.text ?? "{}"), provider });
    }

    const config: { url: string; model: string; extra: Record<string, string> } | null = provider === "openai"
      ? { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini", extra: {} }
      : provider === "openrouter"
        ? { url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/auto", extra: { "HTTP-Referer": request.nextUrl.origin, "X-OpenRouter-Title": "Drops Studio" } }
        : provider === "kimi"
          ? { url: "https://api.moonshot.ai/v1/chat/completions", model: "kimi-k3", extra: {} }
          : null;
    if (!config) return NextResponse.json({ error: "Unsupported planning provider." }, { status: 400 });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...config.extra,
    };

    response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: body?.model || config.model, temperature: 0.1, max_tokens: 220, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `${provider} returned ${response.status}.`);
    return NextResponse.json({ plan: parsePlan(payload.choices?.[0]?.message?.content ?? "{}"), provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI planning failed." }, { status: 502 });
  }
}
