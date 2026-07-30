import { createHash } from "node:crypto";

export interface AgentIntelligenceFlags {
  compositeModelRouting: boolean;
  quickEditRole: boolean;
  independentVerifier: boolean;
  hybridContextRetrieval: boolean;
  embeddingRetrieval: boolean;
  parallelSubagents: boolean;
  isolatedSubagentSandbox: boolean;
  privacySafeTraces: boolean;
  evalDashboard: boolean;
  promptExperiments: boolean;
}

export const DEFAULT_AGENT_INTELLIGENCE_FLAGS: Readonly<AgentIntelligenceFlags> = Object.freeze({
  compositeModelRouting: true,
  quickEditRole: true,
  independentVerifier: true,
  hybridContextRetrieval: true,
  embeddingRetrieval: false,
  parallelSubagents: false,
  isolatedSubagentSandbox: false,
  privacySafeTraces: true,
  evalDashboard: true,
  promptExperiments: false,
});

const FLAG_NAMES = Object.keys(DEFAULT_AGENT_INTELLIGENCE_FLAGS) as Array<keyof AgentIntelligenceFlags>;

export function resolveAgentIntelligenceFlags(
  env: Record<string, string | undefined> = process.env,
): AgentIntelligenceFlags {
  const resolved = { ...DEFAULT_AGENT_INTELLIGENCE_FLAGS };
  const raw = env.DROPS_AGENT_INTELLIGENCE_FLAGS?.trim();
  if (raw) {
    let overrides: unknown;
    try {
      overrides = JSON.parse(raw);
    } catch {
      throw new Error("DROPS_AGENT_INTELLIGENCE_FLAGS must be a JSON object.");
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error("DROPS_AGENT_INTELLIGENCE_FLAGS must be a JSON object.");
    }
    for (const [name, value] of Object.entries(overrides)) {
      if (!FLAG_NAMES.includes(name as keyof AgentIntelligenceFlags) || typeof value !== "boolean") {
        throw new Error(`Unknown or invalid Agent Intelligence flag: ${name}.`);
      }
      resolved[name as keyof AgentIntelligenceFlags] = value;
    }
  }
  resolved.embeddingRetrieval = resolved.embeddingRetrieval && Boolean(env.DROPS_CONTEXT_EMBEDDING_PROVIDER?.trim());
  resolved.promptExperiments = resolved.promptExperiments && env.DROPS_EXPERIMENTS_ENABLED === "1";
  return resolved;
}

export function parallelSubagentCanary(input: {
  flags: AgentIntelligenceFlags;
  actorId: string;
  projectId: string;
  percent?: number;
}): boolean {
  if (input.flags.parallelSubagents) return true;
  const percent = Math.min(Math.max(input.percent ?? 10, 0), 100);
  if (!percent) return false;
  const digest = createHash("sha256")
    .update(`drops-agent-parallel-v2:${input.actorId}:${input.projectId}`)
    .digest();
  return digest.readUInt32BE(0) / 0xffffffff * 100 < percent;
}
