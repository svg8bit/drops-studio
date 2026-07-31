const RECEIPT_PATH = "drops-studio/platform-health/v1/latest.json";
const MAX_RECEIPT_BYTES = 32 * 1_024;

export type PlatformHealthCheckId =
  | "sandbox"
  | "project-data"
  | "managed-backend"
  | "organizations"
  | "collaboration"
  | "enterprise-identity"
  | "audit-backup"
  | "github"
  | "deployment";

export interface PlatformProviderHealthCheck {
  status: "working" | "unavailable";
  mode: string;
  detail: string;
  evidence: string[];
  latencyMs?: number;
}

export interface PlatformHealthReceiptBundle {
  schemaVersion: 1;
  environment: "development" | "preview" | "production";
  checkedAt: string;
  expiresAt: string;
  checks: Partial<Record<PlatformHealthCheckId, PlatformProviderHealthCheck>>;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function safeText(value: unknown, limit: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= limit
    && !/[\0\r\n]/.test(value);
}

function validCheck(value: unknown): value is PlatformProviderHealthCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const check = value as Partial<PlatformProviderHealthCheck>;
  return (
    (check.status === "working" || check.status === "unavailable")
    && safeText(check.mode, 96)
    && safeText(check.detail, 500)
    && Array.isArray(check.evidence)
    && check.evidence.length <= 16
    && check.evidence.every((item) => safeText(item, 120))
    && (
      check.latencyMs === undefined
      || (
        Number.isSafeInteger(check.latencyMs)
        && check.latencyMs >= 0
        && check.latencyMs <= 300_000
      )
    )
  );
}

export function validatePlatformHealthReceipt(
  value: unknown,
): PlatformHealthReceiptBundle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Partial<PlatformHealthReceiptBundle>;
  if (
    receipt.schemaVersion !== 1
    || !["development", "preview", "production"].includes(String(receipt.environment))
    || !validDate(receipt.checkedAt)
    || !validDate(receipt.expiresAt)
    || Date.parse(receipt.expiresAt) <= Date.parse(receipt.checkedAt)
    || !receipt.checks
    || typeof receipt.checks !== "object"
    || Array.isArray(receipt.checks)
  ) {
    return null;
  }
  const allowed = new Set<PlatformHealthCheckId>([
    "sandbox",
    "project-data",
    "managed-backend",
    "organizations",
    "collaboration",
    "enterprise-identity",
    "audit-backup",
    "github",
    "deployment",
  ]);
  for (const [id, check] of Object.entries(receipt.checks)) {
    if (!allowed.has(id as PlatformHealthCheckId) || !validCheck(check)) return null;
  }
  return structuredClone(receipt as PlatformHealthReceiptBundle);
}

export async function readPlatformHealthReceipt(): Promise<PlatformHealthReceiptBundle | null> {
  try {
    const { get } = await import("@vercel/blob");
    const current = await get(RECEIPT_PATH, { access: "private", useCache: false });
    if (!current || current.statusCode !== 200 || current.blob.size > MAX_RECEIPT_BYTES) {
      return null;
    }
    const parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
    return validatePlatformHealthReceipt(parsed);
  } catch {
    return null;
  }
}

export async function writePlatformHealthReceipt(
  receiptInput: PlatformHealthReceiptBundle,
): Promise<void> {
  const receipt = validatePlatformHealthReceipt(receiptInput);
  if (!receipt) throw new Error("Platform health receipt is invalid.");
  const body = JSON.stringify(receipt);
  if (new TextEncoder().encode(body).byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("Platform health receipt exceeds its storage boundary.");
  }
  const { put } = await import("@vercel/blob");
  await put(RECEIPT_PATH, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}
