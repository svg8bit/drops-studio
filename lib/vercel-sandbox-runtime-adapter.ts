import { createHash, randomUUID } from "node:crypto";
import { findArtifactSecrets } from "./artifact-security.ts";
import {
  NoopRuntimeAuditSink,
  ProjectRuntimeProviderError,
  ProjectRuntimeUnavailableError,
  ProjectRuntimeValidationError,
  RUNTIME_FILE_BYTES_LIMIT,
  RUNTIME_FILE_LIMIT,
  RUNTIME_LOG_CHUNK_LIMIT,
  RUNTIME_OUTPUT_LIMIT_BYTES,
  assertRuntimeCommand,
  assertRuntimePath,
  boundedRuntimeOutput,
  projectRuntimeFiles,
  projectRuntimeId,
  projectRuntimeRevision,
  runtimeActorHash,
  runtimeAuditEvent,
  runtimeRevisionDigest,
  secretFreeRuntimeMessage,
  validateRuntimeCheckpointFiles,
  type ProjectRuntimeAdapter,
  type RuntimeActorContext,
  type RuntimeAuditSink,
  type RuntimeCheckpointSnapshot,
  type RuntimeCleanupOptions,
  type RuntimeCleanupResult,
  type RuntimeCommandInput,
  type RuntimeCommandResult,
  type RuntimeHandle,
  type RuntimeInstallOptions,
  type RuntimeLogChunk,
  type RuntimeLogReadOptions,
  type RuntimePreviewResult,
  type RuntimeProjectFile,
  type RuntimeState,
} from "./project-runtime-adapter.ts";

const SANDBOX_ROOT = "/vercel/sandbox/.drops-studio/projects";
const DEFAULT_SANDBOX_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_BUILD_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 3 * 60_000;
const MAX_PREVIEW_START_TIMEOUT_MS = 60_000;
const DEFAULT_INSTALL_HOSTS = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
] as const;
const RUNTIME_ARTIFACT_ROOTS = new Set([
  ".cache",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);
const RUNTIME_ARTIFACT_FILES = new Set([
  ".eslintcache",
  ".stylelintcache",
  "next-env.d.ts",
]);
const SAFE_COMMAND_ENV = Object.freeze({
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
});

function commandEnvironment(kind: RuntimeCommandInput["kind"]): Record<string, string> {
  return {
    ...SAFE_COMMAND_ENV,
    NODE_ENV:
      kind === "build" ? "production" : kind === "test" ? "test" : "development",
  };
}

export type SandboxNetworkPolicy =
  | "deny-all"
  | { allow: string[] };

export interface SandboxCommandClient {
  readonly cmdId: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly exitCode: number | null;
  logs(options?: { signal?: AbortSignal }): AsyncIterable<{
    stream: "stdout" | "stderr";
    data: string;
  }> & { close?: () => void };
  wait(options?: { signal?: AbortSignal }): Promise<SandboxCommandClient>;
  stdout(options?: { signal?: AbortSignal }): Promise<string>;
  stderr(options?: { signal?: AbortSignal }): Promise<string>;
  kill(
    signal?: "SIGTERM" | "SIGKILL",
    options?: { abortSignal?: AbortSignal },
  ): Promise<void>;
}

export interface SandboxFileSystemClient {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Array<{
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean }>;
}

export interface VercelSandboxClient {
  readonly name: string;
  readonly persistent: boolean;
  readonly vcpus?: number;
  readonly memory?: number;
  readonly runtime?: string;
  readonly status:
    | "pending"
    | "running"
    | "stopping"
    | "stopped"
    | "failed"
    | "aborted"
    | "snapshotting";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
  readonly tags?: Record<string, string>;
  readonly fs: SandboxFileSystemClient;
  currentSession(): { sessionId: string };
  writeFiles(
    files: Array<{ path: string; content: string | Uint8Array }>,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  runCommand(input: {
    cmd: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    detached: true;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<SandboxCommandClient>;
  getCommand(
    commandId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SandboxCommandClient>;
  domain(port: number): string;
  update(
    input: {
      persistent?: boolean;
      resources?: { vcpus?: number };
      timeout?: number;
      networkPolicy?: SandboxNetworkPolicy;
      ports?: number[];
      tags?: Record<string, string>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  stop(options?: { signal?: AbortSignal }): Promise<unknown>;
  delete(options?: { signal?: AbortSignal }): Promise<void>;
}

export interface SandboxListRecord {
  name: string;
  status: VercelSandboxClient["status"];
  createdAt: number;
  updatedAt: number;
}

export interface VercelSandboxProvider {
  getOrCreate(input: Record<string, unknown>): Promise<VercelSandboxClient>;
  get(input: Record<string, unknown>): Promise<VercelSandboxClient>;
  list(input: Record<string, unknown>): Promise<AsyncIterable<SandboxListRecord>>;
}

export interface VercelSandboxCredentials {
  token: string;
  teamId: string;
  projectId: string;
}

export interface VercelSandboxRuntimeOptions {
  provider?: VercelSandboxProvider;
  audit?: RuntimeAuditSink;
  fetch?: typeof fetch;
  credentials?: VercelSandboxCredentials | null;
  timeoutMs?: number;
  runtimeAllowedHosts?: string[];
}

interface PreviewRecord {
  commandId: string;
  url: string;
  port: 3000 | 8080;
}

function configuredCredentials(): VercelSandboxCredentials | null {
  const token = process.env.VERCEL_TOKEN?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  // OIDC, including VERCEL_OIDC_TOKEN in local development, is resolved by
  // the stable SDK. Automatically injected team/project identifiers must not
  // force the explicit personal-token path.
  if (!token) return null;
  if (!teamId || !projectId) {
    throw new ProjectRuntimeUnavailableError(
      "Local Sandbox credentials require VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID together.",
    );
  }
  return { token, teamId, projectId };
}

async function defaultProvider(): Promise<VercelSandboxProvider> {
  if (process.env.DROPS_STUDIO_TEST_DISABLE_SANDBOX === "1") {
    throw new ProjectRuntimeUnavailableError(
      "Sandbox execution is disabled for the deterministic browser-test matrix.",
    );
  }
  try {
    const { Sandbox } = await import("@vercel/sandbox");
    return {
      getOrCreate: (input) =>
        Sandbox.getOrCreate(
          input as unknown as Parameters<typeof Sandbox.getOrCreate>[0],
        ) as unknown as Promise<VercelSandboxClient>,
      get: (input) =>
        Sandbox.get(
          input as unknown as Parameters<typeof Sandbox.get>[0],
        ) as unknown as Promise<VercelSandboxClient>,
      list: async (input) =>
        (await Sandbox.list(
          input as unknown as Parameters<typeof Sandbox.list>[0],
        )) as unknown as AsyncIterable<SandboxListRecord>,
    };
  } catch {
    throw new ProjectRuntimeUnavailableError(
      "The stable @vercel/sandbox runtime is unavailable.",
    );
  }
}

function projectHash(projectId: string): string {
  return createHash("sha256").update(projectId).digest("hex").slice(0, 16);
}

export function sandboxNameFor(actorId: string, projectId: string): string {
  return `ds2-${runtimeActorHash(actorId)}-${projectHash(projectId)}`;
}

function workspaceRoot(projectId: string, digest: string): string {
  return `${SANDBOX_ROOT}/${projectHash(projectId)}/revisions/${digest}`;
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("*.") ? host.slice(2) : host;
  if (
    !host ||
    host.length > 253 ||
    !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare === "0.0.0.0" ||
    bare === "169.254.169.254" ||
    /^\d+(?:\.\d+){3}$/.test(bare)
  ) {
    throw new ProjectRuntimeValidationError("Sandbox network host is invalid.");
  }
  return host;
}

function networkPolicy(hosts: readonly string[]): SandboxNetworkPolicy {
  const allow = [...new Set(hosts.map(normalizeHost))].sort();
  return allow.length ? { allow } : "deny-all";
}

function commandDate(command: SandboxCommandClient): string {
  return new Date(command.startedAt).toISOString();
}

function isMissingProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /not.?found|404|missing/i.test(message);
}

function normalizeStatus(status: VercelSandboxClient["status"]): RuntimeState["status"] {
  if (status === "pending" || status === "snapshotting") return "creating";
  if (status === "running") return "running";
  if (status === "stopping") return "stopping";
  if (status === "stopped" || status === "aborted") return "stopped";
  return "failed";
}

function parentDirectories(root: string, paths: string[]): string[] {
  const directories = new Set<string>([root]);
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      directories.add(`${root}/${parts.slice(0, index).join("/")}`);
    }
  }
  return [...directories].sort((left, right) => left.length - right.length);
}

async function withDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Sandbox command exceeded its bounded timeout."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class VercelSandboxRuntimeAdapter implements ProjectRuntimeAdapter {
  readonly provider = "vercel-sandbox" as const;
  readonly #providerOverride?: VercelSandboxProvider;
  readonly #audit: RuntimeAuditSink;
  readonly #fetch: typeof fetch;
  readonly #credentials: VercelSandboxCredentials | null;
  readonly #timeoutMs: number;
  readonly #runtimeAllowedHosts: string[];
  readonly #sandboxes = new Map<string, VercelSandboxClient>();
  readonly #previews = new Map<string, PreviewRecord>();

  constructor(options: VercelSandboxRuntimeOptions = {}) {
    this.#providerOverride = options.provider;
    this.#audit = options.audit ?? new NoopRuntimeAuditSink();
    this.#fetch = options.fetch ?? fetch;
    this.#credentials =
      options.credentials === undefined
        ? configuredCredentials()
        : options.credentials;
    this.#timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS, 60_000),
      60 * 60_000,
    );
    this.#runtimeAllowedHosts = (options.runtimeAllowedHosts ?? []).map(normalizeHost);
  }

  async ensure(context: RuntimeActorContext): Promise<RuntimeHandle> {
    const projectId = projectRuntimeId(context.project);
    const files = projectRuntimeFiles(context.project);
    const revision = projectRuntimeRevision(context.project);
    const digest = runtimeRevisionDigest(projectId, revision, files);
    const name = sandboxNameFor(context.actorId, projectId);
    await this.#audit.record(
      runtimeAuditEvent(context, this.provider, {
        action: "sandbox.ensure",
        status: "started",
      }),
    );
    try {
      const provider = await this.#provider();
      const sandbox = await provider.getOrCreate({
        name,
        runtime: "node24",
        resources: { vcpus: 2 },
        persistent: true,
        ports: [3000, 8080],
        timeout: this.#timeoutMs,
        env: {},
        networkPolicy: "deny-all",
        snapshotExpiration: 24 * 60 * 60_000,
        keepLastSnapshots: { count: 3, deleteEvicted: true },
        tags: {
          application: "drops-studio",
          owner: runtimeActorHash(context.actorId),
          project: projectHash(projectId),
        },
        resume: true,
        ...this.#credentialsInput(),
      });
      if (!sandbox.persistent || sandbox.runtime !== "node24") {
        throw new ProjectRuntimeProviderError(
          "Sandbox did not satisfy the persistent Node 24 runtime contract.",
        );
      }
      if (sandbox.vcpus !== undefined && sandbox.vcpus < 2) {
        throw new ProjectRuntimeProviderError(
          "Sandbox did not satisfy the 2 vCPU resource contract.",
        );
      }
      await sandbox.update({
        persistent: true,
        resources: { vcpus: 2 },
        timeout: this.#timeoutMs,
        ports: [3000, 8080],
        networkPolicy: "deny-all",
      });
      this.#sandboxes.set(name, sandbox);
      const handle = this.#handle(sandbox, projectId, digest);
      await this.#audit.record(
        runtimeAuditEvent(context, this.provider, {
          action: "sandbox.ensure",
          status: "succeeded",
        }),
      );
      return handle;
    } catch (error) {
      await this.#audit.record(
        runtimeAuditEvent(context, this.provider, {
          action: "sandbox.ensure",
          status: "failed",
          detail: secretFreeRuntimeMessage(error, "Sandbox provisioning failed."),
        }),
      );
      if (
        error instanceof ProjectRuntimeProviderError ||
        error instanceof ProjectRuntimeUnavailableError ||
        error instanceof ProjectRuntimeValidationError
      ) {
        throw error;
      }
      throw new ProjectRuntimeProviderError("Sandbox provisioning failed.");
    }
  }

  async resume(context: RuntimeActorContext): Promise<RuntimeHandle | null> {
    const projectId = projectRuntimeId(context.project);
    const files = projectRuntimeFiles(context.project);
    const digest = runtimeRevisionDigest(
      projectId,
      projectRuntimeRevision(context.project),
      files,
    );
    const name = sandboxNameFor(context.actorId, projectId);
    try {
      const sandbox = await (await this.#provider()).get({
        name,
        // Status, logs and stop use resume() as a passive lookup. Merely
        // inspecting a project must never restart a stopped paid runtime.
        // Executing actions use ensure(), whose getOrCreate call opts into
        // provider resume explicitly.
        resume: false,
        ...this.#credentialsInput(),
      });
      this.#sandboxes.set(name, sandbox);
      return this.#handle(sandbox, projectId, digest);
    } catch (error) {
      if (isMissingProviderError(error)) return null;
      throw new ProjectRuntimeProviderError("Sandbox could not be resumed.");
    }
  }

  async status(handle: RuntimeHandle): Promise<RuntimeState> {
    const sandbox = await this.#sandbox(handle);
    const status = normalizeStatus(sandbox.status);
    const preview = status === "running"
      ? await this.#livePreview(sandbox)
      : null;
    return {
      provider: this.provider,
      status,
      sandboxName: sandbox.name,
      sessionId: sandbox.currentSession().sessionId,
      vcpus: sandbox.vcpus ?? null,
      memoryMb: sandbox.memory ?? (sandbox.vcpus ? sandbox.vcpus * 2048 : null),
      // The current workspace treats createdAt as the start of a live timer.
      // Do not expose a live-timer anchor once execution is terminal.
      createdAt:
        status === "stopped" || status === "failed"
          ? null
          : sandbox.createdAt.toISOString(),
      updatedAt: sandbox.updatedAt.toISOString(),
      expiresAt: sandbox.expiresAt?.toISOString() ?? null,
      activeDurationMs:
        status === "creating" || status === "running" || status === "stopping"
          ? Math.max(0, Date.now() - sandbox.createdAt.getTime())
          : null,
      previewUrl: preview?.url ?? null,
      previewCommandId: preview?.commandId ?? null,
    };
  }

  async writeProject(
    context: RuntimeActorContext,
    handle?: RuntimeHandle,
  ): Promise<RuntimeHandle> {
    const current = handle ?? (await this.ensure(context));
    const files = projectRuntimeFiles(context.project);
    const revision = projectRuntimeRevision(context.project);
    const digest = runtimeRevisionDigest(current.projectId, revision, files);
    return this.#writeRevision(context, current, revision, digest, files);
  }

  async readFile(handle: RuntimeHandle, path: string): Promise<string> {
    const safePath = assertRuntimePath(path);
    const sandbox = await this.#sandbox(handle);
    const absolute = `${handle.workspaceRoot}/${safePath}`;
    try {
      const metadata = await sandbox.fs.lstat(absolute);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new ProjectRuntimeValidationError("Runtime file is not a regular file.");
      }
      const content = await sandbox.fs.readFile(absolute, "utf8");
      const bounded = boundedRuntimeOutput(content, safePath, RUNTIME_FILE_BYTES_LIMIT);
      if (bounded.truncated) {
        throw new ProjectRuntimeValidationError("Runtime file exceeds the read limit.");
      }
      return bounded.value;
    } catch (error) {
      if (error instanceof ProjectRuntimeValidationError) throw error;
      throw new ProjectRuntimeProviderError(`${safePath} could not be read.`);
    }
  }

  async installDependencies(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    options: RuntimeInstallOptions = {},
  ): Promise<RuntimeCommandResult> {
    if (options.packageManager && options.packageManager !== "npm") {
      throw new ProjectRuntimeValidationError("Only npm is supported.");
    }
    const sandbox = await this.#sandbox(handle);
    const installHosts = [
      ...DEFAULT_INSTALL_HOSTS,
      ...(options.registryHosts ?? []),
      ...(options.sourceHosts ?? []),
    ];
    await sandbox.update({ networkPolicy: networkPolicy(installHosts) });
    try {
      return await this.runCommand(context, handle, {
        id: "install-dependencies",
        kind: "install",
        argv: [
          "npm",
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
        ],
        timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS, 300_000),
      }, true);
    } finally {
      await sandbox.update({
        networkPolicy: networkPolicy([
          ...this.#runtimeAllowedHosts,
          ...(context.runtimeAllowedHosts ?? []),
        ]),
      });
    }
  }

  async runCommand(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    input: RuntimeCommandInput,
    allowInstall = false,
  ): Promise<RuntimeCommandResult> {
    const commandInput = allowInstall
      ? this.#assertInstallCommand(input)
      : assertRuntimeCommand(input);
    const sandbox = await this.#sandbox(handle);
    const cwd =
      !commandInput.cwd || commandInput.cwd === "."
        ? handle.workspaceRoot
        : `${handle.workspaceRoot}/${commandInput.cwd}`;
    const startedAudit = runtimeAuditEvent(context, this.provider, {
      action: `command.${commandInput.kind}`,
      status: "started",
      argv: commandInput.argv,
    });
    await this.#audit.record(startedAudit);
    let command: SandboxCommandClient | null = null;
    try {
      command = await sandbox.runCommand({
        cmd: commandInput.argv[0],
        args: commandInput.argv.slice(1),
        cwd,
        env: commandEnvironment(commandInput.kind),
        detached: true,
        timeoutMs: commandInput.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      });
      const result = await this.#collectCommand(command, commandInput, cwd);
      const completedAudit = runtimeAuditEvent(context, this.provider, {
        action: `command.${commandInput.kind}`,
        status: result.exitCode === 0 ? "succeeded" : "failed",
        commandId: result.commandId,
        argv: commandInput.argv,
        ...(result.exitCode === 0
          ? {}
          : { detail: `Command exited with status ${result.exitCode}.` }),
      });
      await this.#audit.record(completedAudit);
      return {
        ...result,
        auditEventIds: [startedAudit.id, completedAudit.id],
      };
    } catch (error) {
      await command?.kill("SIGKILL").catch(() => undefined);
      await this.#audit.record(
        runtimeAuditEvent(context, this.provider, {
          action: `command.${commandInput.kind}`,
          status: "failed",
          commandId: command?.cmdId,
          argv: commandInput.argv,
          detail: secretFreeRuntimeMessage(error, "Sandbox command failed."),
        }),
      );
      throw new ProjectRuntimeProviderError(
        secretFreeRuntimeMessage(error, "Sandbox command failed."),
      );
    }
  }

  async startPreview(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    input: { script?: string; port?: 3000 | 8080; timeoutMs?: number } = {},
  ): Promise<RuntimePreviewResult> {
    const sandbox = await this.#sandbox(handle);
    const port = input.port ?? 3000;
    const script = input.script ?? "dev";
    if (!/^[a-z0-9][a-z0-9:._-]{0,63}$/i.test(script)) {
      throw new ProjectRuntimeValidationError("Preview script is invalid.");
    }
    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? 30_000, 1_000),
      MAX_PREVIEW_START_TIMEOUT_MS,
    );
    const existing = this.#previews.get(sandbox.name) ?? this.#previewFromTags(sandbox);
    if (existing) {
      await this.stopProcess(handle, existing.commandId).catch(() => undefined);
    }
    const startedAudit = runtimeAuditEvent(context, this.provider, {
      action: "preview.start",
      status: "started",
      argv: ["npm", "run", script],
    });
    await this.#audit.record(startedAudit);
    const command = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", script, "--", "--hostname", "0.0.0.0", "--port", String(port)],
      cwd: handle.workspaceRoot,
      env: { ...SAFE_COMMAND_ENV, NODE_ENV: "development", PORT: String(port) },
      detached: true,
      timeoutMs: Math.max(this.#timeoutMs - 5_000, 60_000),
    });
    let url: URL;
    try {
      url = new URL(sandbox.domain(port));
      if (url.protocol !== "https:") throw new Error("insecure domain");
      await this.#waitForPreview(url, timeoutMs, command);
    } catch (error) {
      await command.kill("SIGKILL").catch(() => undefined);
      const diagnostic = await withDeadline(2_000, async (signal) => {
        const [stdout, stderr] = await Promise.all([
          command.stdout({ signal }).catch(() => ""),
          command.stderr({ signal }).catch(() => ""),
        ]);
        return boundedRuntimeOutput(
          `${stdout}\n${stderr}`.trim(),
          "preview startup output",
          2_000,
        ).value;
      }).catch(() => "");
      const detail = [
        secretFreeRuntimeMessage(error, "Preview did not become ready."),
        diagnostic,
      ].filter(Boolean).join(" ");
      await this.#audit.record(
        runtimeAuditEvent(context, this.provider, {
          action: "preview.start",
          status: "failed",
          commandId: command.cmdId,
          detail,
        }),
      );
      throw new ProjectRuntimeProviderError(detail);
    }
    const preview = { commandId: command.cmdId, url: url.toString(), port };
    this.#previews.set(sandbox.name, preview);
    await sandbox.update({
      tags: {
        ...(sandbox.tags ?? {}),
        previewCommand: command.cmdId,
        previewPort: String(port),
      },
    });
    const completedAudit = runtimeAuditEvent(context, this.provider, {
      action: "preview.start",
      status: "succeeded",
      commandId: command.cmdId,
    });
    await this.#audit.record(completedAudit);
    return {
      commandId: command.cmdId,
      runId: randomUUID(),
      kind: "preview",
      argv: ["npm", "run", script],
      cwd: handle.workspaceRoot,
      exitCode: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      startedAt: commandDate(command),
      finishedAt: null,
      previewUrl: preview.url,
      port,
      auditEventIds: [startedAudit.id, completedAudit.id],
    };
  }

  async readLogs(
    handle: RuntimeHandle,
    options: RuntimeLogReadOptions,
  ): Promise<RuntimeLogChunk[]> {
    const sandbox = await this.#sandbox(handle);
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(options.commandId)) {
      throw new ProjectRuntimeValidationError("Command id is invalid.");
    }
    const command = await sandbox.getCommand(options.commandId);
    const limit = Math.min(
      Math.max(options.limit ?? RUNTIME_LOG_CHUNK_LIMIT, 1),
      RUNTIME_LOG_CHUNK_LIMIT,
    );
    const timeout = AbortSignal.timeout(2_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    const chunks: RuntimeLogChunk[] = [];
    let outputBytes = 0;
    const logs = command.logs({ signal });
    try {
      for await (const line of logs) {
        const remaining = Math.max(0, RUNTIME_OUTPUT_LIMIT_BYTES - outputBytes);
        if (!remaining) break;
        const bounded = boundedRuntimeOutput(
          line.data,
          "runtime log",
          Math.min(8_000, remaining),
        );
        chunks.push({
          sequence: chunks.length,
          stream: line.stream,
          data: bounded.value,
          recordedAt: new Date().toISOString(),
        });
        outputBytes += new TextEncoder().encode(bounded.value).byteLength;
        if (
          chunks.length >= limit ||
          bounded.truncated ||
          outputBytes >= RUNTIME_OUTPUT_LIMIT_BYTES
        ) {
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        throw new ProjectRuntimeProviderError(
          secretFreeRuntimeMessage(error, "Runtime logs are unavailable."),
        );
      }
    } finally {
      logs.close?.();
    }
    if (
      findArtifactSecrets(
        chunks.map((chunk) => chunk.data).join(""),
        "runtime logs",
      ).length
    ) {
      return chunks.map((chunk) => ({
        ...chunk,
        data: "[redacted secret material]",
      }));
    }
    return chunks;
  }

  async stopProcess(handle: RuntimeHandle, commandId: string): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    const command = await sandbox.getCommand(commandId);
    await command.kill("SIGTERM");
    try {
      await withDeadline(2_000, (signal) => command.wait({ signal }));
    } catch {
      await command.kill("SIGKILL").catch(() => undefined);
    }
    const preview = this.#previews.get(sandbox.name) ?? this.#previewFromTags(sandbox);
    if (preview?.commandId === commandId) {
      this.#previews.delete(sandbox.name);
      await sandbox.update({
        tags: Object.fromEntries(
          Object.entries(sandbox.tags ?? {}).filter(
            ([key]) => key !== "previewCommand" && key !== "previewPort",
          ),
        ),
      });
    }
  }

  async runTypecheck(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script = "typecheck",
  ): Promise<RuntimeCommandResult> {
    return this.#runScript(context, handle, "typecheck", script, DEFAULT_BUILD_TIMEOUT_MS);
  }

  async runLint(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script = "lint",
  ): Promise<RuntimeCommandResult> {
    return this.#runScript(context, handle, "lint", script, DEFAULT_BUILD_TIMEOUT_MS);
  }

  async runTests(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script = "test",
  ): Promise<RuntimeCommandResult> {
    return this.#runScript(context, handle, "test", script, DEFAULT_BUILD_TIMEOUT_MS);
  }

  async runBuild(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script = "build",
  ): Promise<RuntimeCommandResult> {
    return this.#runScript(context, handle, "build", script, DEFAULT_BUILD_TIMEOUT_MS);
  }

  async captureCheckpoint(
    handle: RuntimeHandle,
    checkpointId: string,
    revision: number,
    paths: string[],
  ): Promise<RuntimeCheckpointSnapshot> {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(checkpointId)) {
      throw new ProjectRuntimeValidationError("Checkpoint id is invalid.");
    }
    const safePaths = [...new Set(paths.map((path) => assertRuntimePath(path)))];
    if (!safePaths.length || safePaths.length > RUNTIME_FILE_LIMIT) {
      throw new ProjectRuntimeValidationError("Checkpoint paths are invalid.");
    }
    const files = await Promise.all(
      safePaths.map(async (path) => ({
        path,
        content: await this.readFile(handle, path),
      })),
    );
    return {
      checkpointId,
      revision,
      files: validateRuntimeCheckpointFiles(files),
    };
  }

  async restoreCheckpoint(
    context: RuntimeActorContext,
    checkpoint: RuntimeCheckpointSnapshot,
    handle?: RuntimeHandle,
  ): Promise<RuntimeHandle> {
    if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1) {
      throw new ProjectRuntimeValidationError("Checkpoint revision is invalid.");
    }
    const current = handle ?? (await this.ensure(context));
    const files = validateRuntimeCheckpointFiles(checkpoint.files);
    const digest = runtimeRevisionDigest(
      current.projectId,
      checkpoint.revision,
      files,
    );
    await this.#audit.record(
      runtimeAuditEvent(context, this.provider, {
        action: "checkpoint.restore",
        status: "started",
      }),
    );
    const restored = await this.#writeRevision(
      context,
      current,
      checkpoint.revision,
      digest,
      files,
    );
    await this.#audit.record(
      runtimeAuditEvent(context, this.provider, {
        action: "checkpoint.restore",
        status: "succeeded",
      }),
    );
    return restored;
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    await this.#clearPreviewMetadata(sandbox).catch(() => undefined);
    await sandbox.stop();
    this.#previews.delete(sandbox.name);
    this.#sandboxes.delete(sandbox.name);
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    await this.#clearPreviewMetadata(sandbox).catch(() => undefined);
    await sandbox.delete();
    this.#previews.delete(sandbox.name);
    this.#sandboxes.delete(sandbox.name);
  }

  async cleanupIdle(options: RuntimeCleanupOptions): Promise<RuntimeCleanupResult> {
    const provider = await this.#provider();
    // The stable Sandbox list API currently rejects page sizes above 50.
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
    const stopped: string[] = [];
    const failed: string[] = [];
    let inspected = 0;
    const sandboxes = await provider.list({
      namePrefix: "ds2-",
      sortBy: "name",
      limit,
      ...this.#credentialsInput(),
    });
    for await (const record of sandboxes) {
      inspected += 1;
      if (record.updatedAt >= options.idleBefore.getTime()) continue;
      try {
        const sandbox = await provider.get({
          name: record.name,
          resume: false,
          ...this.#credentialsInput(),
        });
        await sandbox.stop();
        stopped.push(record.name);
      } catch {
        failed.push(record.name);
      }
    }
    return { inspected, stopped, failed };
  }

  async #provider(): Promise<VercelSandboxProvider> {
    return this.#providerOverride ?? defaultProvider();
  }

  #credentialsInput(): Record<string, string> {
    return this.#credentials ? { ...this.#credentials } : {};
  }

  #handle(
    sandbox: VercelSandboxClient,
    projectId: string,
    digest: string,
  ): RuntimeHandle {
    return {
      provider: this.provider,
      projectId,
      sandboxName: sandbox.name,
      sessionId: sandbox.currentSession().sessionId,
      workspaceRoot: workspaceRoot(projectId, digest),
      revisionDigest: digest,
      createdAt: sandbox.createdAt.toISOString(),
      expiresAt: sandbox.expiresAt?.toISOString() ?? null,
    };
  }

  async #sandbox(handle: RuntimeHandle): Promise<VercelSandboxClient> {
    if (handle.provider !== this.provider || !handle.sandboxName) {
      throw new ProjectRuntimeValidationError("Sandbox runtime handle is invalid.");
    }
    const cached = this.#sandboxes.get(handle.sandboxName);
    if (cached) return cached;
    try {
      const provider = await this.#provider();
      const sandbox = await provider.get({
        name: handle.sandboxName,
        resume: true,
        ...this.#credentialsInput(),
      });
      this.#sandboxes.set(handle.sandboxName, sandbox);
      return sandbox;
    } catch (error) {
      if (isMissingProviderError(error)) {
        throw new ProjectRuntimeUnavailableError("Sandbox no longer exists.");
      }
      throw new ProjectRuntimeProviderError("Sandbox could not be resumed.");
    }
  }

  async #writeRevision(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    revision: number,
    digest: string,
    files: RuntimeProjectFile[],
  ): Promise<RuntimeHandle> {
    const sandbox = await this.#sandbox(handle);
    const finalRoot = workspaceRoot(handle.projectId, digest);
    const stagingRoot = `${finalRoot}.staging-${randomUUID()}`;
    try {
      if (await this.#revisionMatches(sandbox, finalRoot, files)) {
        await this.#activateRevision(sandbox, handle.projectId, revision, digest);
        return this.#handle(sandbox, handle.projectId, digest);
      }
      if (await this.#revisionExists(sandbox, finalRoot)) {
        throw new ProjectRuntimeProviderError(
          "Existing Sandbox revision failed source-integrity verification.",
        );
      }
      await sandbox.fs.mkdir(stagingRoot, { recursive: true });
      for (const directory of parentDirectories(stagingRoot, files.map((file) => file.path))) {
        await sandbox.fs.mkdir(directory, { recursive: true });
      }
      await sandbox.writeFiles(
        files.map((file) => ({
          path: `${stagingRoot}/${file.path}`,
          content: file.content,
        })),
      );
      for (const file of files) {
        const metadata = await sandbox.fs.lstat(`${stagingRoot}/${file.path}`);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
          throw new ProjectRuntimeProviderError(
            "Sandbox created an unsafe filesystem entry.",
          );
        }
      }
      await sandbox.fs.rename(stagingRoot, finalRoot);
      await this.#activateRevision(sandbox, handle.projectId, revision, digest);
      const next = this.#handle(sandbox, handle.projectId, digest);
      await this.#audit.record(
        runtimeAuditEvent(context, this.provider, {
          action: "filesystem.write-revision",
          status: "succeeded",
          detail: `Wrote ${files.length} project files at revision ${revision}.`,
        }),
      );
      return next;
    } catch (error) {
      await sandbox.fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof ProjectRuntimeProviderError) throw error;
      throw new ProjectRuntimeProviderError("Project files could not be written atomically.");
    }
  }

  async #revisionMatches(
    sandbox: VercelSandboxClient,
    root: string,
    files: RuntimeProjectFile[],
  ): Promise<boolean> {
    try {
      const actualPaths: string[] = [];
      const expectedPaths = files.map((file) => file.path).sort();
      const expected = new Set(expectedPaths);
      const containsExpectedSource = (relative: string): boolean =>
        expected.has(relative) ||
        expectedPaths.some((path) => path.startsWith(`${relative}/`));
      const runtimeArtifact = (relative: string): boolean => {
        if (containsExpectedSource(relative)) return false;
        const rootName = relative.split("/", 1)[0];
        return (
          RUNTIME_ARTIFACT_ROOTS.has(rootName) ||
          RUNTIME_ARTIFACT_FILES.has(relative) ||
          relative.endsWith(".tsbuildinfo")
        );
      };
      const visit = async (directory: string, prefix: string): Promise<void> => {
        const entries = await sandbox.fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (runtimeArtifact(relative)) continue;
          if (entry.isSymbolicLink()) return Promise.reject(new Error("unsafe link"));
          const absolute = `${directory}/${entry.name}`;
          if (entry.isDirectory()) await visit(absolute, relative);
          else if (entry.isFile()) actualPaths.push(relative);
          else return Promise.reject(new Error("unsafe filesystem entry"));
        }
      };
      await visit(root, "");
      if (
        actualPaths.sort().length !== expectedPaths.length ||
        actualPaths.some((path, index) => path !== expectedPaths[index])
      ) {
        return false;
      }
      for (const file of files) {
        const absolute = `${root}/${file.path}`;
        const metadata = await sandbox.fs.lstat(absolute);
        if (metadata.isSymbolicLink() || !metadata.isFile()) return false;
        if ((await sandbox.fs.readFile(absolute, "utf8")) !== file.content) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async #revisionExists(
    sandbox: VercelSandboxClient,
    root: string,
  ): Promise<boolean> {
    try {
      await sandbox.fs.readdir(root, { withFileTypes: true });
      return true;
    } catch {
      return false;
    }
  }

  async #activateRevision(
    sandbox: VercelSandboxClient,
    projectId: string,
    revision: number,
    digest: string,
  ): Promise<void> {
    const markerRoot = `${SANDBOX_ROOT}/${projectHash(projectId)}`;
    const temporary = `${markerRoot}/active-${randomUUID()}.json`;
    await sandbox.fs.mkdir(markerRoot, { recursive: true });
    await sandbox.writeFiles([
      { path: temporary, content: JSON.stringify({ revision, digest }) },
    ]);
    await sandbox.fs.rename(temporary, `${markerRoot}/active.json`);
  }

  #previewFromTags(sandbox: VercelSandboxClient): PreviewRecord | null {
    const commandId = sandbox.tags?.previewCommand;
    const rawPort = Number(sandbox.tags?.previewPort);
    if (
      !commandId ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(commandId) ||
      (rawPort !== 3000 && rawPort !== 8080)
    ) {
      return null;
    }
    try {
      const url = new URL(sandbox.domain(rawPort));
      if (url.protocol !== "https:") return null;
      return { commandId, port: rawPort, url: url.toString() };
    } catch {
      return null;
    }
  }

  async #livePreview(sandbox: VercelSandboxClient): Promise<PreviewRecord | null> {
    const preview = this.#previews.get(sandbox.name) ?? this.#previewFromTags(sandbox);
    if (!preview) return null;
    try {
      const command = await withDeadline(2_000, (signal) =>
        sandbox.getCommand(preview.commandId, { signal })
      );
      if (command.exitCode === null) return preview;
    } catch (error) {
      if (!isMissingProviderError(error)) {
        throw new ProjectRuntimeProviderError(
          secretFreeRuntimeMessage(
            error,
            "Sandbox preview status is temporarily unavailable.",
          ),
        );
      }
    }
    await this.#clearPreviewMetadata(sandbox).catch(() => undefined);
    return null;
  }

  async #clearPreviewMetadata(sandbox: VercelSandboxClient): Promise<void> {
    this.#previews.delete(sandbox.name);
    const tags = Object.fromEntries(
      Object.entries(sandbox.tags ?? {}).filter(
        ([key]) => key !== "previewCommand" && key !== "previewPort",
      ),
    );
    if (
      sandbox.tags?.previewCommand !== undefined
      || sandbox.tags?.previewPort !== undefined
    ) {
      await sandbox.update({ tags });
    }
  }

  #assertInstallCommand(input: RuntimeCommandInput): RuntimeCommandInput {
    const expectedArgv = [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ];
    if (
      input.kind !== "install" ||
      input.argv.length !== expectedArgv.length ||
      input.argv.some((argument, index) => argument !== expectedArgv[index])
    ) {
      throw new ProjectRuntimeValidationError("Dependency installation command is invalid.");
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
    if (timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new ProjectRuntimeValidationError("Install timeout is invalid.");
    }
    return { ...input, cwd: ".", detached: true, timeoutMs };
  }

  async #collectCommand(
    command: SandboxCommandClient,
    input: RuntimeCommandInput,
    cwd: string,
  ): Promise<RuntimeCommandResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs + 2_000);
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    const logs = command.logs({ signal });
    try {
      for await (const line of logs) {
        const currentBytes = new TextEncoder().encode(stdout + stderr).byteLength;
        const remaining = Math.max(0, RUNTIME_OUTPUT_LIMIT_BYTES - currentBytes);
        const next = boundedRuntimeOutput(line.data, "runtime command output", remaining);
        if (line.stream === "stdout") stdout += next.value;
        else stderr += next.value;
        outputTruncated ||= next.truncated || remaining === 0;
        if (outputTruncated) {
          logs.close?.();
          break;
        }
      }
      const finished = await withDeadline(timeoutMs + 2_000, (waitSignal) =>
        command.wait({ signal: waitSignal }),
      );
      if (!stdout && !stderr) {
        const [rawStdout, rawStderr] = await Promise.all([
          finished.stdout({ signal }),
          finished.stderr({ signal }),
        ]);
        const boundedStdout = boundedRuntimeOutput(rawStdout, "runtime stdout");
        const remaining = Math.max(
          0,
          RUNTIME_OUTPUT_LIMIT_BYTES - new TextEncoder().encode(boundedStdout.value).byteLength,
        );
        const boundedStderr = boundedRuntimeOutput(rawStderr, "runtime stderr", remaining);
        stdout = boundedStdout.value;
        stderr = boundedStderr.value;
        outputTruncated ||= boundedStdout.truncated || boundedStderr.truncated;
      }
      if (findArtifactSecrets(`${stdout}\n${stderr}`, "runtime output").length) {
        stdout = stdout ? "[redacted secret material]" : "";
        stderr = stderr ? "[redacted secret material]" : "";
      }
      const finishedAt = Date.now();
      return {
        commandId: command.cmdId,
        runId: randomUUID(),
        kind: input.kind,
        argv: [...input.argv],
        cwd,
        exitCode: finished.exitCode,
        stdout,
        stderr,
        outputTruncated,
        startedAt: commandDate(command),
        finishedAt: new Date(finishedAt).toISOString(),
        previewUrl: null,
      };
    } finally {
      logs.close?.();
    }
  }

  async #runScript(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    kind: "typecheck" | "lint" | "test" | "build",
    script: string,
    timeoutMs: number,
  ): Promise<RuntimeCommandResult> {
    if (!/^[a-z0-9][a-z0-9:._-]{0,63}$/i.test(script)) {
      throw new ProjectRuntimeValidationError("npm script name is invalid.");
    }
    return this.runCommand(context, handle, {
      id: `run-${kind}`,
      kind,
      argv: ["npm", "run", script],
      timeoutMs,
    });
  }

  async #waitForPreview(
    url: URL,
    timeoutMs: number,
    command: SandboxCommandClient,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      if (command.exitCode !== null) {
        throw new Error(`Preview process exited with status ${command.exitCode}.`);
      }
      try {
        const response = await this.#fetch(url, {
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(Math.min(3_000, timeoutMs)),
        });
        lastStatus = response.status;
        if (response.status >= 200 && response.status < 400) return;
      } catch {
        // The server may still be compiling; retry only until the bounded deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      lastStatus
        ? `Preview returned HTTP ${lastStatus}.`
        : "Preview did not answer before its startup timeout.",
    );
  }
}
