import { NextRequest, NextResponse } from "next/server.js";

export const TELEGRAM_ACCOUNT_BODY_LIMIT_BYTES = 16 * 1024;

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
};

export class TelegramAccountRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TelegramAccountRequestError";
    this.status = status;
  }
}

export function telegramAccountJson(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export function telegramAccountRequestErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof TelegramAccountRequestError)) throw error;
  return telegramAccountJson({ error: error.message }, error.status);
}

function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new TelegramAccountRequestError(
      403,
      "Cross-origin Telegram account actions are not accepted.",
    );
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    throw new TelegramAccountRequestError(
      403,
      "A same-origin Telegram account request is required.",
    );
  }

  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error();
  } catch {
    throw new TelegramAccountRequestError(
      403,
      "Cross-origin Telegram account actions are not accepted.",
    );
  }
}

function requireJsonContentType(request: NextRequest): void {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new TelegramAccountRequestError(
      415,
      "Telegram account requests require application/json.",
    );
  }
}

function declaredBodyLength(request: NextRequest): number | null {
  const header = request.headers.get("content-length");
  if (header === null) return null;
  const normalized = header.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new TelegramAccountRequestError(
      400,
      "Telegram account request Content-Length is invalid.",
    );
  }
  const length = Number(normalized);
  if (!Number.isSafeInteger(length)) {
    throw new TelegramAccountRequestError(
      400,
      "Telegram account request Content-Length is invalid.",
    );
  }
  return length;
}

async function readBoundedBody(request: NextRequest): Promise<Uint8Array> {
  const declaredLength = declaredBodyLength(request);
  if (
    declaredLength !== null
    && declaredLength > TELEGRAM_ACCOUNT_BODY_LIMIT_BYTES
  ) {
    throw new TelegramAccountRequestError(
      413,
      "Telegram account request payload is too large.",
    );
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    byteLength += value.byteLength;
    if (byteLength > TELEGRAM_ACCOUNT_BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new TelegramAccountRequestError(
        413,
        "Telegram account request payload is too large.",
      );
    }
    chunks.push(value);
  }

  const raw = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export async function readTelegramAccountJson(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  requireJsonContentType(request);
  const raw = await readBoundedBody(request);

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    ) as unknown;
  } catch {
    throw new TelegramAccountRequestError(
      400,
      "Telegram account requests require a valid JSON body.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TelegramAccountRequestError(
      400,
      "Telegram account requests require a JSON object.",
    );
  }
  return parsed as Record<string, unknown>;
}
