import { randomUUID } from "node:crypto";
import { createProjectCheckpointV2, restoreProjectCheckpointV2 } from "../project-checkpoint-v2.ts";
import {
  applyProjectV2FileOperations,
  writeProjectV2File,
} from "../project-v2-files.ts";
import { normalizeProjectV2Path } from "../project-v2-path.ts";
import type {
  BuilderRunV2,
  ProjectFileOperationV2,
  ProjectLogMetadataV2,
  ProjectV2,
} from "../project-v2-types.ts";
import {
  ProjectRuntimeProviderError,
  ProjectRuntimeUnavailableError,
  ProjectRuntimeValidationError,
  boundedRuntimeOutput,
  type RuntimeActorContext,
  type RuntimeCheckpointSnapshot,
  type RuntimeCommandResult,
  type RuntimeHandle,
  type RuntimePreviewResult,
} from "../project-runtime-adapter.ts";
import type {
  BuilderAgentSessionDependencies,
  BuilderBrowserCheckResult,
  BuilderReleaseCheck,
  BuilderReleaseGateResult,
  BuilderToolExecutionServices,
} from "./types.ts";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SEARCH_RESULT_LIMIT = 100;

function errorSummary(error: unknown, fallback: string): string {
  if (
    error instanceof ProjectRuntimeValidationError ||
    error instanceof ProjectRuntimeUnavailableError ||
    error instanceof ProjectRuntimeProviderError
  ) {
    return error.message;
  }
  return fallback;
}

function failedCheck(
  name: BuilderReleaseCheck["name"],
  error: unknown,
  fallback: string,
): BuilderReleaseCheck {
  return { name, status: "failed", summary: errorSummary(error, fallback) };
}

function commandCheck(
  name: BuilderReleaseCheck["name"],
  command: RuntimeCommandResult,
): BuilderReleaseCheck {
  const diagnostic = boundedRuntimeOutput(
    command.stderr || command.stdout,
    `${name} diagnostic`,
    1_200,
  ).value.trim();
  return {
    name,
    status: command.exitCode === 0 ? "passed" : "failed",
    summary:
      command.exitCode === 0
        ? `${name} completed successfully.`
        : `${name} exited with status ${command.exitCode}.${diagnostic ? ` ${diagnostic}` : ""}`,
    command,
  };
}

function runtimeMetadataId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ProjectRuntimeProviderError(`${label} is invalid.`);
  }
  return value;
}

function appendCommandMetadata(
  project: ProjectV2,
  command: RuntimeCommandResult,
  taskId: string,
): ProjectV2 {
  const expectedKind =
    command.kind === "preview"
      ? "dev"
      : command.kind === "test"
        ? "test"
        : command.kind === "install"
          ? "build"
          : command.kind === "command"
            ? "custom"
            : command.kind;
  const task =
    project.tasks.find((entry) => entry.id === taskId) ??
    project.tasks.find((entry) => entry.kind === expectedKind) ??
    project.tasks.find((entry) => entry.kind === "build") ??
    project.tasks[0];
  // Legacy migrations may not expose executable task records. Their runtime
  // remains honest, but Project V2 cannot persist an invalid orphan run.
  if (!task) return project;
  const runId = runtimeMetadataId(command.runId, "Runtime run id");
  const safeTaskId = runtimeMetadataId(task.id, "Runtime task id");
  const logMetadata: ProjectLogMetadataV2[] = (
    ["stdout", "stderr"] as const
  ).flatMap((stream) => {
    const value = command[stream];
    if (!value) return [];
    return [{
      id: randomUUID(),
      runId,
      stream,
      bytes: new TextEncoder().encode(value).byteLength,
      truncated: command.outputTruncated,
      createdAt: command.finishedAt ?? command.startedAt,
    }];
  });
  const run: BuilderRunV2 = {
    id: runId,
    taskId: safeTaskId,
    projectRevision: project.revision,
    status:
      command.exitCode === null
        ? "running"
        : command.exitCode === 0
          ? "succeeded"
          : "failed",
    runtime: "vercel-sandbox",
    startedAt: command.startedAt,
    ...(command.finishedAt ? { finishedAt: command.finishedAt } : {}),
    exitCode: command.exitCode,
    logIds: logMetadata.map((entry) => entry.id),
    auditEventIds: (command.auditEventIds ?? []).map((id) =>
      runtimeMetadataId(id, "Runtime audit event id"),
    ),
  };
  const runs = [...project.runs.filter((entry) => entry.id !== runId), run].slice(-256);
  const retainedRunIds = new Set(runs.map((entry) => entry.id));
  const logs = [
    ...project.logs.filter((entry) => entry.runId !== runId),
    ...logMetadata,
  ]
    .filter((entry) => retainedRunIds.has(entry.runId))
    .slice(-2_048);
  return {
    ...project,
    runs,
    logs,
    updatedAt: new Date().toISOString(),
  };
}

export class BuilderAgentSession implements BuilderToolExecutionServices {
  readonly actorId: string;
  readonly requestId: string;
  readonly permissions: BuilderToolExecutionServices["permissions"];
  readonly #repository: BuilderAgentSessionDependencies["repository"];
  readonly #runtime: BuilderAgentSessionDependencies["runtime"];
  readonly #browser?: BuilderAgentSessionDependencies["browser"];
  readonly #connections?: BuilderAgentSessionDependencies["connections"];
  readonly #publisher?: BuilderAgentSessionDependencies["publisher"];
  #project: ProjectV2;
  #handle: RuntimeHandle | null = null;
  #runtimeSyncedRevision = 0;
  #preview: RuntimePreviewResult | null = null;

  constructor(dependencies: BuilderAgentSessionDependencies) {
    this.actorId = dependencies.actorId;
    this.requestId = dependencies.requestId;
    this.permissions = dependencies.permissions;
    this.#project = structuredClone(dependencies.project);
    this.#repository = dependencies.repository;
    this.#runtime = dependencies.runtime;
    this.#browser = dependencies.browser;
    this.#connections = dependencies.connections;
    this.#publisher = dependencies.publisher;
  }

  get project(): ProjectV2 {
    return structuredClone(this.#project);
  }

  get runtimeContext(): RuntimeActorContext {
    return {
      actorId: this.actorId,
      requestId: this.requestId,
      project: this.#project,
    };
  }

  listFiles(): string[] {
    return Object.keys(this.#project.files).sort();
  }

  readFile(path: string): string {
    const safePath = normalizeProjectV2Path(path);
    const file = this.#project.files[safePath];
    if (!file) throw new Error(`${safePath} was not found.`);
    return file.content;
  }

  readFiles(paths: string[]): Array<{ path: string; content: string }> {
    return [...new Set(paths.map(normalizeProjectV2Path))].map((path) => ({
      path,
      content: this.readFile(path),
    }));
  }

  searchFiles(
    query: string,
    paths?: string[],
  ): Array<{ path: string; line: number; text: string }> {
    const needle = query.trim().toLocaleLowerCase("en-US");
    if (!needle || needle.length > 200) throw new Error("Search query is invalid.");
    const selected = paths?.length
      ? [...new Set(paths.map(normalizeProjectV2Path))]
      : this.listFiles();
    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const path of selected) {
      const file = this.#project.files[path];
      if (!file) continue;
      const lines = file.content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLocaleLowerCase("en-US").includes(needle)) continue;
        const text = boundedRuntimeOutput(lines[index], "search result", 500).value;
        results.push({ path, line: index + 1, text });
        if (results.length >= SEARCH_RESULT_LIMIT) return results;
      }
    }
    return results;
  }

  async writeFile(path: string, content: string): Promise<ProjectV2> {
    const next = await writeProjectV2File(this.#project, this.#project.revision, {
      type: "write",
      path,
      content,
      provenance: "ai",
    });
    return this.#saveAndSync(next);
  }

  async applyPatch(
    path: string,
    replacements: Array<{ search: string; replace: string }>,
  ): Promise<ProjectV2> {
    const safePath = normalizeProjectV2Path(path);
    if (!replacements.length || replacements.length > 32) {
      throw new Error("Patch must contain 1-32 exact replacements.");
    }
    let content = this.readFile(safePath);
    for (const replacement of replacements) {
      if (!replacement.search || replacement.search.length > 100_000) {
        throw new Error("Patch search text is invalid.");
      }
      const first = content.indexOf(replacement.search);
      if (first < 0) throw new Error("Patch search text was not found exactly.");
      if (content.indexOf(replacement.search, first + replacement.search.length) >= 0) {
        throw new Error("Patch search text must match exactly once.");
      }
      content = `${content.slice(0, first)}${replacement.replace}${content.slice(
        first + replacement.search.length,
      )}`;
    }
    return this.writeFile(safePath, content);
  }

  async deleteFile(path: string): Promise<ProjectV2> {
    return this.#applyOperations([{ type: "delete", path }]);
  }

  async renameFile(from: string, to: string): Promise<ProjectV2> {
    return this.#applyOperations([
      { type: "rename", from, to, provenance: "ai" },
    ]);
  }

  async installPackage(
    name: string,
    version: string,
    dev: boolean,
  ): Promise<RuntimeCommandResult> {
    if (!PACKAGE_NAME.test(name) || !PACKAGE_VERSION.test(version)) {
      throw new Error("Package name and explicit semver version are required.");
    }
    const packageJson = JSON.parse(this.readFile("package.json")) as Record<string, unknown>;
    const field = dev ? "devDependencies" : "dependencies";
    const current = packageJson[field];
    if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) {
      throw new Error(`package.json ${field} must be an object.`);
    }
    packageJson[field] = {
      ...((current as Record<string, string> | undefined) ?? {}),
      [name]: version,
    };
    await this.writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
    const handle = await this.ensureRuntime();
    return this.#recordCommand(
      await this.#runtime.installDependencies(this.runtimeContext, handle),
      "build",
    );
  }

  async runTask(taskId: string): Promise<RuntimeCommandResult> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Only a declared Project V2 task may run.");
    if (task.approvalRequired) {
      throw new Error(
        "Approval-required tasks must use a dedicated approved external-action tool.",
      );
    }
    const handle = await this.ensureRuntime();
    return this.#recordCommand(await this.#runtime.runCommand(this.runtimeContext, handle, {
      id: task.id,
      kind: task.kind === "dev" ? "preview" : task.kind === "custom" ? "command" : task.kind,
      argv: [task.command, ...task.args],
      cwd: task.cwd,
      timeoutMs: task.timeoutMs,
      previewPort:
        task.previewPort === 3000 || task.previewPort === 8080
          ? task.previewPort
          : undefined,
    }), task.id);
  }

  async startPreview(
    script?: string,
    port?: 3000 | 8080,
  ): Promise<RuntimePreviewResult> {
    const handle = await this.ensureRuntime();
    const preview = await this.#runtime.startPreview(this.runtimeContext, handle, {
      script,
      port,
    });
    const expectedRevision = this.#project.revision;
    const next: ProjectV2 = {
      ...appendCommandMetadata(this.#project, preview, script ?? "dev"),
      updatedAt: new Date().toISOString(),
      preview: {
        status: "ready",
        projectRevision: expectedRevision,
        sandboxId: handle.sessionId ?? handle.sandboxName ?? undefined,
        url: preview.previewUrl,
        port: preview.port,
        startedAt: preview.startedAt,
      },
    };
    try {
      this.#project = await this.#repository.saveAuthorized(
        this.actorId,
        next,
        expectedRevision,
      );
    } catch (error) {
      await this.#runtime.stopProcess(handle, preview.commandId).catch(() => undefined);
      throw error;
    }
    this.#preview = preview;
    return preview;
  }

  async readLogs(commandId: string, limit?: number) {
    const handle = await this.ensureRuntime();
    return this.#runtime.readLogs(handle, { commandId, limit });
  }

  async runTypecheck(): Promise<RuntimeCommandResult | null> {
    if (!this.#project.manifest.scripts.typecheck) return null;
    return this.#recordCommand(
      await this.#runtime.runTypecheck(
        this.runtimeContext,
        await this.ensureRuntime(),
      ),
      "typecheck",
    );
  }

  async runLint(): Promise<RuntimeCommandResult | null> {
    if (!this.#project.manifest.scripts.lint) return null;
    return this.#recordCommand(
      await this.#runtime.runLint(this.runtimeContext, await this.ensureRuntime()),
      "lint",
    );
  }

  async runTests(): Promise<RuntimeCommandResult | null> {
    if (!this.#project.manifest.scripts.test) return null;
    return this.#recordCommand(
      await this.#runtime.runTests(this.runtimeContext, await this.ensureRuntime()),
      "test",
    );
  }

  async runBuild(): Promise<RuntimeCommandResult> {
    if (!this.#project.manifest.scripts.build) {
      throw new Error("Project V2 must declare a production build script.");
    }
    return this.#recordCommand(
      await this.#runtime.runBuild(this.runtimeContext, await this.ensureRuntime()),
      "build",
    );
  }

  async browserCheck(): Promise<BuilderBrowserCheckResult> {
    if (!this.#browser) {
      throw new ProjectRuntimeUnavailableError(
        "A real browser checker is not configured.",
      );
    }
    if (!this.#preview?.previewUrl) {
      throw new Error("Start a responsive live preview before browser_check.");
    }
    const raw = await this.#browser.check({
      url: this.#preview.previewUrl,
      project: this.#project,
      signal: AbortSignal.timeout(60_000),
    });
    const result = {
      ...raw,
      pageErrors: raw.pageErrors.slice(0, 20).map((error) =>
        boundedRuntimeOutput(error, "browser page error", 500).value),
      consoleErrors: raw.consoleErrors.slice(0, 20).map((error) =>
        boundedRuntimeOutput(error, "browser console error", 500).value),
      networkErrors: raw.networkErrors.slice(0, 20).map((error) =>
        boundedRuntimeOutput(error, "browser network error", 500).value),
      summary: boundedRuntimeOutput(raw.summary, "browser summary", 1_000).value,
    };
    await this.#recordBrowserMetadata(result, {
      truncated:
        raw.pageErrors.length > 20 ||
        raw.consoleErrors.length > 20 ||
        raw.networkErrors.length > 20 ||
        raw.summary !== result.summary,
    });
    return result;
  }

  async createCheckpoint(
    label: string,
  ): Promise<{ project: ProjectV2; checkpoint: RuntimeCheckpointSnapshot }> {
    const handle = await this.ensureRuntime();
    const checkpoint = await createProjectCheckpointV2(this.#project, {
      id: randomUUID(),
      label,
      source: "ai",
    });
    const expectedRevision = this.#project.revision;
    const next: ProjectV2 = {
      ...this.#project,
      updatedAt: new Date().toISOString(),
      checkpoints: [...this.#project.checkpoints, checkpoint].slice(-50),
    };
    this.#project = await this.#repository.saveAuthorized(
      this.actorId,
      next,
      expectedRevision,
    );
    const runtimeCheckpoint = await this.#runtime.captureCheckpoint(
      handle,
      checkpoint.id,
      checkpoint.snapshot.revision,
      Object.keys(checkpoint.snapshot.files),
    );
    return { project: this.project, checkpoint: runtimeCheckpoint };
  }

  async restoreCheckpoint(checkpointId: string): Promise<ProjectV2> {
    const checkpoint = this.#project.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error("Checkpoint was not found.");
    const expectedRevision = this.#project.revision;
    const next = await restoreProjectCheckpointV2(
      this.#project,
      checkpoint,
      expectedRevision,
    );
    this.#project = await this.#repository.saveAuthorized(
      this.actorId,
      next,
      expectedRevision,
    );
    const current = this.#handle ?? (await this.#runtime.ensure(this.runtimeContext));
    this.#handle = await this.#runtime.restoreCheckpoint(
      this.runtimeContext,
      {
        checkpointId: checkpoint.id,
        revision: checkpoint.snapshot.revision,
        files: Object.values(checkpoint.snapshot.files).map((file) => ({
          path: file.path,
          content: file.content,
          hash: file.hash,
          generated: file.provenance !== "manual",
        })),
      },
      current,
    );
    this.#runtimeSyncedRevision = this.#project.revision;
    this.#preview = null;
    return this.project;
  }

  async requestConnection(
    kind: Parameters<NonNullable<BuilderAgentSessionDependencies["connections"]>["request"]>[0]["kind"],
    reason: string,
  ) {
    if (!this.#connections) {
      return {
        status: "setup-required" as const,
        message: `${kind} connection setup is not configured.`,
      };
    }
    return this.#connections.request({
      actorId: this.actorId,
      projectId: this.#project.id,
      kind,
      reason,
    });
  }

  async publishProject(target: "legacy" | "vercel-preview") {
    if (!this.#publisher) {
      throw new ProjectRuntimeUnavailableError(
        "Project publishing is not configured.",
      );
    }
    return this.#publisher.publish({
      actorId: this.actorId,
      project: this.#project,
      target,
    });
  }

  async ensureRuntime(): Promise<RuntimeHandle> {
    if (this.#handle && this.#runtimeSyncedRevision === this.#project.revision) {
      return this.#handle;
    }
    const context = this.runtimeContext;
    const handle = this.#handle ?? (await this.#runtime.ensure(context));
    this.#handle = await this.#runtime.writeProject(context, handle);
    this.#runtimeSyncedRevision = this.#project.revision;
    return this.#handle;
  }

  async runReleaseGate(
    options: { install?: boolean } = {},
  ): Promise<BuilderReleaseGateResult> {
    const checks: BuilderReleaseCheck[] = [];
    const blockingErrors: string[] = [];
    let handle: RuntimeHandle;
    try {
      handle = await this.ensureRuntime();
    } catch (error) {
      const check = failedCheck("install", error, "Sandbox is unavailable.");
      return {
        ok: false,
        checks: [check],
        blockingErrors: [check.summary],
        previewUrl: null,
      };
    }

    if (options.install !== false) {
      try {
        const command = await this.#recordCommand(
          await this.#runtime.installDependencies(
            this.runtimeContext,
            handle,
          ),
          "build",
        );
        const check = commandCheck("install", command);
        checks.push(check);
        if (check.status === "failed") blockingErrors.push(check.summary);
      } catch (error) {
        const check = failedCheck("install", error, "Dependency installation failed.");
        checks.push(check);
        blockingErrors.push(check.summary);
      }
    } else {
      checks.push({ name: "install", status: "skipped", summary: "Dependencies were already installed for this revision." });
    }
    if (blockingErrors.length) {
      return { ok: false, checks, blockingErrors, previewUrl: null };
    }

    for (const [name, execute] of [
      ["typecheck", () => this.runTypecheck()],
      ["lint", () => this.runLint()],
      ["tests", () => this.runTests()],
    ] as const) {
      try {
        const command = await execute();
        if (!command) {
          checks.push({ name, status: "skipped", summary: `${name} script is not declared.` });
          continue;
        }
        const check = commandCheck(name, command);
        checks.push(check);
        if (check.status === "failed") blockingErrors.push(check.summary);
      } catch (error) {
        const check = failedCheck(name, error, `${name} failed.`);
        checks.push(check);
        blockingErrors.push(check.summary);
      }
    }

    try {
      const command = await this.runBuild();
      const check = commandCheck("build", command);
      checks.push(check);
      if (check.status === "failed") blockingErrors.push(check.summary);
    } catch (error) {
      const check = failedCheck("build", error, "Production build failed.");
      checks.push(check);
      blockingErrors.push(check.summary);
    }
    if (blockingErrors.length) {
      return { ok: false, checks, blockingErrors, previewUrl: null };
    }

    try {
      const preview = await this.startPreview();
      checks.push({ name: "preview", status: "passed", summary: "Live preview answered successfully.", preview });
    } catch (error) {
      const check = failedCheck("preview", error, "Live preview failed.");
      checks.push(check);
      blockingErrors.push(check.summary);
      return { ok: false, checks, blockingErrors, previewUrl: null };
    }

    try {
      const browser = await this.browserCheck();
      const passed =
        browser.ok &&
        browser.rendered &&
        browser.primaryInteractionChecked &&
        browser.pageErrors.length === 0;
      const check: BuilderReleaseCheck = {
        name: "browser",
        status: passed ? "passed" : "failed",
        summary: browser.summary,
        browser,
      };
      checks.push(check);
      if (!passed) blockingErrors.push(check.summary);
    } catch (error) {
      const check = failedCheck("browser", error, "Browser smoke test failed.");
      checks.push(check);
      blockingErrors.push(check.summary);
    }
    return {
      ok: blockingErrors.length === 0,
      checks,
      blockingErrors,
      previewUrl: this.#preview?.previewUrl ?? null,
    };
  }

  async #applyOperations(operations: ProjectFileOperationV2[]): Promise<ProjectV2> {
    const next = await applyProjectV2FileOperations(
      this.#project,
      this.#project.revision,
      operations,
    );
    return this.#saveAndSync(next);
  }

  async #saveAndSync(next: ProjectV2): Promise<ProjectV2> {
    const expectedRevision = this.#project.revision;
    this.#project = await this.#repository.saveAuthorized(
      this.actorId,
      next,
      expectedRevision,
    );
    this.#runtimeSyncedRevision = 0;
    this.#preview = null;
    if (this.#handle) {
      this.#handle = await this.#runtime.writeProject(
        this.runtimeContext,
        this.#handle,
      );
      this.#runtimeSyncedRevision = this.#project.revision;
    }
    return this.project;
  }

  async #recordCommand(
    command: RuntimeCommandResult,
    taskId: string,
  ): Promise<RuntimeCommandResult> {
    if (this.#runtime.provider !== "vercel-sandbox") return command;
    const next = appendCommandMetadata(this.#project, command, taskId);
    if (next === this.#project) return command;
    const expectedRevision = this.#project.revision;
    this.#project = await this.#repository.saveAuthorized(
      this.actorId,
      next,
      expectedRevision,
    );
    return command;
  }

  async #recordBrowserMetadata(
    result: BuilderBrowserCheckResult,
    options: { truncated: boolean },
  ): Promise<void> {
    if (this.#runtime.provider !== "vercel-sandbox" || !this.#preview) return;
    const runId = this.#preview.runId;
    const existing = this.#project.runs.find((run) => run.id === runId);
    if (!existing) return;
    const log: ProjectLogMetadataV2 = {
      id: randomUUID(),
      runId,
      stream: "browser",
      bytes: new TextEncoder().encode(JSON.stringify(result)).byteLength,
      truncated: options.truncated,
      createdAt: new Date().toISOString(),
    };
    const expectedRevision = this.#project.revision;
    const runs = this.#project.runs.map((run) =>
      run.id === runId
        ? { ...run, logIds: [...run.logIds, log.id].slice(-256) }
        : run,
    );
    const next: ProjectV2 = {
      ...this.#project,
      runs,
      logs: [...this.#project.logs, log].slice(-2_048),
      updatedAt: new Date().toISOString(),
    };
    this.#project = await this.#repository.saveAuthorized(
      this.actorId,
      next,
      expectedRevision,
    );
  }
}
