import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { code?: string; codeVerifier?: string } | null;
  const code = body?.code?.trim() ?? "";
  const codeVerifier = body?.codeVerifier?.trim() ?? "";

  if (!code || !codeVerifier || code.length > 2_048 || codeVerifier.length > 256) {
    return NextResponse.json({ error: "Invalid OpenRouter authorization response." }, { status: 400 });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        code_challenge_method: "S256",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { key?: string; error?: { message?: string }; message?: string };
    if (!response.ok || !payload.key) {
      return NextResponse.json(
        { error: payload.error?.message ?? payload.message ?? "OpenRouter authorization failed." },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 },
      );
    }

    // The key is returned once to the initiating browser and is never persisted server-side.
    return NextResponse.json({ key: payload.key }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OpenRouter authorization failed." },
      { status: 502 },
    );
  }
}
