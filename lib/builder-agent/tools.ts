import { tool, type ToolApprovalConfiguration, type ToolSet } from "ai";
import { z } from "zod";
import { findArtifactSecrets } from "../artifact-security.ts";
import {
  secretFreeRuntimeMessage,
  type RuntimeCommandResult,
} from "../project-runtime-adapter.ts";
import {
  BUILDER_TOOL_POLICIES,
  assertToolInputSecretFree,
  assertToolPermission,
  builderAuditEvent,
} from "./policy.ts";
import {
  BUILDER_TOOL_NAMES,
  type BuilderAgentAuditSink,
  type BuilderToolName,
  type BuilderToolExecutionServices,
} from "./types.ts";

const pathSchema = z.string().min(1).max(240);
const messageSchema = z.string().max(2_000);
const commandOutputSchema = z.object({
  commandId: z.string(),
  kind: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
}).strict();

function commandOutput(command: RuntimeCommandResult) {
  return {
    commandId: command.commandId,
    kind: command.kind,
    exitCode: command.exitCode,
    stdout: command.stdout,
    stderr: command.stderr,
    outputTruncated: command.outputTruncated,
  };
}

async function withTimeout<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Builder tool exceeded its bounded timeout.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertSecretFreeOutput(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (findArtifactSecrets(serialized, "builder tool output").length) {
    throw new Error("Builder tool output contained secret material and was blocked.");
  }
}

function assertBoundedToolOutput(value: unknown, limit: number): void {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > limit) {
    throw new Error(
      "Builder tool output exceeded its bounded limit. Narrow the requested files or search.",
    );
  }
}

function executeTool<INPUT, OUTPUT>(input: {
  name: BuilderToolName;
  services: BuilderToolExecutionServices;
  audit: BuilderAgentAuditSink;
  value: INPUT;
  execute: () => Promise<OUTPUT> | OUTPUT;
}): Promise<OUTPUT> {
  const policy = BUILDER_TOOL_POLICIES[input.name];
  return (async () => {
    try {
      assertToolPermission(input.services.permissions, input.name);
      assertToolInputSecretFree(input.value);
    } catch (error) {
      await input.audit.record(
        builderAuditEvent({
          actorId: input.services.actorId,
          requestId: input.services.requestId,
          projectId: input.services.project.id,
          tool: input.name,
          status: "denied",
          detail: error,
        }),
      );
      throw error;
    }
    await input.audit.record(
      builderAuditEvent({
        actorId: input.services.actorId,
        requestId: input.services.requestId,
        projectId: input.services.project.id,
        tool: input.name,
        status: "started",
      }),
    );
    try {
      const output = await withTimeout(policy.timeoutMs, async () => input.execute());
      assertSecretFreeOutput(output);
      assertBoundedToolOutput(output, policy.outputBytes);
      await input.audit.record(
        builderAuditEvent({
          actorId: input.services.actorId,
          requestId: input.services.requestId,
          projectId: input.services.project.id,
          tool: input.name,
          status: "succeeded",
        }),
      );
      return output;
    } catch (error) {
      await input.audit.record(
        builderAuditEvent({
          actorId: input.services.actorId,
          requestId: input.services.requestId,
          projectId: input.services.project.id,
          tool: input.name,
          status: "failed",
          detail: error,
        }),
      );
      throw new Error(
        secretFreeRuntimeMessage(error, `${input.name} could not be completed.`),
      );
    }
  })();
}

export function createBuilderAgentTools(
  services: BuilderToolExecutionServices,
  audit: BuilderAgentAuditSink,
) {
  return {
    list_files: tool({
      description: "List every real file in the current Project V2 filesystem.",
      strict: true,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ files: z.array(pathSchema), revision: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "list_files",
        services,
        audit,
        value,
        execute: () => ({ files: services.listFiles(), revision: services.project.revision }),
      }),
    }),
    read_file: tool({
      description: "Read one bounded text file from the current project.",
      strict: true,
      inputSchema: z.object({ path: pathSchema }).strict(),
      outputSchema: z.object({ path: pathSchema, content: z.string(), revision: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "read_file",
        services,
        audit,
        value,
        execute: () => ({ path: value.path, content: services.readFile(value.path), revision: services.project.revision }),
      }),
    }),
    read_files: tool({
      description: "Read up to 20 bounded project text files.",
      strict: true,
      inputSchema: z.object({ paths: z.array(pathSchema).min(1).max(20) }).strict(),
      outputSchema: z.object({
        files: z.array(z.object({ path: pathSchema, content: z.string() }).strict()),
        revision: z.number().int(),
      }).strict(),
      execute: (value) => executeTool({
        name: "read_files",
        services,
        audit,
        value,
        execute: () => ({ files: services.readFiles(value.paths), revision: services.project.revision }),
      }),
    }),
    search_files: tool({
      description: "Search literal text across current project files.",
      strict: true,
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        paths: z.array(pathSchema).max(30).nullable(),
      }).strict(),
      outputSchema: z.object({
        matches: z.array(z.object({ path: pathSchema, line: z.number().int(), text: z.string() }).strict()),
      }).strict(),
      execute: (value) => executeTool({
        name: "search_files",
        services,
        audit,
        value,
        execute: () => ({ matches: services.searchFiles(value.query, value.paths ?? undefined) }),
      }),
    }),
    write_file: tool({
      description: "Create or replace one editable project file atomically.",
      strict: true,
      inputSchema: z.object({ path: pathSchema, content: z.string().max(512_000) }).strict(),
      outputSchema: z.object({ path: pathSchema, revision: z.number().int(), hash: z.string() }).strict(),
      execute: (value) => executeTool({
        name: "write_file",
        services,
        audit,
        value,
        execute: async () => {
          const project = await services.writeFile(value.path, value.content);
          const file = project.files[value.path];
          return { path: value.path, revision: project.revision, hash: file?.hash ?? "" };
        },
      }),
    }),
    apply_patch: tool({
      description: "Apply bounded exact, unique text replacements to one real project file.",
      strict: true,
      inputSchema: z.object({
        path: pathSchema,
        replacements: z.array(z.object({
          search: z.string().min(1).max(100_000),
          replace: z.string().max(100_000),
        }).strict()).min(1).max(32),
      }).strict(),
      outputSchema: z.object({ path: pathSchema, revision: z.number().int(), replacements: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "apply_patch",
        services,
        audit,
        value,
        execute: async () => ({
          path: value.path,
          revision: (await services.applyPatch(value.path, value.replacements)).revision,
          replacements: value.replacements.length,
        }),
      }),
    }),
    delete_file: tool({
      description: "Delete one editable, non-required project file after user approval.",
      strict: true,
      inputSchema: z.object({ path: pathSchema }).strict(),
      outputSchema: z.object({ path: pathSchema, revision: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "delete_file",
        services,
        audit,
        value,
        execute: async () => ({ path: value.path, revision: (await services.deleteFile(value.path)).revision }),
      }),
    }),
    rename_file: tool({
      description: "Rename one editable, non-required project file after user approval.",
      strict: true,
      inputSchema: z.object({ from: pathSchema, to: pathSchema }).strict(),
      outputSchema: z.object({ from: pathSchema, to: pathSchema, revision: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "rename_file",
        services,
        audit,
        value,
        execute: async () => ({ from: value.from, to: value.to, revision: (await services.renameFile(value.from, value.to)).revision }),
      }),
    }),
    install_package: tool({
      description: "Add an explicit semver dependency to package.json and install it with the restricted registry policy.",
      strict: true,
      inputSchema: z.object({ name: z.string().min(1).max(192), version: z.string().min(5).max(80), dev: z.boolean() }).strict(),
      outputSchema: commandOutputSchema,
      execute: (value) => executeTool({
        name: "install_package",
        services,
        audit,
        value,
        execute: async () => commandOutput(await services.installPackage(value.name, value.version, value.dev)),
      }),
    }),
    run_command: tool({
      description: "Run one declared manifest task. Arbitrary shell commands are not accepted.",
      strict: true,
      inputSchema: z.object({ taskId: z.string().min(1).max(64) }).strict(),
      outputSchema: commandOutputSchema,
      execute: (value) => executeTool({
        name: "run_command",
        services,
        audit,
        value,
        execute: async () => commandOutput(await services.runTask(value.taskId)),
      }),
    }),
    start_preview: tool({
      description: "Start the actual detached development server and wait for its public Sandbox URL to answer.",
      strict: true,
      inputSchema: z.object({
        script: z.string().min(1).max(64).nullable(),
        port: z.union([z.literal(3000), z.literal(8080)]),
      }).strict(),
      outputSchema: z.object({ commandId: z.string(), url: z.string().url(), port: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "start_preview",
        services,
        audit,
        value,
        execute: async () => {
          const preview = await services.startPreview(value.script ?? undefined, value.port);
          return { commandId: preview.commandId, url: preview.previewUrl, port: preview.port };
        },
      }),
    }),
    read_logs: tool({
      description: "Read real bounded stdout and stderr chunks for a Sandbox command.",
      strict: true,
      inputSchema: z.object({ commandId: z.string().min(1).max(128), limit: z.number().int().min(1).max(256) }).strict(),
      outputSchema: z.object({
        chunks: z.array(z.object({ sequence: z.number().int(), stream: z.enum(["stdout", "stderr"]), data: z.string(), recordedAt: z.string() }).strict()),
      }).strict(),
      execute: (value) => executeTool({
        name: "read_logs",
        services,
        audit,
        value,
        execute: async () => ({ chunks: await services.readLogs(value.commandId, value.limit) }),
      }),
    }),
    run_typecheck: checkTool("run_typecheck", "Run the declared typecheck script.", services, audit, () => services.runTypecheck()),
    run_lint: checkTool("run_lint", "Run the declared lint script.", services, audit, () => services.runLint()),
    run_tests: checkTool("run_tests", "Run the declared test script.", services, audit, () => services.runTests()),
    run_build: checkTool("run_build", "Run the required production build script.", services, audit, () => services.runBuild()),
    browser_check: tool({
      description: "Render the live preview in a real browser and report page, console, network, and primary interaction checks.",
      strict: true,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        ok: z.boolean(),
        rendered: z.boolean(),
        primaryInteractionChecked: z.boolean(),
        statusCode: z.number().int().nullable(),
        pageErrors: z.array(z.string()),
        consoleErrors: z.array(z.string()),
        networkErrors: z.array(z.string()),
        summary: messageSchema,
      }).strict(),
      execute: (value) => executeTool({ name: "browser_check", services, audit, value, execute: () => services.browserCheck() }),
    }),
    create_checkpoint: tool({
      description: "Capture a complete immutable Project V2 source checkpoint.",
      strict: true,
      inputSchema: z.object({ label: z.string().min(1).max(120) }).strict(),
      outputSchema: z.object({ checkpointId: z.string(), revision: z.number().int(), files: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "create_checkpoint",
        services,
        audit,
        value,
        execute: async () => {
          const result = await services.createCheckpoint(value.label);
          return { checkpointId: result.checkpoint.checkpointId, revision: result.project.revision, files: result.checkpoint.files.length };
        },
      }),
    }),
    restore_checkpoint: tool({
      description: "Restore the complete canonical source snapshot after user approval.",
      strict: true,
      inputSchema: z.object({ checkpointId: z.string().min(1).max(128) }).strict(),
      outputSchema: z.object({ checkpointId: z.string(), revision: z.number().int() }).strict(),
      execute: (value) => executeTool({
        name: "restore_checkpoint",
        services,
        audit,
        value,
        execute: async () => ({ checkpointId: value.checkpointId, revision: (await services.restoreCheckpoint(value.checkpointId)).revision }),
      }),
    }),
    request_connection: tool({
      description: "Request a real platform connection or return an honest setup-required state.",
      strict: true,
      inputSchema: z.object({
        kind: z.enum(["dropstab", "drops-bot", "telegram", "database", "github", "vercel"]),
        reason: z.string().min(1).max(300),
      }).strict(),
      outputSchema: z.object({ status: z.enum(["connected", "setup-required"]), message: messageSchema }).strict(),
      execute: (value) => executeTool({ name: "request_connection", services, audit, value, execute: () => services.requestConnection(value.kind, value.reason) }),
    }),
    publish_project: tool({
      description: "Publish a release-gated project only after explicit user approval.",
      strict: true,
      inputSchema: z.object({ target: z.enum(["legacy", "vercel-preview"]) }).strict(),
      outputSchema: z.object({
        deploymentId: z.string(),
        status: z.enum(["queued", "building", "ready", "failed"]),
        url: z.string().url().nullable(),
      }).strict(),
      execute: (value) => executeTool({ name: "publish_project", services, audit, value, execute: () => services.publishProject(value.target) }),
    }),
  } satisfies ToolSet;
}

function checkTool(
  name: "run_typecheck" | "run_lint" | "run_tests" | "run_build",
  description: string,
  services: BuilderToolExecutionServices,
  audit: BuilderAgentAuditSink,
  executeCheck: () => Promise<RuntimeCommandResult | null>,
) {
  return tool({
    description,
    strict: true,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ skipped: z.boolean(), command: commandOutputSchema.nullable() }).strict(),
    execute: (value) => executeTool({
      name,
      services,
      audit,
      value,
      execute: async () => {
        const command = await executeCheck();
        return { skipped: command === null, command: command ? commandOutput(command) : null };
      },
    }),
  });
}

export function createBuilderToolApproval<TOOLS extends ToolSet>(
  approved: ReadonlySet<BuilderToolName>,
): ToolApprovalConfiguration<TOOLS, unknown> {
  return ((options: { toolCall: { toolName: string } }) => {
    const name = options.toolCall.toolName as BuilderToolName;
    if (!BUILDER_TOOL_NAMES.includes(name)) return "denied";
    const policy = BUILDER_TOOL_POLICIES[name];
    if (policy.approval === "automatic" || approved.has(name)) return "approved";
    return "user-approval";
  }) as ToolApprovalConfiguration<TOOLS, unknown>;
}
