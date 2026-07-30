export type RequestBodyBoundaryReason =
  | "invalid-length"
  | "too-large"
  | "unreadable";

export class RequestBodyBoundaryError extends Error {
  readonly reason: RequestBodyBoundaryReason;

  constructor(reason: RequestBodyBoundaryReason) {
    super(`Request body is ${reason}.`);
    this.name = "RequestBodyBoundaryError";
    this.reason = reason;
  }
}

export function hasJsonMediaType(request: Pick<Request, "headers">): boolean {
  const value = request.headers.get("content-type");
  if (!value) return false;
  const [essence] = value.split(";", 1);
  return essence.trim().toLowerCase() === "application/json";
}

export async function readBoundedRequestBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("A non-negative safe request body limit is required.");
  }

  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader !== null) {
    const normalized = declaredHeader.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new RequestBodyBoundaryError("invalid-length");
    }
    const declared = Number(normalized);
    if (!Number.isSafeInteger(declared)) {
      throw new RequestBodyBoundaryError("too-large");
    }
    if (declared > maxBytes) {
      throw new RequestBodyBoundaryError("too-large");
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyBoundaryError("too-large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new RequestBodyBoundaryError("unreadable");
  }

  const raw = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export function decodeUtf8Body(raw: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new RequestBodyBoundaryError("unreadable");
  }
}
