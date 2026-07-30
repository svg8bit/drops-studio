import { randomUUID } from "node:crypto";
import { findArtifactSecrets } from "../artifact-security.ts";
import { runtimeActorHash, secretFreeRuntimeMessage } from "../project-runtime-adapter.ts";
import type {
  BuilderAgentAuditEvent,
  BuilderAgentAuditSink,
  BuilderPermission,
  BuilderToolName,
  BuilderToolPolicy,
} from "./types.ts";

export const BUILDER_TOOL_POLICIES: Readonly<Record<BuilderToolName, BuilderToolPolicy>> = {
  list_files: policy("files:read", 10_000),
  read_file: policy("files:read", 10_000),
  read_files: policy("files:read", 10_000),
  search_files: policy("files:read", 10_000),
  write_file: policy("files:write", 20_000),
  apply_patch: policy("files:write", 20_000),
  delete_file: policy("files:write", 20_000, { approval: "user", destructive: true }),
  rename_file: policy("files:write", 20_000, { approval: "user", destructive: true }),
  install_package: policy("runtime:network", 300_000, { external: true }),
  run_command: policy("runtime:execute", 300_000),
  start_preview: policy("preview:start", 90_000),
  read_logs: policy("runtime:execute", 10_000),
  run_typecheck: policy("runtime:execute", 300_000),
  run_lint: policy("runtime:execute", 300_000),
  run_tests: policy("runtime:execute", 300_000),
  run_build: policy("runtime:execute", 300_000),
  browser_check: policy("browser:check", 60_000),
  create_checkpoint: policy("checkpoint:write", 30_000),
  restore_checkpoint: policy("checkpoint:restore", 60_000, {
    approval: "user",
    destructive: true,
  }),
  request_connection: policy("connection:request", 30_000),
  publish_project: policy("project:publish", 300_000, {
    approval: "user",
    external: true,
  }),
};

function policy(
  permission: BuilderPermission,
  timeoutMs: number,
  options: Partial<Pick<BuilderToolPolicy, "approval" | "destructive" | "external">> = {},
): BuilderToolPolicy {
  return Object.freeze({
    permission,
    timeoutMs,
    outputBytes: 32_000,
    approval: options.approval ?? "automatic",
    destructive: options.destructive ?? false,
    external: options.external ?? false,
    secretRule: "reject-input-and-redact-output",
  });
}

export class BuilderAgentPermissionError extends Error {
  constructor(message = "Builder tool permission was denied.") {
    super(message);
    this.name = "BuilderAgentPermissionError";
  }
}

export class MemoryBuilderAgentAuditSink implements BuilderAgentAuditSink {
  readonly events: BuilderAgentAuditEvent[] = [];

  async record(event: BuilderAgentAuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export class NoopBuilderAgentAuditSink implements BuilderAgentAuditSink {
  async record(): Promise<void> {}
}

export function assertToolPermission(
  permissions: ReadonlySet<BuilderPermission>,
  tool: BuilderToolName,
): void {
  const permission = BUILDER_TOOL_POLICIES[tool].permission;
  if (!permissions.has(permission)) {
    throw new BuilderAgentPermissionError(
      `${tool} requires the ${permission} permission.`,
    );
  }
}

export function assertToolInputSecretFree(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BuilderAgentPermissionError("Builder tool input is not serializable.");
  }
  if (findArtifactSecrets(serialized, "builder tool input").length) {
    throw new BuilderAgentPermissionError(
      "Secret material cannot be passed to builder tools.",
    );
  }
}

export function builderAuditEvent(input: {
  actorId: string;
  requestId: string;
  projectId: string;
  tool: BuilderToolName | "agent";
  status: BuilderAgentAuditEvent["status"];
  detail?: unknown;
}): BuilderAgentAuditEvent {
  return {
    id: randomUUID(),
    requestId: input.requestId,
    actorHash: runtimeActorHash(input.actorId),
    projectId: input.projectId,
    tool: input.tool,
    status: input.status,
    ...(input.detail
      ? {
          detail: secretFreeRuntimeMessage(
            input.detail,
            "Builder action could not be completed.",
          ),
        }
      : {}),
    occurredAt: new Date().toISOString(),
  };
}
