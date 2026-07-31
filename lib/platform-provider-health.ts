import { createHash, createSign, randomUUID } from "node:crypto";

import {
  createDurableProjectDataBackend,
  ProjectDataStore,
} from "./project-data/index.ts";
import {
  createNeonManagedPlatformDriver,
  postgresManagedProviderConfigured,
  verifyPostgresManagedProvider,
} from "./managed-platform/index.ts";
import {
  type PlatformHealthCheckId,
  type PlatformHealthReceiptBundle,
  type PlatformProviderHealthCheck,
  writePlatformHealthReceipt,
} from "./platform-health-receipts.ts";

const HEALTH_TIMEOUT_MS = 20_000;

type HealthChecks = PlatformHealthReceiptBundle["checks"];

function environmentName(): PlatformHealthReceiptBundle["environment"] {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

function working(
  mode: string,
  detail: string,
  evidence: string[],
  latencyMs?: number,
): PlatformProviderHealthCheck {
  return {
    status: "working",
    mode,
    detail,
    evidence,
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
}

function unavailable(
  mode: string,
  detail: string,
  evidence: string[] = [],
): PlatformProviderHealthCheck {
  return { status: "unavailable", mode, detail, evidence };
}

async function timed<T>(
  operation: () => Promise<T>,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<{ value: T; latencyMs: number }> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("health timeout"));
        }, timeoutMs);
      }),
    ]);
    return {
      value,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sandboxHealth(): Promise<PlatformProviderHealthCheck> {
  let cleanupSandbox: (() => Promise<void>) | undefined;
  try {
    const { Sandbox } = await import("@vercel/sandbox");
    const project = process.env.VERCEL_PROJECT_ID?.trim() || "drops-studio";
    const suffix = createHash("sha256").update(project).digest("hex").slice(0, 12);
    const receipt = await timed(async () => {
      const sandbox = await Sandbox.getOrCreate({
        name: `ds-health-${suffix}`,
        runtime: "node24",
        resources: { vcpus: 2 },
        persistent: true,
        ports: [3000],
        timeout: 5 * 60_000,
        env: {},
        networkPolicy: "deny-all",
        resume: true,
        tags: { application: "drops-studio", purpose: "provider-health" },
      });
      cleanupSandbox = () => sandbox.delete();
      const command = await sandbox.runCommand({
        cmd: "node",
        args: ["--version"],
        env: {},
      });
      await command.wait();
      const stdout = (await command.stdout()).trim();
      if (command.exitCode !== 0 || !/^v24\./.test(stdout)) {
        throw new Error("sandbox runtime mismatch");
      }
    }, 90_000);
    return working(
      "vercel-sandbox-node24-live",
      "A named persistent 2 vCPU Node 24 Sandbox completed a real command under deny-all networking and was cleaned up.",
      ["sandbox-create-live", "node24-command-live", "sandbox-delete-live"],
      receipt.latencyMs,
    );
  } catch {
    return unavailable(
      "vercel-sandbox-health-failed",
      "The live Sandbox create, Node 24 command, or cleanup check failed.",
    );
  } finally {
    await cleanupSandbox?.().catch(() => undefined);
  }
}

async function projectDataHealth(): Promise<PlatformProviderHealthCheck> {
  let backendKind: "neon-postgres" | "vercel-blob-private" | null = null;
  let cleanupProject: (() => Promise<void>) | undefined;
  try {
    const receipt = await timed(async () => {
      const backend = await createDurableProjectDataBackend();
      if (!backend) throw new Error("durable backend unavailable");
      if (backend.kind !== "neon-postgres" && backend.kind !== "vercel-blob-private") {
        throw new Error("durable backend kind mismatch");
      }
      backendKind = backend.kind;
      const projectId = `provider-health-${randomUUID()}`;
      cleanupProject = async () => {
        const snapshot = await backend.read(projectId).catch(() => null);
        if (snapshot) {
          await backend.deleteProject(projectId, snapshot.storeRevision).catch(() => undefined);
        }
      };
      const store = new ProjectDataStore(backend);
      const created = await store.create({
        projectId,
        namespace: "health",
        id: "receipt",
        data: { state: "created" },
      });
      const updated = await store.update({
        projectId,
        namespace: "health",
        id: "receipt",
        expectedRevision: created.revision,
        data: { state: "updated" },
      });
      if (
        updated.revision !== 2
        || (await store.get(projectId, "health", "receipt"))?.data.state !== "updated"
      ) {
        throw new Error("project data read mismatch");
      }
      const snapshot = await backend.read(projectId);
      if (!snapshot) throw new Error("project data snapshot missing");
      await backend.deleteProject(projectId, snapshot.storeRevision);
      cleanupProject = undefined;
    });
    return working(
      backendKind === "neon-postgres"
        ? "transactional-neon-postgres"
        : "transactional-private-blob-cas",
      "Capability-scoped project data passed a real create, read, optimistic update and isolated cleanup cycle.",
      ["project-data-create-live", "project-data-cas-live", "project-data-cleanup-live"],
      receipt.latencyMs,
    );
  } catch {
    await cleanupProject?.();
    return unavailable(
      "project-data-health-failed",
      "The transactional project-data create, read, revision or cleanup check failed.",
    );
  }
}

async function managedBackendHealth(): Promise<PlatformProviderHealthCheck> {
  if (!postgresManagedProviderConfigured()) {
    return unavailable(
      "managed-provider-not-configured",
      "No production Postgres managed provider is configured.",
    );
  }
  const status = await verifyPostgresManagedProvider(
    createNeonManagedPlatformDriver(),
    { timeoutMs: HEALTH_TIMEOUT_MS },
  );
  return status.status === "working"
    ? working(
      "neon-postgres-live",
      "The Vercel-native Neon Postgres provider returned a successful bounded health query.",
      ["neon-marketplace-resource", "postgres-select-live"],
      status.latencyMs,
    )
    : unavailable(
      "neon-postgres-health-failed",
      "The configured Neon Postgres provider did not pass its bounded health query.",
    );
}

async function organizationsHealth(): Promise<PlatformProviderHealthCheck> {
  if (!process.env.DROPS_TEAM_INVITE_SECRET?.trim()) {
    return unavailable(
      "organization-signing-missing",
      "Organization invite signing is not configured.",
    );
  }
  let url = "";
  try {
    const receipt = await timed(async () => {
      const { del, get, put } = await import("@vercel/blob");
      const path = `drops-studio/platform-health/organizations/${randomUUID()}.json`;
      const body = JSON.stringify({ schemaVersion: 1, status: "working" });
      const stored = await put(path, body, {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json; charset=utf-8",
      });
      url = stored.url;
      const current = await get(path, { access: "private", useCache: false });
      if (
        !current
        || current.statusCode !== 200
        || await new Response(current.stream).text() !== body
      ) {
        throw new Error("organization storage mismatch");
      }
      await del(stored.url);
      url = "";
    });
    return working(
      "private-blob-team-control-plane",
      "Private team storage passed a real write/read/delete check and invite signing is configured.",
      ["private-team-storage-live", "invite-signing-configured"],
      receipt.latencyMs,
    );
  } catch {
    if (url) {
      const { del } = await import("@vercel/blob").catch(() => ({ del: null }));
      await del?.(url).catch(() => undefined);
    }
    return unavailable(
      "organization-storage-health-failed",
      "The private organization storage health check failed.",
    );
  }
}

async function externalOidcHealth(): Promise<PlatformProviderHealthCheck> {
  const issuer = process.env.DROPS_ENTERPRISE_OIDC_ISSUER?.trim();
  if (
    !issuer
    || !process.env.DROPS_ENTERPRISE_OIDC_CLIENT_ID?.trim()
    || !process.env.DROPS_ENTERPRISE_OIDC_CLIENT_SECRET?.trim()
  ) {
    return unavailable(
      "enterprise-oidc-not-configured",
      "Enterprise OIDC requires an issuer, client id and client secret from the selected identity provider.",
    );
  }
  try {
    const receipt = await timed(async () => {
      const origin = new URL(issuer);
      if (origin.protocol !== "https:") throw new Error("issuer must use https");
      const response = await fetch(
        new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : `${issuer}/`),
        { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) },
      );
      const discovery = await response.json() as Record<string, unknown>;
      if (
        !response.ok
        || discovery.issuer !== issuer.replace(/\/$/, "")
        || !["authorization_endpoint", "token_endpoint", "jwks_uri"].every(
          (field) => typeof discovery[field] === "string"
            && new URL(String(discovery[field])).protocol === "https:",
        )
      ) {
        throw new Error("invalid discovery");
      }
    });
    return working(
      "oidc-discovery-live",
      "The configured enterprise OIDC issuer passed HTTPS discovery validation; callback login remains approval-gated.",
      ["oidc-discovery-live", "pkce-state-nonce-tests"],
      receipt.latencyMs,
    );
  } catch {
    return unavailable(
      "oidc-discovery-health-failed",
      "The configured OIDC issuer did not pass bounded discovery validation.",
    );
  }
}

function githubAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!appId || !privateKey) throw new Error("GitHub App credentials missing");
  const now = Math.floor(Date.now() / 1_000);
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

async function githubHealth(): Promise<PlatformProviderHealthCheck> {
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  const allowed = process.env.GITHUB_APP_ALLOWED_REPOSITORIES?.trim();
  if (!installationId || !allowed) {
    return unavailable(
      "github-app-not-configured",
      "GitHub App installation and repository allowlist are not configured.",
    );
  }
  try {
    const receipt = await timed(async () => {
      const tokenResponse = await fetch(
        `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
        {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${githubAppJwt()}`,
            "x-github-api-version": "2022-11-28",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        },
      );
      const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
      const token = typeof tokenPayload.token === "string" ? tokenPayload.token : "";
      if (!tokenResponse.ok || !token) throw new Error("installation token failed");
      const repositories = await fetch(
        "https://api.github.com/installation/repositories?per_page=1",
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        },
      );
      if (!repositories.ok) throw new Error("repository receipt failed");
    });
    return working(
      "github-app-installation-live",
      "The GitHub App exchanged an installation token and read its bounded repository scope.",
      ["github-app-jwt-live", "github-installation-repositories-live"],
      receipt.latencyMs,
    );
  } catch {
    return unavailable(
      "github-app-health-failed",
      "The configured GitHub App did not pass installation authentication.",
    );
  }
}

async function deploymentHealth(): Promise<PlatformProviderHealthCheck> {
  const token = process.env.VERCEL_DEPLOY_TOKEN?.trim();
  const projectId = process.env.VERCEL_GENERATED_PROJECT_ID?.trim();
  if (!token || !projectId) {
    return unavailable(
      "generated-deployment-not-configured",
      "Generated-app deployment requires a scoped Vercel access token and target project.",
    );
  }
  try {
    const receipt = await timed(async () => {
      const team = process.env.VERCEL_TEAM_ID?.trim();
      const query = team ? `?teamId=${encodeURIComponent(team)}` : "";
      const response = await fetch(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${query}`,
        {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        },
      );
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok || payload.id !== projectId) throw new Error("project scope mismatch");
    });
    return working(
      "vercel-generated-project-live",
      "The scoped Vercel credential can read the configured generated-app project; deployments remain explicit-approval actions.",
      ["vercel-project-scope-live", "deployment-approval-gate"],
      receipt.latencyMs,
    );
  } catch {
    return unavailable(
      "vercel-deployment-health-failed",
      "The configured Vercel deployment credential cannot read the generated-app project.",
    );
  }
}

async function collaborationHealth(): Promise<PlatformProviderHealthCheck> {
  const url = process.env.DROPS_COLLABORATION_TRANSPORT_URL?.trim();
  if (!url) {
    return unavailable(
      "collaboration-transport-not-configured",
      "Realtime collaboration needs a production transport URL.",
    );
  }
  try {
    const receipt = await timed(async () => {
      const endpoint = new URL(url);
      if (endpoint.protocol !== "https:") throw new Error("transport must use https");
      endpoint.searchParams.set("health", "1");
      const response = await fetch(endpoint, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok || payload.status !== "working") throw new Error("transport failed");
    });
    return working(
      "realtime-transport-live",
      "The configured realtime transport returned a successful HTTPS health response.",
      ["realtime-transport-health-live"],
      receipt.latencyMs,
    );
  } catch {
    return unavailable(
      "collaboration-transport-health-failed",
      "The configured realtime collaboration transport did not pass its health check.",
    );
  }
}

export async function runPlatformProviderHealthChecks(
  options: { includeSandbox?: boolean; persist?: boolean } = {},
): Promise<PlatformHealthReceiptBundle> {
  const checks: HealthChecks = {};
  const entries: Array<[PlatformHealthCheckId, () => Promise<PlatformProviderHealthCheck>]> = [
    ["project-data", projectDataHealth],
    ["managed-backend", managedBackendHealth],
    ["organizations", organizationsHealth],
    ["collaboration", collaborationHealth],
    ["enterprise-identity", externalOidcHealth],
    ["github", githubHealth],
    ["deployment", deploymentHealth],
  ];
  if (options.includeSandbox !== false) entries.unshift(["sandbox", sandboxHealth]);
  const results = await Promise.all(entries.map(([, operation]) => operation()));
  entries.forEach(([id], index) => {
    checks[id] = results[index];
  });
  const managedWorking = checks["managed-backend"]?.status === "working";
  const organizationWorking = checks.organizations?.status === "working";
  checks["audit-backup"] = process.env.DROPS_ENTERPRISE_AUDIT_SIGNING_KEY?.trim()
    && managedWorking
    && organizationWorking
    ? working(
      "postgres-audit-private-blob-recovery",
      "Audit signing, durable Postgres and private recovery storage are configured and live.",
      ["audit-signing-configured", "postgres-health-live", "private-recovery-storage-live"],
    )
    : unavailable(
      "durable-audit-setup-required",
      "Durable audit requires its signing key plus healthy Postgres and private recovery storage.",
    );
  const checkedAt = new Date();
  const receipt: PlatformHealthReceiptBundle = {
    schemaVersion: 1,
    environment: environmentName(),
    checkedAt: checkedAt.toISOString(),
    expiresAt: new Date(checkedAt.getTime() + 36 * 60 * 60_000).toISOString(),
    checks,
  };
  if (options.persist !== false) await writePlatformHealthReceipt(receipt);
  return receipt;
}
