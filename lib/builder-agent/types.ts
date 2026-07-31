import type { LanguageModel } from "ai";
import type { ProjectV2 } from "../project-v2-types.ts";
import type {
  ProjectRuntimeAdapter,
  RuntimeActorContext,
  RuntimeCheckpointSnapshot,
  RuntimeCommandResult,
  RuntimeHandle,
  RuntimeLogChunk,
  RuntimePreviewResult,
} from "../project-runtime-adapter.ts";

export const BUILDER_TOOL_NAMES = [
  "list_files",
  "read_file",
  "read_files",
  "search_files",
  "write_file",
  "apply_patch",
  "delete_file",
  "rename_file",
  "install_package",
  "run_command",
  "start_preview",
  "read_logs",
  "run_typecheck",
  "run_lint",
  "run_tests",
  "run_build",
  "browser_check",
  "create_checkpoint",
  "restore_checkpoint",
  "request_connection",
  "publish_project",
] as const;

export type BuilderToolName = (typeof BUILDER_TOOL_NAMES)[number];
export type BuilderProviderId =
  | "free"
  | "gateway"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "kimi"
  | "custom";

export type BuilderPermission =
  | "files:read"
  | "files:write"
  | "runtime:execute"
  | "runtime:network"
  | "preview:start"
  | "browser:check"
  | "checkpoint:write"
  | "checkpoint:restore"
  | "connection:request"
  | "project:publish";

export interface BuilderToolPolicy {
  permission: BuilderPermission;
  approval: "automatic" | "user";
  destructive: boolean;
  external: boolean;
  timeoutMs: number;
  outputBytes: number;
  secretRule: "reject-input-and-redact-output";
}

export interface BuilderAgentAuditEvent {
  id: string;
  requestId: string;
  actorHash: string;
  projectId: string;
  tool: BuilderToolName | "agent";
  status: "started" | "succeeded" | "failed" | "denied";
  detail?: string;
  occurredAt: string;
}

export interface BuilderAgentAuditSink {
  record(event: BuilderAgentAuditEvent): Promise<void>;
}

export interface BuilderProjectRepository {
  loadAuthorized(actorId: string, projectId: string): Promise<ProjectV2 | null>;
  saveAuthorized(
    actorId: string,
    project: ProjectV2,
    expectedRevision: number,
  ): Promise<ProjectV2>;
}

export interface BuilderBrowserCheckResult {
  ok: boolean;
  rendered: boolean;
  primaryInteractionChecked: boolean;
  statusCode: number | null;
  pageErrors: string[];
  consoleErrors: string[];
  networkErrors: string[];
  summary: string;
}

export interface BuilderBrowserChecker {
  check(input: {
    url: string;
    project: ProjectV2;
    signal?: AbortSignal;
  }): Promise<BuilderBrowserCheckResult>;
}

export interface BuilderConnectionRequester {
  request(input: {
    actorId: string;
    projectId: string;
    kind: "dropstab" | "drops-bot" | "telegram" | "database" | "github" | "vercel";
    reason: string;
  }): Promise<{ status: "connected" | "setup-required"; message: string }>;
}

export interface BuilderProjectPublisher {
  publish(input: {
    actorId: string;
    project: ProjectV2;
    target: "legacy" | "vercel-preview";
  }): Promise<{ deploymentId: string; status: "queued" | "building" | "ready" | "failed"; url: string | null }>;
}

export interface BuilderProviderSelection {
  provider: BuilderProviderId;
  model?: string;
  baseUrl?: string;
}

export interface BuilderProviderCredentials {
  apiKey?: string;
  openRouterKey?: string;
  gatewayToken?: string;
}

export interface BuilderModelEvidence {
  provider: Exclude<BuilderProviderId, "free">;
  model: string;
  credentialOwner: "platform" | "visitor";
  keyPersisted: false;
}

export interface BuilderModelResolution {
  model: LanguageModel;
  evidence: BuilderModelEvidence;
}

export type BuilderModelResolver = (
  selection: BuilderProviderSelection,
  credentials: BuilderProviderCredentials,
) => Promise<BuilderModelResolution> | BuilderModelResolution;

export interface BuilderAgentRequest {
  projectId: string;
  prompt: string;
  mode: "build" | "edit" | "repair";
  provider: BuilderProviderSelection;
  approvedTools?: BuilderToolName[];
}

export interface BuilderReleaseCheck {
  name: "install" | "typecheck" | "lint" | "tests" | "build" | "preview" | "browser";
  status: "passed" | "failed" | "skipped";
  summary: string;
  command?: RuntimeCommandResult;
  preview?: RuntimePreviewResult;
  browser?: BuilderBrowserCheckResult;
}

export interface BuilderReleaseGateResult {
  ok: boolean;
  checks: BuilderReleaseCheck[];
  blockingErrors: string[];
  previewUrl: string | null;
}

export interface BuilderAgentSessionDependencies {
  actorId: string;
  requestId: string;
  project: ProjectV2;
  repository: BuilderProjectRepository;
  runtime: ProjectRuntimeAdapter;
  permissions: ReadonlySet<BuilderPermission>;
  audit: BuilderAgentAuditSink;
  signal?: AbortSignal;
  browser?: BuilderBrowserChecker;
  connections?: BuilderConnectionRequester;
  publisher?: BuilderProjectPublisher;
}

export interface BuilderToolExecutionServices {
  readonly actorId: string;
  readonly requestId: string;
  readonly project: ProjectV2;
  readonly runtimeContext: RuntimeActorContext;
  readonly permissions: ReadonlySet<BuilderPermission>;
  listFiles(): string[];
  readFile(path: string): string;
  readFiles(paths: string[]): Array<{ path: string; content: string }>;
  searchFiles(query: string, paths?: string[]): Array<{ path: string; line: number; text: string }>;
  writeFile(path: string, content: string): Promise<ProjectV2>;
  applyPatch(path: string, replacements: Array<{ search: string; replace: string }>): Promise<ProjectV2>;
  deleteFile(path: string): Promise<ProjectV2>;
  renameFile(from: string, to: string): Promise<ProjectV2>;
  installPackage(name: string, version: string, dev: boolean): Promise<RuntimeCommandResult>;
  runTask(taskId: string): Promise<RuntimeCommandResult>;
  startPreview(script?: string, port?: 3000 | 8080): Promise<RuntimePreviewResult>;
  readLogs(commandId: string, limit?: number): Promise<RuntimeLogChunk[]>;
  runTypecheck(): Promise<RuntimeCommandResult | null>;
  runLint(): Promise<RuntimeCommandResult | null>;
  runTests(): Promise<RuntimeCommandResult | null>;
  runBuild(): Promise<RuntimeCommandResult>;
  browserCheck(): Promise<BuilderBrowserCheckResult>;
  createCheckpoint(label: string): Promise<{ project: ProjectV2; checkpoint: RuntimeCheckpointSnapshot }>;
  restoreCheckpoint(checkpointId: string): Promise<ProjectV2>;
  requestConnection(
    kind: Parameters<BuilderConnectionRequester["request"]>[0]["kind"],
    reason: string,
  ): Promise<{ status: "connected" | "setup-required"; message: string }>;
  publishProject(
    target: "legacy" | "vercel-preview",
  ): Promise<{ deploymentId: string; status: "queued" | "building" | "ready" | "failed"; url: string | null }>;
  ensureRuntime(): Promise<RuntimeHandle>;
  runReleaseGate(options?: { install?: boolean }): Promise<BuilderReleaseGateResult>;
}

export interface BuilderDeterministicFallback {
  run(input: {
    prompt: string;
    mode: BuilderAgentRequest["mode"];
    services: BuilderToolExecutionServices;
  }): Promise<{ summary: string }>;
}

export interface BuilderAgentResult {
  status: "completed" | "blocked" | "approval-required" | "fallback";
  providerMode: "ai-agent" | "deterministic-fallback";
  summary: string;
  project: ProjectV2;
  attempts: number;
  repairs: number;
  releaseGate: BuilderReleaseGateResult;
  evidence: BuilderModelEvidence | null;
  approvalTools: BuilderToolName[];
}
