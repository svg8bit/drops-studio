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
}

function accountPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function connectionViews(value: unknown): StudioAccountConnectionView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is StudioAccountConnectionView => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const provider = (entry as { provider?: unknown }).provider;
    const connected = (entry as { connected?: unknown }).connected;
    return (
      typeof provider === "string"
      && [
        "dropstab",
        "dropsbot",
        "openai",
        "anthropic",
        "openrouter",
        "kimi",
        "custom",
        "telegram",
      ].includes(provider)
      && typeof connected === "boolean"
    );
  });
}

export async function readStudioAccountSnapshot(): Promise<StudioAccountSnapshot> {
  const response = await fetch("/api/account", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const payload = accountPayload(await response.json().catch(() => ({})));
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
}

export async function rememberStudioConnection(
  input: RememberStudioConnectionInput,
): Promise<RememberStudioConnectionResult> {
  const response = await fetch("/api/account/connections", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!response) {
    return {
      saved: false,
      connections: [],
      error: "The encrypted account vault is temporarily unreachable.",
    };
  }
  const payload = accountPayload(await response.json().catch(() => ({})));
  const saved = response.ok && payload.saved === true;
  return {
    saved,
    connections: connectionViews(payload.connections),
    ...(!saved && typeof payload.error === "string"
      ? { error: payload.error }
      : {}),
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
}): Promise<{
  snapshot: StudioAccountSnapshot;
  migrated: StudioAccountConnectionProvider[];
  error?: string;
}> {
  if (!input.snapshot.authenticated) {
    return { snapshot: input.snapshot, migrated: [] };
  }
  if (!input.snapshot.vaultAvailable) {
    return {
      snapshot: input.snapshot,
      migrated: [],
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
  let error: string | undefined;
  for (const draft of sessionConnectionDrafts(input.storage)) {
    if (connected.has(draft.provider)) continue;
    const result = await rememberStudioConnection(draft);
    if (!result.saved) {
      error = result.error ?? "A session connection could not be encrypted for this account.";
      break;
    }
    clearSessionConnectionDraft(input.storage, draft.provider);
    connected.add(draft.provider);
    migrated.push(draft.provider);
  }
  const snapshot = migrated.length
    ? await readStudioAccountSnapshot().catch(() => input.snapshot)
    : input.snapshot;
  return {
    snapshot,
    migrated,
    ...(error ? { error } : {}),
  };
}
