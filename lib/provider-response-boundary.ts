export class ProviderResponseBoundaryError extends Error {
  readonly reason: "invalid" | "too-large";

  constructor(reason: "invalid" | "too-large") {
    super(
      reason === "too-large"
        ? "Provider response exceeded the bounded size."
        : "Provider response was not valid JSON.",
    );
    this.name = "ProviderResponseBoundaryError";
    this.reason = reason;
  }
}

export async function readBoundedProviderJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1_024 * 1_024) {
    throw new Error("Provider response limit is invalid.");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderResponseBoundaryError("too-large");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderResponseBoundaryError("too-large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown;
  } catch (error) {
    if (error instanceof ProviderResponseBoundaryError) throw error;
    throw new ProviderResponseBoundaryError("invalid");
  }
}
