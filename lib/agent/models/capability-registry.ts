import type {
  AgentModelRole,
  LiveModelProviderId,
  ModelCapabilityProfile,
} from "./types.ts";

const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i;

export function modelRegistryKey(
  provider: LiveModelProviderId,
  model: string,
): string {
  return `${provider}:${model}`;
}

function sanitizeProfile(profile: ModelCapabilityProfile): ModelCapabilityProfile {
  if (!MODEL_ID.test(profile.model)) throw new Error("Invalid model id.");
  if (!Number.isFinite(Date.parse(profile.verifiedAt))) {
    throw new Error("Model capability verification time is invalid.");
  }
  const allowedRoles = [...new Set(profile.allowedRoles)].sort() as AgentModelRole[];
  return {
    provider: profile.provider,
    model: profile.model,
    displayName: profile.displayName.slice(0, 120),
    authorized: profile.authorized === true,
    source: profile.source,
    supportsTools: profile.supportsTools === true
      ? true
      : profile.supportsTools === false
        ? false
        : "unknown",
    supportsParallelTools: profile.supportsParallelTools === true
      ? true
      : profile.supportsParallelTools === false
        ? false
        : "unknown",
    supportsStructuredOutput: profile.supportsStructuredOutput === true
      ? true
      : profile.supportsStructuredOutput === false
        ? false
        : "unknown",
    supportsVision: profile.supportsVision === true
      ? true
      : profile.supportsVision === false
        ? false
        : "unknown",
    supportsEmbeddings: profile.supportsEmbeddings === true
      ? true
      : profile.supportsEmbeddings === false
        ? false
        : "unknown",
    maxContextTokens: positiveIntegerOrNull(profile.maxContextTokens),
    maxOutputTokens: positiveIntegerOrNull(profile.maxOutputTokens),
    latencyClass: profile.latencyClass,
    qualityClass: profile.qualityClass,
    cost: {
      inputPerMillion: nonNegativeOrNull(profile.cost.inputPerMillion),
      cachedInputPerMillion: nonNegativeOrNull(profile.cost.cachedInputPerMillion),
      outputPerMillion: nonNegativeOrNull(profile.cost.outputPerMillion),
      currency: "USD",
    },
    allowedRoles,
    verifiedAt: profile.verifiedAt,
    ...(profile.unavailableReason
      ? { unavailableReason: profile.unavailableReason.slice(0, 240) }
      : {}),
  };
}

function positiveIntegerOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export class AuthorizedModelRegistry {
  readonly version: string;
  readonly #profiles: Map<string, ModelCapabilityProfile>;

  constructor(version: string, profiles: ModelCapabilityProfile[]) {
    this.version = version;
    this.#profiles = new Map();
    for (const candidate of profiles) {
      const profile = sanitizeProfile(candidate);
      const key = modelRegistryKey(profile.provider, profile.model);
      if (this.#profiles.has(key)) throw new Error(`Duplicate model profile: ${key}`);
      this.#profiles.set(key, profile);
    }
  }

  get(provider: LiveModelProviderId, model: string): ModelCapabilityProfile | null {
    const profile = this.#profiles.get(modelRegistryKey(provider, model));
    return profile ? structuredClone(profile) : null;
  }

  listAuthorized(role?: AgentModelRole): ModelCapabilityProfile[] {
    return [...this.#profiles.values()]
      .filter(
        (profile) =>
          profile.authorized &&
          !profile.unavailableReason &&
          (!role || profile.allowedRoles.includes(role)),
      )
      .sort((left, right) =>
        modelRegistryKey(left.provider, left.model).localeCompare(
          modelRegistryKey(right.provider, right.model),
        ),
      )
      .map((profile) => structuredClone(profile));
  }

  publicSnapshot(): ModelCapabilityProfile[] {
    return [...this.#profiles.values()]
      .sort((left, right) =>
        modelRegistryKey(left.provider, left.model).localeCompare(
          modelRegistryKey(right.provider, right.model),
        ),
      )
      .map((profile) => structuredClone(profile));
  }
}
