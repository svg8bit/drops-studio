export type StudioAccountConnectionProvider =
  | "dropstab"
  | "dropsbot"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "kimi"
  | "custom"
  | "telegram";

export interface StudioAccountConnectionView {
  provider: StudioAccountConnectionProvider;
  connected: boolean;
  model?: string;
  endpointHost?: string;
  label?: string;
  updatedAt?: string;
}

export interface StudioAccountSnapshot {
  authenticated: boolean;
  profile: {
    provider: "google" | "openrouter";
    name: string;
    email?: string;
    picture?: string;
  } | null;
  connections: StudioAccountConnectionView[];
  vaultAvailable: boolean;
  error?: string;
}

export interface RememberStudioConnectionInput {
  provider: StudioAccountConnectionProvider;
  credential: string;
  model?: string;
  endpoint?: string;
  label?: string;
}

export interface RememberStudioConnectionResult {
  saved: boolean;
  connections: StudioAccountConnectionView[];
  error?: string;
  retryable?: boolean;
}

export interface ForgetStudioConnectionResult {
  deleted: boolean;
  connections: StudioAccountConnectionView[];
  error?: string;
  retryable?: boolean;
}

interface StudioAccountRequestOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const STUDIO_ACCOUNT_REQUEST_TIMEOUT_MS = 10_000;

const MODEL_CONNECTION_PROVIDERS = [
  "openai",
  "anthropic",
  "openrouter",
  "kimi",
  "custom",
] as const;

type StudioAccountModelProvider = (typeof MODEL_CONNECTION_PROVIDERS)[number];

export class StudioAccountSnapshotError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "StudioAccountSnapshotError";
    this.status = options.status;
    this.retryable = options.retryable === true;
  }
}

function accountPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function connectionViews(value: unknown): StudioAccountConnectionView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): StudioAccountConnectionView[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const provider = candidate.provider;
    if (
      typeof provider !== "string"
      || ![
        "dropstab",
        "dropsbot",
        "openai",
        "anthropic",
        "openrouter",
        "kimi",
        "custom",
        "telegram",
      ].includes(provider)
      || typeof candidate.connected !== "boolean"
    ) return [];
    const optionalText = (field: "model" | "endpointHost" | "label") =>
      typeof candidate[field] === "string" && candidate[field].trim()
        ? candidate[field].trim()
        : undefined;
    const updatedAt = typeof candidate.updatedAt === "string"
      && Number.isFinite(Date.parse(candidate.updatedAt))
      ? candidate.updatedAt
      : undefined;
    return [{
      provider: provider as StudioAccountConnectionProvider,
      connected: candidate.connected,
      ...(optionalText("model") ? { model: optionalText("model") } : {}),
      ...(optionalText("endpointHost") ? { endpointHost: optionalText("endpointHost") } : {}),
      ...(optionalText("label") ? { label: optionalText("label") } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    }];
  });
}

function requestAttempts(options: StudioAccountRequestOptions): number {
  const requested = options.maxAttempts ?? 3;
  return Number.isSafeInteger(requested) ? Math.min(3, Math.max(1, requested)) : 3;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function accountError(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : fallback;
}

async function retryPause(attempt: number, options: StudioAccountRequestOptions): Promise<void> {
  const base = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, Number(options.retryDelayMs))
    : 120;
  if (!base) return;
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, Math.min(600, base * 2 ** attempt));
  });
}

export function preferredRememberedModelProvider(
  connections: StudioAccountConnectionView[],
  current?: string | null,
): StudioAccountModelProvider | null {
  const connected = connections.filter(
    (connection): connection is StudioAccountConnectionView & {
      provider: StudioAccountModelProvider;
    } => connection.connected
      && (MODEL_CONNECTION_PROVIDERS as readonly string[]).includes(connection.provider),
  );
  if (
    current
    && (MODEL_CONNECTION_PROVIDERS as readonly string[]).includes(current)
    && connected.some((connection) => connection.provider === current)
  ) return current as StudioAccountModelProvider;
  return connected
    .slice()
    .sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTime - leftTime;
    })[0]?.provider ?? null;
}

export async function readStudioAccountSnapshot(
  options: StudioAccountRequestOptions = {},
): Promise<StudioAccountSnapshot> {
  const attempts = requestAttempts(options);
  let lastError: StudioAccountSnapshotError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch("/api/account", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(STUDIO_ACCOUNT_REQUEST_TIMEOUT_MS),
      });
      const payload = accountPayload(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new StudioAccountSnapshotError(
          accountError(payload, "Studio account connections are temporarily unavailable."),
          { status: response.status, retryable: retryableStatus(response.status) },
        );
      }
      const profile = payload.profile && typeof payload.profile === "object"
        ? (payload.profile as StudioAccountSnapshot["profile"])
        : null;
      const authenticated = payload.authenticated === true;
      return {
        authenticated,
        profile,
        connections: connectionViews(payload.connections),
        vaultAvailable:
          payload.vault !== null
          && typeof payload.vault === "object"
          && (payload.vault as { available?: unknown }).available === true,
        ...(typeof payload.error === "string" ? { error: payload.error } : {}),
      };
    } catch (error) {
      lastError = error instanceof StudioAccountSnapshotError
        ? error
        : new StudioAccountSnapshotError(
          "Studio account connections are temporarily unavailable.",
          { retryable: true },
        );
      if (!lastError.retryable || attempt + 1 >= attempts) throw lastError;
      await retryPause(attempt, options);
    }
  }
  throw lastError ?? new StudioAccountSnapshotError(
    "Studio account connections are temporarily unavailable.",
  );
}

export async function rememberStudioConnection(
  input: RememberStudioConnectionInput,
  options: StudioAccountRequestOptions = {},
): Promise<RememberStudioConnectionResult> {
  const attempts = requestAttempts(options);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch("/api/account/connections", {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(STUDIO_ACCOUNT_REQUEST_TIMEOUT_MS),
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!response) {
      if (attempt + 1 < attempts) {
        await retryPause(attempt, options);
        continue;
      }
      return {
        saved: false,
        connections: [],
        error: "The encrypted account vault is temporarily unreachable.",
        retryable: true,
      };
    }
    const payload = accountPayload(await response.json().catch(() => ({})));
    const saved = response.ok && payload.saved === true;
    const retryable = !saved && retryableStatus(response.status);
    if (retryable && attempt + 1 < attempts) {
      await retryPause(attempt, options);
      continue;
    }
    return {
      saved,
      connections: connectionViews(payload.connections),
      ...(!saved ? {
        error: accountError(
          payload,
          retryable
            ? "The encrypted account vault is temporarily unreachable."
            : "The connection could not be encrypted for this account.",
        ),
        retryable,
      } : {}),
    };
  }
  return {
    saved: false,
    connections: [],
    error: "The encrypted account vault is temporarily unreachable.",
    retryable: true,
  };
}

export async function forgetStudioConnection(
  provider: StudioAccountConnectionProvider,
  options: StudioAccountRequestOptions = {},
): Promise<ForgetStudioConnectionResult> {
  const attempts = requestAttempts(options);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `/api/account/connections?provider=${encodeURIComponent(provider)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(STUDIO_ACCOUNT_REQUEST_TIMEOUT_MS),
      },
    ).catch(() => null);
    if (!response) {
      if (attempt + 1 < attempts) {
        await retryPause(attempt, options);
        continue;
      }
      return {
        deleted: false,
        connections: [],
        error: "The encrypted account vault is temporarily unreachable.",
        retryable: true,
      };
    }
    const payload = accountPayload(await response.json().catch(() => ({})));
    const deleted = response.ok && payload.deleted === true;
    const retryable = !deleted && retryableStatus(response.status);
    if (retryable && attempt + 1 < attempts) {
      await retryPause(attempt, options);
      continue;
    }
    return {
      deleted,
      connections: connectionViews(payload.connections),
      ...(!deleted ? {
        error: accountError(
          payload,
          retryable
            ? "The encrypted account vault is temporarily unreachable."
            : "The connection could not be removed from this account.",
        ),
        retryable,
      } : {}),
    };
  }
  return {
    deleted: false,
    connections: [],
    error: "The encrypted account vault is temporarily unreachable.",
    retryable: true,
  };
}

function sessionConnectionDrafts(storage: Storage): RememberStudioConnectionInput[] {
  const drafts: RememberStudioConnectionInput[] = [];
  for (const provider of [
    "dropstab",
    "openai",
    "anthropic",
    "openrouter",
    "kimi",
    "custom",
  ] as const) {
    const credential = storage.getItem(`drops-studio:${provider}`)?.trim() ?? "";
    if (!credential) continue;
    const model = storage.getItem(
      provider === "custom"
        ? "drops-studio:custom-model"
        : `drops-studio:${provider}:model`,
    )?.trim();
    const endpoint = provider === "custom"
      ? storage.getItem("drops-studio:custom-endpoint")?.trim()
      : undefined;
    drafts.push({
      provider,
      credential,
      ...(model ? { model } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
  }
  const telegram = storage.getItem("drops-studio:telegram-account")?.trim() ?? "";
  if (telegram) {
    drafts.push({
      provider: "telegram",
      credential: telegram,
      label: "Telegram account session",
    });
  }
  return drafts;
}

function clearSessionConnectionDraft(
  storage: Storage,
  provider: StudioAccountConnectionProvider,
): void {
  if (provider === "telegram") {
    storage.removeItem("drops-studio:telegram-account");
    return;
  }
  storage.removeItem(`drops-studio:${provider}`);
  storage.removeItem(`drops-studio:${provider}:model`);
  if (provider === "custom") {
    storage.removeItem("drops-studio:custom-model");
    storage.removeItem("drops-studio:custom-endpoint");
  }
}

export async function migrateSessionConnectionsToAccount(input: {
  snapshot: StudioAccountSnapshot;
  storage: Storage;
  requestOptions?: StudioAccountRequestOptions;
}): Promise<{
  snapshot: StudioAccountSnapshot;
  migrated: StudioAccountConnectionProvider[];
  complete: boolean;
  error?: string;
}> {
  if (!input.snapshot.authenticated) {
    return { snapshot: input.snapshot, migrated: [], complete: true };
  }
  if (!input.snapshot.vaultAvailable) {
    return {
      snapshot: input.snapshot,
      migrated: [],
      complete: false,
      error:
        input.snapshot.error
        ?? "Encrypted account connection storage is temporarily unavailable.",
    };
  }
  const connected = new Set(
    input.snapshot.connections
      .filter((connection) => connection.connected)
      .map((connection) => connection.provider),
  );
  const migrated: StudioAccountConnectionProvider[] = [];
  let connections = input.snapshot.connections;
  let error: string | undefined;
  for (const draft of sessionConnectionDrafts(input.storage)) {
    if (connected.has(draft.provider)) continue;
    const result = await rememberStudioConnection(draft, input.requestOptions);
    if (!result.saved) {
      error = result.error ?? "A session connection could not be encrypted for this account.";
      break;
    }
    if (result.connections.length) connections = result.connections;
    clearSessionConnectionDraft(input.storage, draft.provider);
    connected.add(draft.provider);
    migrated.push(draft.provider);
  }
  const snapshot = migrated.length
    ? { ...input.snapshot, connections }
    : input.snapshot;
  return {
    snapshot,
    migrated,
    complete: !error,
    ...(error ? { error } : {}),
  };
}
