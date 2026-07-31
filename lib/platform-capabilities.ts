import {
  readPlatformHealthReceipt,
  type PlatformHealthReceiptBundle,
} from "./platform-health-receipts.ts";

export type PlatformCapabilityState =
  | "working"
  | "working-local-test"
  | "setup-required"
  | "unavailable";

export interface PlatformCapabilityReceipt {
  id: string;
  label: string;
  state: PlatformCapabilityState;
  mode: string;
  detail: string;
  evidence: string[];
  requiredEnvironment: string[];
}

export interface PlatformCapabilitySnapshot {
  generatedAt: string;
  environment: "development" | "preview" | "production";
  capabilities: PlatformCapabilityReceipt[];
}

type SafeEnvironment = Record<string, string | undefined>;

function configured(environment: SafeEnvironment, names: readonly string[]): boolean {
  return names.every((name) => Boolean(environment[name]?.trim()));
}

function runtimeEnvironment(environment: SafeEnvironment): PlatformCapabilitySnapshot["environment"] {
  if (environment.VERCEL_ENV === "production") return "production";
  if (environment.VERCEL_ENV === "preview") return "preview";
  return "development";
}

export function platformCapabilitySnapshot(
  environment: SafeEnvironment = process.env,
  now = new Date(),
  healthReceipt: PlatformHealthReceiptBundle | null = null,
): PlatformCapabilitySnapshot {
  const blob = Boolean(
    environment.BLOB_READ_WRITE_TOKEN?.trim()
    || configured(environment, ["BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"]),
  );
  const sandbox = Boolean(
    environment.VERCEL_OIDC_TOKEN?.trim()
    || configured(environment, ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"]),
  );
  const postgresProjectData = environment.DROPS_MANAGED_DATA_PROVIDER === "postgres"
    && Boolean(
      environment.DROPS_MANAGED_DATABASE_URL?.trim()
        || environment.DROPS_MANAGED_POSTGRES_URL?.trim(),
    );
  const projectData = (blob || postgresProjectData)
    && Boolean(environment.PROJECT_DATA_CAPABILITY_SECRET?.trim());
  const localProjectData = runtimeEnvironment(environment) !== "production"
    && environment.DROPS_STUDIO_LOCAL_PROJECT_DATA === "1";
  const teamControlPlane = blob && Boolean(environment.DROPS_TEAM_INVITE_SECRET?.trim());
  const deployment = Boolean(
    environment.VERCEL_DEPLOY_TOKEN?.trim()
    && environment.VERCEL_GENERATED_PROJECT_ID?.trim(),
  );
  const github = configured(environment, [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_ALLOWED_REPOSITORIES",
  ]);
  const managedRelational = environment.DROPS_MANAGED_DATA_PROVIDER === "d1"
    || environment.DROPS_MANAGED_DATA_PROVIDER === "postgres";
  const realtime = Boolean(environment.DROPS_COLLABORATION_TRANSPORT_URL?.trim());
  const oidc = configured(environment, [
    "DROPS_ENTERPRISE_OIDC_ISSUER",
    "DROPS_ENTERPRISE_OIDC_CLIENT_ID",
    "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET",
  ]);
  const audit = managedRelational && Boolean(environment.DROPS_ENTERPRISE_AUDIT_SIGNING_KEY?.trim());
  const receiptCurrent = Boolean(
    healthReceipt
      && healthReceipt.environment === runtimeEnvironment(environment)
      && Date.parse(healthReceipt.checkedAt) <= now.getTime()
      && Date.parse(healthReceipt.expiresAt) > now.getTime(),
  );
  const check = (id: keyof PlatformHealthReceiptBundle["checks"]) =>
    receiptCurrent ? healthReceipt?.checks[id] : undefined;
  const sandboxHealth = check("sandbox");
  const projectDataHealth = check("project-data");
  const managedHealth = check("managed-backend");
  const organizationHealth = check("organizations");
  const collaborationHealth = check("collaboration");
  const identityHealth = check("enterprise-identity");
  const auditHealth = check("audit-backup");
  const githubHealth = check("github");
  const deploymentHealth = check("deployment");

  const capabilities: PlatformCapabilityReceipt[] = [
    {
      id: "project-v2",
      label: "Multi-file Project V2",
      state: "working",
      mode: "canonical-filesystem",
      detail: "Validated files, revisions, diffs, checkpoints and runnable source export are active.",
      evidence: ["project-v2-validator", "checkpoint-engine", "artifact-secret-scan"],
      requiredEnvironment: [],
    },
    {
      id: "sandbox",
      label: "Vercel Sandbox",
      state: sandboxHealth?.status === "working" ? "working" : sandbox ? "unavailable" : "setup-required",
      mode: sandboxHealth?.mode ?? (sandbox ? "authorization-present-health-required" : "provider-not-authorized"),
      detail: sandboxHealth?.detail ?? (sandbox
        ? "Vercel authorization is present, but Node 24 build, preview and cleanup stay unverified until a live Sandbox health receipt succeeds."
        : "Sandbox operations stay disabled until Vercel OIDC or the bounded local credential trio is available."
      ),
      evidence: sandboxHealth?.evidence ?? (sandbox ? ["authorization-marker-only"] : []),
      requiredEnvironment: sandbox ? [] : ["VERCEL_OIDC_TOKEN"],
    },
    {
      id: "project-data",
      label: "Built-in project data",
      state: localProjectData ? "working-local-test" : projectDataHealth?.status === "working" ? "working" : projectData ? "unavailable" : "setup-required",
      mode: localProjectData ? "process-memory-local-test" : projectDataHealth?.mode ?? (projectData ? "credentials-present-backend-health-required" : "browser-local-fallback"),
      detail: localProjectData
        ? "Scoped JSON documents are running in explicit non-production process-memory proof mode."
        : projectDataHealth?.detail ?? (projectData
          ? "Durable storage and signing markers are present, but the transactional project-data backend has not returned a health receipt."
          : "Generated apps remain runnable with labelled browser-local persistence; cloud writes are disabled."),
      evidence: localProjectData ? ["explicit-local-test-flag"] : projectDataHealth?.evidence ?? (projectData ? ["storage-marker-only", "capability-signing-marker-only"] : []),
      requiredEnvironment: projectData || localProjectData ? [] : ["PROJECT_DATA_CAPABILITY_SECRET", "DROPS_MANAGED_DATABASE_URL or private Vercel Blob"],
    },
    {
      id: "managed-backend",
      label: "Managed relational backend",
      state: managedHealth?.status === "working" ? "working" : managedRelational ? "unavailable" : "working-local-test",
      mode: managedHealth?.mode ?? (managedRelational ? "adapter-health-check-required" : "reference-core-only"),
      detail: managedHealth?.detail ?? (managedRelational
        ? "A provider was selected, but the UI will not claim readiness without a live adapter health receipt."
        : "Schema, migrations, CRUD, auth, storage, functions, jobs, webhooks and backups have a verified local reference core; a durable D1 or Postgres adapter is still required for production data."),
      evidence: managedHealth?.evidence ?? ["managed-platform-contract-tests"],
      requiredEnvironment: managedRelational ? [] : ["DROPS_MANAGED_DATA_PROVIDER", "provider-specific binding"],
    },
    {
      id: "organizations",
      label: "Organizations and workspaces",
      state: organizationHealth?.status === "working" ? "working" : teamControlPlane ? "unavailable" : "setup-required",
      mode: organizationHealth?.mode ?? (teamControlPlane ? "configuration-present-health-required" : "storage-or-signing-missing"),
      detail: organizationHealth?.detail ?? (teamControlPlane
        ? "Durable storage and invite signing are configured, but team mutations are not marked working until the control-plane health check succeeds."
        : "No sample members are shown; team mutations remain disabled until durable storage and invite signing are configured."),
      evidence: organizationHealth?.evidence ?? (teamControlPlane ? ["team-storage-marker-only", "invite-signing-marker-only"] : []),
      requiredEnvironment: teamControlPlane ? [] : ["DROPS_TEAM_INVITE_SECRET", "BLOB_READ_WRITE_TOKEN or Vercel Blob OIDC"],
    },
    {
      id: "collaboration",
      label: "Realtime collaboration",
      state: collaborationHealth?.status === "working" ? "working" : realtime ? "unavailable" : "working-local-test",
      mode: collaborationHealth?.mode ?? (realtime ? "transport-health-check-required" : "deterministic-reference-runtime"),
      detail: collaborationHealth?.detail ?? (realtime
        ? "A transport URL exists, but room authorization and health evidence are still required before activation."
        : "Deterministic concurrent edits, presence expiry, comments and conflict-safe AI branches are verified locally; no production realtime transport is claimed."),
      evidence: collaborationHealth?.evidence ?? ["collaboration-convergence-tests", "branch-conflict-tests"],
      requiredEnvironment: realtime ? [] : ["DROPS_COLLABORATION_TRANSPORT_URL"],
    },
    {
      id: "enterprise-identity",
      label: "Enterprise identity and policy",
      state: identityHealth?.status === "working" ? "working" : oidc ? "unavailable" : "working-local-test",
      mode: identityHealth?.mode ?? (oidc ? "oidc-health-check-required" : "standards-shaped-reference-runtime"),
      detail: identityHealth?.detail ?? (oidc
        ? "OIDC values are configured, but sign-in stays disabled until discovery and callback verification succeeds."
        : "OIDC state/nonce/PKCE, domain mapping, RBAC, policy precedence and scoped service tokens are covered by local reference tests; external SSO is setup-required."),
      evidence: identityHealth?.evidence ?? ["oidc-replay-tests", "rbac-isolation-tests", "policy-resolution-tests"],
      requiredEnvironment: oidc ? [] : ["DROPS_ENTERPRISE_OIDC_ISSUER", "DROPS_ENTERPRISE_OIDC_CLIENT_ID", "DROPS_ENTERPRISE_OIDC_CLIENT_SECRET"],
    },
    {
      id: "audit-backup",
      label: "Audit, retention and recovery",
      state: auditHealth?.status === "working" ? "working" : audit ? "unavailable" : "working-local-test",
      mode: auditHealth?.mode ?? (audit ? "durable-health-check-required" : "integrity-chain-reference-runtime"),
      detail: auditHealth?.detail ?? (audit
        ? "Durable settings exist, but append-only storage and restore receipts must pass before production activation."
        : "Secret-safe audit chaining, retention, export/deletion workflows and checksummed restore-to-new-environment behavior are verified locally."),
      evidence: auditHealth?.evidence ?? ["audit-integrity-tests", "backup-checksum-tests", "restore-isolation-tests"],
      requiredEnvironment: audit ? [] : ["DROPS_ENTERPRISE_AUDIT_SIGNING_KEY", "durable managed provider"],
    },
    {
      id: "github",
      label: "GitHub delivery",
      state: githubHealth?.status === "working" ? "working" : github ? "unavailable" : "setup-required",
      mode: githubHealth?.mode ?? (github ? "github-app-health-required" : "visitor-token-or-app-required"),
      detail: githubHealth?.detail ?? (github
        ? "GitHub App markers are complete, but branch and PR actions remain unverified until an authenticated repository health receipt succeeds."
        : "Import remains available with a request-only visitor token; server-side branch, commit and PR actions need GitHub App configuration."),
      evidence: githubHealth?.evidence ?? (github ? ["github-app-configuration-markers-only"] : []),
      requiredEnvironment: github ? [] : ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_ALLOWED_REPOSITORIES"],
    },
    {
      id: "deployment",
      label: "Generated-app deployment",
      state: deploymentHealth?.status === "working" ? "working" : deployment ? "unavailable" : "setup-required",
      mode: deploymentHealth?.mode ?? (deployment ? "vercel-provider-health-required" : "visitor-token-or-platform-token-required"),
      detail: deploymentHealth?.detail ?? (deployment
        ? "Deployment credentials are configured, but no generated-app deploy is marked ready until Vercel confirms a provider receipt."
        : "Runnable ZIP and legacy publish remain available; Vercel preview deployment needs a request-only visitor token or platform configuration."),
      evidence: deploymentHealth?.evidence ?? (deployment ? ["vercel-deployment-configuration-markers-only"] : []),
      requiredEnvironment: deployment ? [] : ["VERCEL_DEPLOY_TOKEN", "VERCEL_GENERATED_PROJECT_ID"],
    },
  ];

  return {
    generatedAt: now.toISOString(),
    environment: runtimeEnvironment(environment),
    capabilities,
  };
}

export async function platformCapabilitySnapshotWithHealth(
  environment: SafeEnvironment = process.env,
  now = new Date(),
): Promise<PlatformCapabilitySnapshot> {
  return platformCapabilitySnapshot(
    environment,
    now,
    await readPlatformHealthReceipt(),
  );
}
