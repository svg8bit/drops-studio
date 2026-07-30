import { createHash, randomUUID } from "node:crypto";
import { findArtifactSecrets } from "./artifact-security.ts";
import type { ProjectV2 } from "./project-v2-types.ts";

export const RUNTIME_OUTPUT_LIMIT_BYTES = 64_000;
export const RUNTIME_LOG_CHUNK_LIMIT = 256;
export const RUNTIME_FILE_LIMIT = 256;
export const RUNTIME_FILE_BYTES_LIMIT = 1_500_000;
export const RUNTIME_TOTAL_BYTES_LIMIT = 8_000_000;

export type ProjectRuntimeProvider = "legacy-html" | "vercel-sandbox";
export type ProjectRuntimeStatus =
  | "creating"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "unavailable";
export type RuntimeCommandKind =
  | "install"
  | "command"
  | "typecheck"
  | "lint"
  | "test"
  | "build"
  | "preview"
  | "browser-check"
  | "checkpoint-restore";

export interface RuntimeProjectFile {
  path: string;
  content: string;
  hash?: string;
  generated?: boolean;
}

export interface RuntimeCheckpointSnapshot {
  checkpointId: string;
  revision: number;
  files: RuntimeProjectFile[];
}

export interface RuntimeActorContext {
  actorId: string;
  project: ProjectV2;
  requestId: string;
  runtimeAllowedHosts?: string[];
}

export interface RuntimeHandle {
  provider: ProjectRuntimeProvider;
  projectId: string;
  sandboxName: string | null;
  sessionId: string | null;
  workspaceRoot: string;
  revisionDigest: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface RuntimeState {
  provider: ProjectRuntimeProvider;
  status: ProjectRuntimeStatus;
  sandboxName: string | null;
  sessionId: string | null;
  vcpus: number | null;
  memoryMb: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  activeDurationMs: number | null;
  previewUrl: string | null;
  previewCommandId: string | null;
}

export interface RuntimeCommandInput {
  id: string;
  kind: RuntimeCommandKind;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  detached?: boolean;
  previewPort?: 3000 | 8080;
}

export interface RuntimeLogChunk {
  sequence: number;
  stream: "stdout" | "stderr";
  data: string;
  recordedAt: string;
}

export interface RuntimeCommandResult {
  commandId: string;
  runId: string;
  kind: RuntimeCommandKind;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
  previewUrl: string | null;
  auditEventIds?: string[];
}

export interface RuntimePreviewResult extends RuntimeCommandResult {
  exitCode: null;
  previewUrl: string;
  port: 3000 | 8080;
}

export interface RuntimeAuditEvent {
  id: string;
  requestId: string;
  actorHash: string;
  projectId: string;
  provider: ProjectRuntimeProvider;
  action: string;
  status: "started" | "succeeded" | "failed" | "denied";
  commandId?: string;
  argv?: string[];
  detail?: string;
  occurredAt: string;
}

export interface RuntimeAuditSink {
  record(event: RuntimeAuditEvent): Promise<void>;
}

export interface RuntimeInstallOptions {
  packageManager?: "npm";
  timeoutMs?: number;
  registryHosts?: string[];
  sourceHosts?: string[];
}

export interface RuntimeLogReadOptions {
  commandId: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface RuntimeCleanupOptions {
  idleBefore: Date;
  limit?: number;
}

export interface RuntimeCleanupResult {
  inspected: number;
  stopped: string[];
  failed: string[];
}

export interface ProjectRuntimeAdapter {
  readonly provider: ProjectRuntimeProvider;
  ensure(context: RuntimeActorContext): Promise<RuntimeHandle>;
  resume(context: RuntimeActorContext): Promise<RuntimeHandle | null>;
  status(handle: RuntimeHandle): Promise<RuntimeState>;
  writeProject(
    context: RuntimeActorContext,
    handle?: RuntimeHandle,
  ): Promise<RuntimeHandle>;
  readFile(handle: RuntimeHandle, path: string): Promise<string>;
  installDependencies(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    options?: RuntimeInstallOptions,
  ): Promise<RuntimeCommandResult>;
  runCommand(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    input: RuntimeCommandInput,
  ): Promise<RuntimeCommandResult>;
  startPreview(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    input?: {
      script?: string;
      port?: 3000 | 8080;
      timeoutMs?: number;
    },
  ): Promise<RuntimePreviewResult>;
  readLogs(
    handle: RuntimeHandle,
    options: RuntimeLogReadOptions,
  ): Promise<RuntimeLogChunk[]>;
  stopProcess(handle: RuntimeHandle, commandId: string): Promise<void>;
  runTypecheck(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script?: string,
  ): Promise<RuntimeCommandResult>;
  runLint(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script?: string,
  ): Promise<RuntimeCommandResult>;
  runTests(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script?: string,
  ): Promise<RuntimeCommandResult>;
  runBuild(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
    script?: string,
  ): Promise<RuntimeCommandResult>;
  captureCheckpoint(
    handle: RuntimeHandle,
    checkpointId: string,
    revision: number,
    paths: string[],
  ): Promise<RuntimeCheckpointSnapshot>;
  restoreCheckpoint(
    context: RuntimeActorContext,
    checkpoint: RuntimeCheckpointSnapshot,
    handle?: RuntimeHandle,
  ): Promise<RuntimeHandle>;
  stop(handle: RuntimeHandle): Promise<void>;
  destroy(handle: RuntimeHandle): Promise<void>;
  cleanupIdle(options: RuntimeCleanupOptions): Promise<RuntimeCleanupResult>;
}

export class ProjectRuntimeValidationError extends Error {
  constructor(message: string) {
    super(secretFreeRuntimeMessage(message, "Runtime request is invalid."));
    this.name = "ProjectRuntimeValidationError";
  }
}

export class ProjectRuntimeUnavailableError extends Error {
  constructor(message = "Project runtime is unavailable.") {
    super(secretFreeRuntimeMessage(message, "Project runtime is unavailable."));
    this.name = "ProjectRuntimeUnavailableError";
  }
}

export class ProjectRuntimeProviderError extends Error {
  constructor(message = "Project runtime provider failed.") {
    super(secretFreeRuntimeMessage(message, "Project runtime provider failed."));
    this.name = "ProjectRuntimeProviderError";
  }
}

export function secretFreeRuntimeMessage(
  value: unknown,
  fallback: string,
  limit = 300,
): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (!message || findArtifactSecrets(message, "runtime message").length) {
    return fallback;
  }
  return (
    message
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, limit) || fallback
  );
}

export function assertRuntimePath(value: unknown, label = "Runtime path"): string {
  if (typeof value !== "string") {
    throw new ProjectRuntimeValidationError(`${label} must be a POSIX path.`);
  }
  const path = value.trim();
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("//") ||
    !/^[a-z0-9@._/+-]+$/i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ProjectRuntimeValidationError(`${label} must stay inside the project.`);
  }
  return path;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function runtimeFileEntry(path: string, value: unknown): RuntimeProjectFile {
  const safePath = assertRuntimePath(path, "Project file path");
  if (typeof value === "string") return { path: safePath, content: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectRuntimeValidationError(`${safePath} must contain a text file.`);
  }
  const file = value as Record<string, unknown>;
  if (typeof file.content !== "string") {
    throw new ProjectRuntimeValidationError(`${safePath} must contain text.`);
  }
  return {
    path: safePath,
    content: file.content,
    ...(typeof file.hash === "string" ? { hash: file.hash } : {}),
    ...(typeof file.generated === "boolean"
      ? { generated: file.generated }
      : typeof file.origin === "string"
        ? { generated: file.origin === "generated" }
        : {}),
  };
}

export function projectRuntimeFiles(project: ProjectV2): RuntimeProjectFile[] {
  const raw = (project as unknown as { files?: unknown }).files;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProjectRuntimeValidationError("Project V2 files are required.");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > RUNTIME_FILE_LIMIT) {
    throw new ProjectRuntimeValidationError(
      `Project must contain between 1 and ${RUNTIME_FILE_LIMIT} files.`,
    );
  }
  let total = 0;
  const seen = new Set<string>();
  const files = entries.map(([recordPath, value]) => {
    const embeddedPath =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).path
        : undefined;
    const path = typeof embeddedPath === "string" ? embeddedPath : recordPath;
    const file = runtimeFileEntry(path, value);
    if (recordPath !== file.path && assertRuntimePath(recordPath) !== file.path) {
      throw new ProjectRuntimeValidationError(
        `Project file key ${recordPath} does not match ${file.path}.`,
      );
    }
    if (seen.has(file.path)) {
      throw new ProjectRuntimeValidationError(`${file.path} is duplicated.`);
    }
    seen.add(file.path);
    const size = byteLength(file.content);
    if (size > RUNTIME_FILE_BYTES_LIMIT) {
      throw new ProjectRuntimeValidationError(`${file.path} exceeds the file limit.`);
    }
    total += size;
    if (total > RUNTIME_TOTAL_BYTES_LIMIT) {
      throw new ProjectRuntimeValidationError("Project source exceeds the runtime limit.");
    }
    if (findArtifactSecrets(file.content, file.path).length) {
      throw new ProjectRuntimeValidationError("Project source contains secret material.");
    }
    return file;
  });
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export function validateRuntimeCheckpointFiles(
  files: readonly RuntimeProjectFile[],
): RuntimeProjectFile[] {
  if (!files.length || files.length > RUNTIME_FILE_LIMIT) {
    throw new ProjectRuntimeValidationError("Checkpoint file count is invalid.");
  }
  let total = 0;
  const seen = new Set<string>();
  return files.map((file) => {
    const path = assertRuntimePath(file.path);
    if (seen.has(path)) {
      throw new ProjectRuntimeValidationError(`${path} is duplicated.`);
    }
    seen.add(path);
    if (typeof file.content !== "string") {
      throw new ProjectRuntimeValidationError(`${path} must contain text.`);
    }
    const size = byteLength(file.content);
    total += size;
    if (size > RUNTIME_FILE_BYTES_LIMIT || total > RUNTIME_TOTAL_BYTES_LIMIT) {
      throw new ProjectRuntimeValidationError(
        "Checkpoint source exceeds runtime limits.",
      );
    }
    if (findArtifactSecrets(file.content, path).length) {
      throw new ProjectRuntimeValidationError(
        "Checkpoint source contains secret material.",
      );
    }
    return { ...file, path };
  });
}

export function projectRuntimeId(project: ProjectV2): string {
  const id = (project as unknown as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(id)) {
    throw new ProjectRuntimeValidationError("Project id is invalid.");
  }
  return id;
}

export function projectRuntimeRevision(project: ProjectV2): number {
  const input = project as unknown as {
    revision?: unknown;
    manifest?: { revision?: unknown };
    migration?: { revision?: unknown };
  };
  const revision = Number(
    input.revision ?? input.manifest?.revision ?? input.migration?.revision ?? 1,
  );
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ProjectRuntimeValidationError("Project revision is invalid.");
  }
  return revision;
}

export function runtimeRevisionDigest(
  projectId: string,
  revision: number,
  files: RuntimeProjectFile[],
): string {
  const digest = createHash("sha256");
  digest.update(`${projectId}\0${revision}\0`);
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(file.content);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function runtimeActorHash(actorId: string): string {
  if (!actorId || actorId.length > 240 || /[\u0000-\u001f\u007f]/.test(actorId)) {
    throw new ProjectRuntimeValidationError("Runtime actor identity is invalid.");
  }
  return createHash("sha256").update(actorId).digest("hex").slice(0, 16);
}

export function runtimeAuditEvent(
  context: RuntimeActorContext,
  provider: ProjectRuntimeProvider,
  input: Omit<RuntimeAuditEvent, "id" | "requestId" | "actorHash" | "projectId" | "provider" | "occurredAt">,
): RuntimeAuditEvent {
  return {
    id: randomUUID(),
    requestId: context.requestId,
    actorHash: runtimeActorHash(context.actorId),
    projectId: projectRuntimeId(context.project),
    provider,
    ...input,
    ...(input.detail
      ? { detail: secretFreeRuntimeMessage(input.detail, "Runtime action failed.") }
      : {}),
    occurredAt: new Date().toISOString(),
  };
}

export function boundedRuntimeOutput(
  value: unknown,
  label: string,
  limit = RUNTIME_OUTPUT_LIMIT_BYTES,
): { value: string; truncated: boolean } {
  const text = typeof value === "string" ? value.replace(/\0/g, "") : "";
  if (findArtifactSecrets(text, label).length) {
    return { value: "[redacted secret material]", truncated: false };
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= limit) return { value: text, truncated: false };
  return {
    value: new TextDecoder().decode(bytes.slice(0, limit)),
    truncated: true,
  };
}

export function assertRuntimeCommand(input: RuntimeCommandInput): RuntimeCommandInput {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input.id)) {
    throw new ProjectRuntimeValidationError("Runtime command id is invalid.");
  }
  if (!Array.isArray(input.argv) || input.argv.length < 2 || input.argv.length > 32) {
    throw new ProjectRuntimeValidationError("Runtime command argv is invalid.");
  }
  const argv = input.argv.map((argument) => {
    if (
      typeof argument !== "string" ||
      !argument ||
      argument.length > 300 ||
      /[\u0000-\u001f\u007f]/.test(argument) ||
      findArtifactSecrets(argument, "runtime argv").length
    ) {
      throw new ProjectRuntimeValidationError("Runtime command argument is invalid.");
    }
    return argument;
  });
  const executable = argv[0];
  if (!new Set(["npm", "node"]).has(executable)) {
    throw new ProjectRuntimeValidationError(
      "Runtime commands may execute only declared npm scripts or project Node files.",
    );
  }
  if (executable === "npm") {
    const command = argv[1]?.toLowerCase();
    if (command === "install" || command === "i" || command === "ci") {
      throw new ProjectRuntimeValidationError(
        "Dependency installation must use installDependencies.",
      );
    }
    if (!new Set(["run", "test", "start"]).has(command)) {
      throw new ProjectRuntimeValidationError("Only declared npm scripts may run.");
    }
    if (command === "run" && !/^[a-z0-9][a-z0-9:._-]{0,63}$/i.test(argv[2] ?? "")) {
      throw new ProjectRuntimeValidationError("npm run requires a safe script name.");
    }
  } else {
    const blocked = new Set(["-e", "--eval", "-p", "--print", "-r", "--require", "--import"]);
    for (const argument of argv.slice(1)) {
      if (blocked.has(argument.split("=", 1)[0])) {
        throw new ProjectRuntimeValidationError("Executable Node flags are blocked.");
      }
      if (!argument.startsWith("-") && (argument.startsWith("/") || argument.includes("\\") || argument.split("/").includes(".."))) {
        throw new ProjectRuntimeValidationError("Node files must stay inside the project.");
      }
    }
  }
  const timeoutMs = input.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new ProjectRuntimeValidationError("Runtime command timeout is invalid.");
  }
  return {
    ...input,
    argv,
    cwd: input.cwd ? assertRuntimePath(input.cwd, "Runtime cwd") : ".",
    timeoutMs,
  };
}

export class MemoryRuntimeAuditSink implements RuntimeAuditSink {
  readonly events: RuntimeAuditEvent[] = [];

  async record(event: RuntimeAuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export class NoopRuntimeAuditSink implements RuntimeAuditSink {
  async record(): Promise<void> {}
}
