export const modelProviderIds = [
  "openai",
  "anthropic",
  "openrouter",
  "kimi",
] as const;

export type ModelProviderId = (typeof modelProviderIds)[number];

export interface ProviderModelCatalog {
  models: string[];
  totalModelCount: number;
  modelsTruncated: boolean;
  verifiedAt: string;
}

export const MAX_PROVIDER_MODELS = 500;

const modelProviderSet = new Set<string>(modelProviderIds);

export function isModelProviderId(value: string): value is ModelProviderId {
  return modelProviderSet.has(value);
}

function modelIdFrom(value: unknown): string | null {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "id" in value
        ? (value as { id?: unknown }).id
        : null;
  if (typeof candidate !== "string") return null;
  const id = candidate.trim();
  if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function compareModelIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeProviderModelPayload(
  payload: unknown,
  limit = MAX_PROVIDER_MODELS,
): {
  models: string[];
  totalModelCount: number;
  modelsTruncated: boolean;
} {
  const record =
    payload && typeof payload === "object"
      ? (payload as { data?: unknown; models?: unknown })
      : null;
  const source = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.models)
      ? record.models
      : [];
  const unique = new Set<string>();
  for (const value of source) {
    const id = modelIdFrom(value);
    if (id) unique.add(id);
  }
  const allModels = [...unique].sort(compareModelIds);
  const safeLimit = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(limit, MAX_PROVIDER_MODELS))
    : MAX_PROVIDER_MODELS;
  const models = allModels.slice(0, safeLimit);
  return {
    models,
    totalModelCount: allModels.length,
    modelsTruncated: models.length < allModels.length,
  };
}

export function normalizeProviderModelCatalog(
  value: unknown,
  verifiedAt = new Date().toISOString(),
): ProviderModelCatalog | null {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    models?: unknown;
    totalModelCount?: unknown;
    modelCount?: unknown;
    modelsTruncated?: unknown;
    verifiedAt?: unknown;
  };
  if (!Array.isArray(record.models)) return null;

  const normalized = normalizeProviderModelPayload({ models: record.models });
  const declaredCount = Number(
    record.totalModelCount ?? record.modelCount ?? normalized.totalModelCount,
  );
  const totalModelCount =
    Number.isSafeInteger(declaredCount) && declaredCount >= 0
      ? Math.max(declaredCount, normalized.models.length)
      : normalized.totalModelCount;
  const catalogVerifiedAt =
    typeof record.verifiedAt === "string" && record.verifiedAt.trim()
      ? record.verifiedAt
      : verifiedAt;

  return {
    models: normalized.models,
    totalModelCount,
    modelsTruncated:
      record.modelsTruncated === true ||
      normalized.modelsTruncated ||
      totalModelCount > normalized.models.length,
    verifiedAt: catalogVerifiedAt,
  };
}

export function providerModelCatalogStorageKey(
  provider: ModelProviderId,
): string {
  return `drops-studio:${provider}:models`;
}
