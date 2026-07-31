import { enterpriseError } from "./errors.ts";
import { sha256, stableJson } from "./utils.ts";

export interface EnterprisePolicy {
  allowedModelProviders?: string[];
  allowedModels?: string[];
  byokRequired?: boolean;
  platformModelsAllowed?: boolean;
  maxAgentCostPerRun?: number;
  maxSandboxDuration?: number;
  maxParallelAgents?: number;
  allowedDependencyRegistries?: string[];
  allowedNetworkHosts?: string[];
  productionPublishRequiresApproval?: boolean;
  productionSchemaChangeRequiresApproval?: boolean;
  githubPushRequiresApproval?: boolean;
  telegramDeliveryRequiresApproval?: boolean;
  secretAccessRoles?: string[];
  retentionDays?: number;
  exportAllowed?: boolean;
  publicProjectLinksAllowed?: boolean;
  ssoRequired?: boolean;
  mfaRequiredWhenAvailable?: boolean;
}

export interface ResolvedEnterprisePolicy {
  allowedModelProviders: string[] | null;
  allowedModels: string[] | null;
  byokRequired: boolean;
  platformModelsAllowed: boolean;
  maxAgentCostPerRun: number;
  maxSandboxDuration: number;
  maxParallelAgents: number;
  allowedDependencyRegistries: string[] | null;
  allowedNetworkHosts: string[] | null;
  productionPublishRequiresApproval: boolean;
  productionSchemaChangeRequiresApproval: boolean;
  githubPushRequiresApproval: boolean;
  telegramDeliveryRequiresApproval: boolean;
  secretAccessRoles: string[] | null;
  retentionDays: number;
  exportAllowed: boolean;
  publicProjectLinksAllowed: boolean;
  ssoRequired: boolean;
  mfaRequiredWhenAvailable: boolean;
}

export interface EnterprisePolicyResolution {
  policy: ResolvedEnterprisePolicy;
  policyHash: string;
  appliedLayers: string[];
}

function intersect(current: string[] | null, next: string[] | undefined): string[] | null {
  if (next === undefined) return current;
  const values = [...new Set(next.map((value) => value.trim()).filter(Boolean))].sort();
  if (current === null) return values;
  return current.filter((value) => values.includes(value));
}

function minimum(current: number, next: number | undefined, lowerBound: number, upperBound: number, label: string): number {
  if (next === undefined) return current;
  if (!Number.isFinite(next) || next < lowerBound || next > upperBound) enterpriseError("INVALID_INPUT", `Enterprise policy ${label} must be between ${lowerBound} and ${upperBound}.`);
  return Math.min(current, next);
}

export function resolveEnterprisePolicy(input: {
  systemHard?: EnterprisePolicy;
  organization?: EnterprisePolicy;
  workspace?: EnterprisePolicy;
  project?: EnterprisePolicy;
  userPreference?: EnterprisePolicy;
}): EnterprisePolicyResolution {
  const policy: ResolvedEnterprisePolicy = {
    allowedModelProviders: null,
    allowedModels: null,
    byokRequired: false,
    platformModelsAllowed: true,
    maxAgentCostPerRun: Number.MAX_SAFE_INTEGER,
    maxSandboxDuration: Number.MAX_SAFE_INTEGER,
    maxParallelAgents: Number.MAX_SAFE_INTEGER,
    allowedDependencyRegistries: null,
    allowedNetworkHosts: null,
    productionPublishRequiresApproval: false,
    productionSchemaChangeRequiresApproval: false,
    githubPushRequiresApproval: false,
    telegramDeliveryRequiresApproval: false,
    secretAccessRoles: null,
    retentionDays: 3_650,
    exportAllowed: true,
    publicProjectLinksAllowed: true,
    ssoRequired: false,
    mfaRequiredWhenAvailable: false,
  };
  const layers = [
    ["system-hard", input.systemHard],
    ["organization", input.organization],
    ["workspace", input.workspace],
    ["project", input.project],
    ["user-preference", input.userPreference],
  ] as const;
  const appliedLayers: string[] = [];
  for (const [name, layer] of layers) {
    if (!layer) continue;
    appliedLayers.push(name);
    policy.allowedModelProviders = intersect(policy.allowedModelProviders, layer.allowedModelProviders);
    policy.allowedModels = intersect(policy.allowedModels, layer.allowedModels);
    policy.allowedDependencyRegistries = intersect(policy.allowedDependencyRegistries, layer.allowedDependencyRegistries);
    policy.allowedNetworkHosts = intersect(policy.allowedNetworkHosts, layer.allowedNetworkHosts);
    policy.secretAccessRoles = intersect(policy.secretAccessRoles, layer.secretAccessRoles);
    policy.byokRequired ||= layer.byokRequired ?? false;
    policy.platformModelsAllowed &&= layer.platformModelsAllowed ?? true;
    policy.maxAgentCostPerRun = minimum(policy.maxAgentCostPerRun, layer.maxAgentCostPerRun, 0, 1_000_000, `${name}.maxAgentCostPerRun`);
    policy.maxSandboxDuration = minimum(policy.maxSandboxDuration, layer.maxSandboxDuration, 1, 86_400, `${name}.maxSandboxDuration`);
    policy.maxParallelAgents = minimum(policy.maxParallelAgents, layer.maxParallelAgents, 1, 100, `${name}.maxParallelAgents`);
    policy.retentionDays = minimum(policy.retentionDays, layer.retentionDays, 1, 3_650, `${name}.retentionDays`);
    policy.productionPublishRequiresApproval ||= layer.productionPublishRequiresApproval ?? false;
    policy.productionSchemaChangeRequiresApproval ||= layer.productionSchemaChangeRequiresApproval ?? false;
    policy.githubPushRequiresApproval ||= layer.githubPushRequiresApproval ?? false;
    policy.telegramDeliveryRequiresApproval ||= layer.telegramDeliveryRequiresApproval ?? false;
    policy.exportAllowed &&= layer.exportAllowed ?? true;
    policy.publicProjectLinksAllowed &&= layer.publicProjectLinksAllowed ?? true;
    policy.ssoRequired ||= layer.ssoRequired ?? false;
    policy.mfaRequiredWhenAvailable ||= layer.mfaRequiredWhenAvailable ?? false;
  }
  return { policy, policyHash: sha256(stableJson(policy)), appliedLayers };
}

export type EnterprisePolicyAction =
  | { action: "model.use"; provider: string; model?: string; byok?: boolean; estimatedCost?: number }
  | { action: "network.connect"; host: string }
  | { action: "dependency.install"; registry: string }
  | { action: "sandbox.start"; durationSeconds: number }
  | { action: "agents.parallel"; count: number }
  | { action: "production.publish" }
  | { action: "production.schema-change" }
  | { action: "github.push" }
  | { action: "telegram.deliver" }
  | { action: "secret.access"; role: string }
  | { action: "data.export" }
  | { action: "project.public-link" };

export function evaluateEnterprisePolicy(
  resolution: EnterprisePolicyResolution,
  action: EnterprisePolicyAction,
): { allowed: boolean; requiresApproval: boolean; reason: string; policyHash: string } {
  const policy = resolution.policy;
  let allowed = true;
  let requiresApproval = false;
  let reason = "Policy allows this action.";
  const deny = (message: string): void => { allowed = false; reason = message; };
  switch (action.action) {
    case "model.use":
      if (policy.allowedModelProviders && !policy.allowedModelProviders.includes(action.provider)) deny("Model provider is not allowed.");
      else if (action.model && policy.allowedModels && !policy.allowedModels.includes(action.model)) deny("Model is not allowed.");
      else if (policy.byokRequired && !action.byok) deny("BYOK is required.");
      else if (!policy.platformModelsAllowed && !action.byok) deny("Platform-funded models are disabled.");
      else if ((action.estimatedCost ?? 0) > policy.maxAgentCostPerRun) deny("Agent cost exceeds policy.");
      break;
    case "network.connect":
      if (policy.allowedNetworkHosts && !policy.allowedNetworkHosts.includes(action.host)) deny("Network host is not allowed.");
      break;
    case "dependency.install":
      if (policy.allowedDependencyRegistries && !policy.allowedDependencyRegistries.includes(action.registry)) deny("Dependency registry is not allowed.");
      break;
    case "sandbox.start":
      if (action.durationSeconds > policy.maxSandboxDuration) deny("Sandbox duration exceeds policy.");
      break;
    case "agents.parallel":
      if (action.count > policy.maxParallelAgents) deny("Parallel agent count exceeds policy.");
      break;
    case "production.publish":
      requiresApproval = policy.productionPublishRequiresApproval;
      break;
    case "production.schema-change":
      requiresApproval = policy.productionSchemaChangeRequiresApproval;
      break;
    case "github.push":
      requiresApproval = policy.githubPushRequiresApproval;
      break;
    case "telegram.deliver":
      requiresApproval = policy.telegramDeliveryRequiresApproval;
      break;
    case "secret.access":
      if (policy.secretAccessRoles && !policy.secretAccessRoles.includes(action.role)) deny("Role cannot access secret references.");
      break;
    case "data.export":
      if (!policy.exportAllowed) deny("Data export is disabled.");
      break;
    case "project.public-link":
      if (!policy.publicProjectLinksAllowed) deny("Public project links are disabled.");
      break;
  }
  return { allowed, requiresApproval: allowed && requiresApproval, reason, policyHash: resolution.policyHash };
}
