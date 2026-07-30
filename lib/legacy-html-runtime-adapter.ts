import type { ProjectV2 } from "./project-v2-types.ts";
import {
  NoopRuntimeAuditSink,
  ProjectRuntimeUnavailableError,
  ProjectRuntimeValidationError,
  assertRuntimePath,
  projectRuntimeFiles,
  projectRuntimeId,
  projectRuntimeRevision,
  runtimeActorHash,
  runtimeAuditEvent,
  runtimeRevisionDigest,
  validateRuntimeCheckpointFiles,
  type ProjectRuntimeAdapter,
  type RuntimeActorContext,
  type RuntimeAuditSink,
  type RuntimeCheckpointSnapshot,
  type RuntimeCleanupResult,
  type RuntimeCommandResult,
  type RuntimeHandle,
  type RuntimeLogChunk,
  type RuntimePreviewResult,
  type RuntimeProjectFile,
  type RuntimeState,
} from "./project-runtime-adapter.ts";

export interface LegacyHtmlPreviewPublisher {
  publish(input: {
    projectId: string;
    requestId: string;
    html: string;
  }): Promise<{ id: string; url: string }>;
}

interface LegacyRuntimeRecord {
  files: RuntimeProjectFile[];
  handle: RuntimeHandle;
  previewUrl: string | null;
  updatedAt: string;
}

function unavailableResult(kind: RuntimeCommandResult["kind"]): never {
  throw new ProjectRuntimeUnavailableError(
    `The legacy HTML adapter cannot execute the ${kind} lifecycle. Migrate this project to Project V2 Sandbox runtime.`,
  );
}

export class LegacyHtmlRuntimeAdapter implements ProjectRuntimeAdapter {
  readonly provider = "legacy-html" as const;
  readonly #records = new Map<string, LegacyRuntimeRecord>();
  readonly #publisher: LegacyHtmlPreviewPublisher | null;
  readonly #audit: RuntimeAuditSink;

  constructor(options: {
    publisher?: LegacyHtmlPreviewPublisher | null;
    audit?: RuntimeAuditSink;
  } = {}) {
    this.#publisher = options.publisher ?? null;
    this.#audit = options.audit ?? new NoopRuntimeAuditSink();
  }

  async ensure(context: RuntimeActorContext): Promise<RuntimeHandle> {
    const projectId = projectRuntimeId(context.project);
    const files = projectRuntimeFiles(context.project);
    const revision = projectRuntimeRevision(context.project);
    const digest = runtimeRevisionDigest(projectId, revision, files);
    const recordId = `legacy/${runtimeActorHash(context.actorId)}/${projectId}`;
    const previous = this.#records.get(recordId);
    if (previous?.handle.revisionDigest === digest) return previous.handle;
    const now = new Date().toISOString();
    const handle: RuntimeHandle = {
      provider: this.provider,
      projectId,
      sandboxName: null,
      sessionId: null,
      workspaceRoot: recordId,
      revisionDigest: digest,
      createdAt: previous?.handle.createdAt ?? now,
      expiresAt: null,
    };
    this.#records.set(recordId, {
      files,
      handle,
      previewUrl: previous?.previewUrl ?? null,
      updatedAt: now,
    });
    await this.#audit.record(
      runtimeAuditEvent(context, this.provider, {
        action: "legacy.ensure",
        status: "succeeded",
        detail: "Legacy HTML compatibility runtime selected.",
      }),
    );
    return handle;
  }

  async resume(context: RuntimeActorContext): Promise<RuntimeHandle | null> {
    const recordId = `legacy/${runtimeActorHash(context.actorId)}/${projectRuntimeId(context.project)}`;
    return this.#records.get(recordId)?.handle ?? null;
  }

  async status(handle: RuntimeHandle): Promise<RuntimeState> {
    const record = this.#record(handle);
    return {
      provider: this.provider,
      status: "running",
      sandboxName: null,
      sessionId: null,
      vcpus: null,
      memoryMb: null,
      createdAt: record.handle.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: null,
      activeDurationMs: Date.now() - Date.parse(record.handle.createdAt),
      previewUrl: record.previewUrl,
      previewCommandId: record.previewUrl ? "legacy-publish" : null,
    };
  }

  async writeProject(context: RuntimeActorContext): Promise<RuntimeHandle> {
    return this.ensure(context);
  }

  async readFile(handle: RuntimeHandle, path: string): Promise<string> {
    const safePath = assertRuntimePath(path);
    const file = this.#record(handle).files.find((entry) => entry.path === safePath);
    if (!file) throw new ProjectRuntimeValidationError(`${safePath} was not found.`);
    return file.content;
  }

  async installDependencies(): Promise<RuntimeCommandResult> {
    return unavailableResult("install");
  }

  async runCommand(
    ...args: Parameters<ProjectRuntimeAdapter["runCommand"]>
  ): Promise<RuntimeCommandResult> {
    return unavailableResult(args[2].kind);
  }

  async startPreview(
    context: RuntimeActorContext,
    handle: RuntimeHandle,
  ): Promise<RuntimePreviewResult> {
    if (!this.#publisher) {
      throw new ProjectRuntimeUnavailableError(
        "Legacy preview publishing is not configured.",
      );
    }
    const record = this.#record(handle);
    const html =
      record.files.find((file) => file.path === "index.html")?.content ??
      record.files.find((file) => file.path.endsWith(".html"))?.content;
    if (!html) {
      throw new ProjectRuntimeValidationError(
        "Legacy HTML preview requires an index.html file.",
      );
    }
    const startedAt = new Date().toISOString();
    const published = await this.#publisher.publish({
      projectId: handle.projectId,
      requestId: context.requestId,
      html,
    });
    const url = new URL(published.url);
    if (url.protocol !== "https:") {
      throw new ProjectRuntimeValidationError(
        "Legacy preview publisher returned an insecure URL.",
      );
    }
    record.previewUrl = url.toString();
    record.updatedAt = new Date().toISOString();
    await this.#audit.record(
      runtimeAuditEvent(context, this.provider, {
        action: "legacy.preview",
        status: "succeeded",
        commandId: published.id,
      }),
    );
    return {
      commandId: published.id,
      runId: published.id,
      kind: "preview",
      argv: [],
      cwd: handle.workspaceRoot,
      exitCode: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      startedAt,
      finishedAt: null,
      previewUrl: record.previewUrl,
      port: 3000,
    };
  }

  async readLogs(): Promise<RuntimeLogChunk[]> {
    return [];
  }

  async stopProcess(): Promise<void> {}

  async runTypecheck(): Promise<RuntimeCommandResult> {
    return unavailableResult("typecheck");
  }

  async runLint(): Promise<RuntimeCommandResult> {
    return unavailableResult("lint");
  }

  async runTests(): Promise<RuntimeCommandResult> {
    return unavailableResult("test");
  }

  async runBuild(): Promise<RuntimeCommandResult> {
    return unavailableResult("build");
  }

  async captureCheckpoint(
    handle: RuntimeHandle,
    checkpointId: string,
    revision: number,
    paths: string[],
  ): Promise<RuntimeCheckpointSnapshot> {
    const wanted = new Set(paths.map((path) => assertRuntimePath(path)));
    const files = this.#record(handle).files
      .filter((file) => wanted.has(file.path))
      .map((file) => ({ ...file }));
    if (files.length !== wanted.size) {
      throw new ProjectRuntimeValidationError(
        "Every requested checkpoint file must exist.",
      );
    }
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
    const record = this.#record(current);
    record.files = validateRuntimeCheckpointFiles(checkpoint.files);
    record.handle = {
      ...record.handle,
      revisionDigest: runtimeRevisionDigest(
        current.projectId,
        checkpoint.revision,
        record.files,
      ),
    };
    record.updatedAt = new Date().toISOString();
    return record.handle;
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    const record = this.#record(handle);
    record.previewUrl = null;
    record.updatedAt = new Date().toISOString();
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    this.#records.delete(handle.workspaceRoot);
  }

  async cleanupIdle(): Promise<RuntimeCleanupResult> {
    return { inspected: 0, stopped: [], failed: [] };
  }

  #record(handle: RuntimeHandle): LegacyRuntimeRecord {
    if (handle.provider !== this.provider) {
      throw new ProjectRuntimeValidationError("Runtime handle provider mismatch.");
    }
    const record = this.#records.get(handle.workspaceRoot);
    if (!record) {
      throw new ProjectRuntimeUnavailableError("Legacy runtime state is unavailable.");
    }
    return record;
  }
}

export function projectUsesLegacyHtmlRuntime(project: ProjectV2): boolean {
  return project.manifest.framework.name === "legacy-html";
}
