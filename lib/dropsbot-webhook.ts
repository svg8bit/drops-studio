import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const DROPSBOT_WEBHOOK_BODY_LIMIT_BYTES = 64 * 1_024;
export const DROPSBOT_WEBHOOK_CREATE_BODY_LIMIT_BYTES = 4 * 1_024;
export const DROPSBOT_WEBHOOK_REDACTED = "[REDACTED]";

export type DropsBotJsonPrimitive = boolean | number | string | null;
export type DropsBotJsonValue =
  | DropsBotJsonPrimitive
  | DropsBotJsonValue[]
  | DropsBotJsonObject;

export interface DropsBotJsonObject {
  [key: string]: DropsBotJsonValue;
}

export interface DropsBotWebhookEvent {
  id: string;
  contentHash: string;
  receivedAt: string;
  payload: DropsBotJsonObject;
}

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 4_096;

const credentialFieldNames = new Set([
  "apikey",
  "accesskey",
  "accesstoken",
  "authtoken",
  "authorization",
  "bottoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "signature",
]);

const secretValuePatterns = [
  /^\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}\s*$/i,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:sk-(?:(?:proj|ant|or-v1)-)?[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/,
];

export class DropsBotWebhookValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "DROPSBOT_WEBHOOK_INVALID") {
    super(message);
    this.name = "DropsBotWebhookValidationError";
    this.status = status;
    this.code = code;
  }
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function credentialField(value: string): boolean {
  const normalized = normalizeFieldName(value);
  return credentialFieldNames.has(normalized)
    || [
      "apikey",
      "accesskey",
      "accesstoken",
      "authtoken",
      "bottoken",
      "clientsecret",
      "privatekey",
      "refreshtoken",
    ].some((suffix) => normalized.endsWith(suffix))
    || [
      "authorization",
      "credential",
      "password",
      "secret",
    ].some((fragment) => normalized.includes(fragment));
}

function secretString(value: string, sensitiveValues: readonly string[]): boolean {
  return sensitiveValues.some((secret) => secret.length >= 16 && value.includes(secret))
    || secretValuePatterns.some((pattern) => pattern.test(value));
}

function redactJsonValue(
  value: unknown,
  state: { nodes: number; sensitiveValues: readonly string[] },
  depth: number,
): DropsBotJsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new DropsBotWebhookValidationError(
      "Drops Bot callback JSON is too deeply nested or complex.",
      400,
      "DROPSBOT_WEBHOOK_COMPLEXITY_LIMIT",
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DropsBotWebhookValidationError("Drops Bot callback JSON contains a non-finite number.");
    }
    return value;
  }
  if (typeof value === "string") {
    return secretString(value, state.sensitiveValues) ? DROPSBOT_WEBHOOK_REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, state, depth + 1));
  }
  if (!value || typeof value !== "object") {
    throw new DropsBotWebhookValidationError("Drops Bot callback payload must contain JSON-compatible values.");
  }

  const output: DropsBotJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const redacted = credentialField(key)
      ? DROPSBOT_WEBHOOK_REDACTED
      : redactJsonValue(item, state, depth + 1);
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: redacted,
      writable: true,
    });
  }
  return output;
}

export function redactDropsBotWebhookPayload(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): DropsBotJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DropsBotWebhookValidationError("Drops Bot callback requires a JSON object.");
  }
  return redactJsonValue(value, { nodes: 0, sensitiveValues }, 0) as DropsBotJsonObject;
}

export function createDropsBotWebhookCapability(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashDropsBotWebhookCapability(secret) };
}

export function hashDropsBotWebhookCapability(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyDropsBotWebhookCapability(secret: string, expectedHash: string): boolean {
  return CAPABILITY_PATTERN.test(secret)
    && hashesMatch(hashDropsBotWebhookCapability(secret), expectedHash);
}

export function validDropsBotWebhookCapability(secret: string): boolean {
  return CAPABILITY_PATTERN.test(secret);
}

export function validDropsBotWebhookHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

export function hashDropsBotWebhookContent(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function dropsBotWebhookEventId(connectionId: string, contentHash: string): string {
  const digest = createHash("sha256")
    .update(`dropsbot-event:${connectionId}:${contentHash}`, "utf8")
    .digest("hex");
  return `evt_${digest.slice(0, 32)}`;
}

export async function readDropsBotWebhookBody(
  request: Request,
  limit = DROPSBOT_WEBHOOK_BODY_LIMIT_BYTES,
): Promise<Uint8Array> {
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader) {
    const declaredLength = Number(declaredHeader);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      throw new DropsBotWebhookValidationError(
        "Drops Bot callback Content-Length is invalid.",
        400,
        "DROPSBOT_WEBHOOK_INVALID_LENGTH",
      );
    }
    if (declaredLength > limit) {
      throw new DropsBotWebhookValidationError(
        "Drops Bot callback payload is too large.",
        413,
        "DROPSBOT_WEBHOOK_TOO_LARGE",
      );
    }
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
    if (byteLength > limit) {
      await reader.cancel().catch(() => undefined);
      throw new DropsBotWebhookValidationError(
        "Drops Bot callback payload is too large.",
        413,
        "DROPSBOT_WEBHOOK_TOO_LARGE",
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

export function parseDropsBotWebhookPayload(
  raw: Uint8Array,
  sensitiveValues: readonly string[] = [],
): DropsBotJsonObject {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new DropsBotWebhookValidationError("Drops Bot callback body must be valid UTF-8 JSON.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new DropsBotWebhookValidationError("Drops Bot callback body must be valid JSON.");
  }
  return redactDropsBotWebhookPayload(parsed, sensitiveValues);
}
