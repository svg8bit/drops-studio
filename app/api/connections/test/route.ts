import { NextRequest, NextResponse } from "next/server";
import { normalizeProviderModelPayload } from "@/lib/provider-models";

const providers = {
  openai: { url: "https://api.openai.com/v1/models", headers: (key: string) => ({ authorization: `Bearer ${key}` }) },
  anthropic: { url: "https://api.anthropic.com/v1/models", headers: (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }) },
  openrouter: { url: "https://openrouter.ai/api/v1/models", headers: (key: string) => ({ authorization: `Bearer ${key}` }) },
  kimi: { url: "https://api.moonshot.ai/v1/models", headers: (key: string) => ({ authorization: `Bearer ${key}` }) },
} as const;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { provider?: string; key?: string; endpoint?: string } | null;
  const provider = body?.provider;
  const key = body?.key?.trim();
  if (!provider || !key) return NextResponse.json({ error: "Provider and API key are required." }, { status: 400 });

  let url: string;
  let headers: Record<string, string>;
  if (provider in providers) {
    const config = providers[provider as keyof typeof providers];
    url = config.url;
    headers = config.headers(key);
  } else {
    return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
  }

  try {
    const response = await fetch(url, { headers: { ...headers, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return NextResponse.json({ error: response.status === 401 || response.status === 403 ? "The provider rejected this key." : `Provider returned ${response.status}.` }, { status: 400 });
    const payload = await response.json().catch(() => ({}));
    const catalog = normalizeProviderModelPayload(payload);
    return NextResponse.json({
      ok: true,
      provider,
      modelCount: catalog.totalModelCount,
      ...catalog,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The provider could not be reached within 10 seconds." }, { status: 502 });
  }
}
