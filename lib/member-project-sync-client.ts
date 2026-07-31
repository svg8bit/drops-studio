import { evaluateProjectQuality } from "./project-quality.ts";
import type {
  GeneratedProject,
  ProjectChatMessage,
  ProjectCheckpoint,
} from "./project-types.ts";
import type { ProjectWorkspace } from "./project-workspace.ts";
import { validateProjectSpec } from "./project-validator.ts";
import type {
  MemberProjectDraft,
  MemberProjectRecord,
} from "./member-project-cloud.ts";

export interface MemberProjectListResponse {
  projects: MemberProjectRecord[];
  limit: number;
  materialization: "compile-spec-client-side";
}

export class MemberProjectSyncError extends Error {
  readonly status: number;
  readonly code: string;
  readonly current?: MemberProjectRecord;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    current?: MemberProjectRecord;
  }) {
    super(input.message);
    this.name = "MemberProjectSyncError";
    this.status = input.status;
    this.code = input.code ?? "PROJECT_SYNC_FAILED";
    this.current = input.current;
  }
}

function safeCheckpoints(
  checkpoints: ProjectCheckpoint[] | undefined,
): ProjectCheckpoint[] {
  return (checkpoints ?? []).slice(-12).map(stripBrowserSource);
}

function safeFutureCheckpoints(
  checkpoints: ProjectCheckpoint[] | undefined,
): ProjectCheckpoint[] {
  return (checkpoints ?? []).slice(0, 12).map(stripBrowserSource);
}

function stripBrowserSource(checkpoint: ProjectCheckpoint): ProjectCheckpoint {
  const cloudCheckpoint = { ...checkpoint };
  delete cloudCheckpoint.runtimeHtml;
  delete cloudCheckpoint.workspace;
  return cloudCheckpoint;
}

function safeConversation(
  conversation: ProjectChatMessage[] | undefined,
): ProjectChatMessage[] {
  return (conversation ?? []).slice(-100);
}

function safeWorkspace(workspace: ProjectWorkspace): ProjectWorkspace {
  return {
    schemaVersion: workspace.schemaVersion,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
    files: workspace.files.map((item) => ({
      path: item.path,
      content: item.content,
      language: item.language,
      role: item.role,
      editable: item.editable,
    })),
    tasks: workspace.tasks.map((task) => ({
      id: task.id,
      label: task.label,
      command: task.command,
      args: [...task.args],
      ...(task.cwd === undefined ? {} : { cwd: task.cwd }),
      ...(task.port === undefined ? {} : { port: task.port }),
    })),
    runtime: {
      executionMode: workspace.runtime.executionMode,
      provider: workspace.runtime.provider,
      isolation: workspace.runtime.isolation,
      runtime: workspace.runtime.runtime,
      packageManager: workspace.runtime.packageManager,
      installScripts: workspace.runtime.installScripts,
    },
  };
}

export function memberProjectDraft(
  project: GeneratedProject,
): MemberProjectDraft {
  return {
    id: project.id,
    spec: validateProjectSpec(project.spec),
    checkpoints: safeCheckpoints(project.checkpoints),
    futureCheckpoints: safeFutureCheckpoints(project.futureCheckpoints),
    conversation: safeConversation(project.conversation),
    ...(project.workspace ? { workspace: safeWorkspace(project.workspace) } : {}),
    ...(project.publishedUrl ? { publishedUrl: project.publishedUrl } : {}),
    ...(project.publishedSlug ? { publishedSlug: project.publishedSlug } : {}),
    ...(project.publishedAt ? { publishedAt: project.publishedAt } : {}),
  };
}

export async function materializeMemberProject(
  record: MemberProjectRecord,
): Promise<GeneratedProject> {
  const { compileProject } = await import("./project-compiler.ts");
  const { compileWorkspaceRuntime } = await import("./project-workspace.ts");
  const spec = validateProjectSpec(record.spec);
  const workspace = record.workspace ? safeWorkspace(record.workspace) : undefined;
  const html = workspace
    ? compileWorkspaceRuntime(spec, workspace)
    : compileProject(spec);
  return {
    id: record.id,
    spec,
    html,
    quality: evaluateProjectQuality(spec, html),
    checkpoints: safeCheckpoints(record.checkpoints),
    futureCheckpoints: safeFutureCheckpoints(record.futureCheckpoints),
    conversation: safeConversation(record.conversation),
    ...(workspace ? { workspace } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.publishedUrl ? { publishedUrl: record.publishedUrl } : {}),
    ...(record.publishedSlug ? { publishedSlug: record.publishedSlug } : {}),
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
  };
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return response
    .json()
    .then((value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    )
    .catch(() => ({}));
}

function syncError(
  response: Response,
  value: Record<string, unknown>,
): MemberProjectSyncError {
  return new MemberProjectSyncError({
    message:
      typeof value.error === "string"
        ? value.error
        : "Cloud project sync is temporarily unavailable.",
    status: response.status,
    code:
      typeof value.code === "string" ? value.code : "PROJECT_SYNC_FAILED",
    current:
      value.current && typeof value.current === "object"
        ? (value.current as MemberProjectRecord)
        : undefined,
  });
}

export async function listMemberProjectsFromCloud(): Promise<MemberProjectListResponse> {
  const response = await fetch("/api/projects", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const value = await payload(response);
  if (!response.ok) throw syncError(response, value);
  const projects = Array.isArray(value.projects)
    ? (value.projects as MemberProjectRecord[])
    : [];
  return {
    projects,
    limit: Number.isSafeInteger(value.limit) ? Number(value.limit) : 50,
    materialization: "compile-spec-client-side",
  };
}

export async function saveMemberProjectToCloud(
  project: GeneratedProject,
  expectedRevision: number,
): Promise<MemberProjectRecord> {
  const response = await fetch("/api/projects", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      project: memberProjectDraft(project),
      expectedRevision,
    }),
  });
  const value = await payload(response);
  if (!response.ok) throw syncError(response, value);
  if (!value.project || typeof value.project !== "object") {
    throw new MemberProjectSyncError({
      message: "Cloud project sync returned an invalid project revision.",
      status: 502,
    });
  }
  return value.project as MemberProjectRecord;
}

export async function deleteMemberProjectFromCloud(
  projectId: string,
): Promise<void> {
  const listing = await listMemberProjectsFromCloud();
  const current = listing.projects.find((project) => project.id === projectId);
  if (!current) return;
  const response = await fetch("/api/projects", {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: projectId,
      expectedRevision: current.revision,
    }),
  });
  if (response.status === 404) return;
  const value = await payload(response);
  if (!response.ok) throw syncError(response, value);
}
