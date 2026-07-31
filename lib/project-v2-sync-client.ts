import type { ProjectV2 } from "./project-v2-types.ts";

export class ProjectV2SyncError extends Error {
  readonly status: number;
  readonly code: string;
  readonly storageRevision?: number;
  readonly current?: ProjectV2;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    storageRevision?: number;
    current?: ProjectV2;
  }) {
    super(input.message);
    this.name = "ProjectV2SyncError";
    this.status = input.status;
    this.code = input.code ?? "PROJECT_V2_SYNC_FAILED";
    this.storageRevision = input.storageRevision;
    this.current = input.current;
  }
}

async function responseValue(response: Response): Promise<Record<string, unknown>> {
  return response.json().then((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {},
  ).catch(() => ({}));
}

function syncError(response: Response, value: Record<string, unknown>): ProjectV2SyncError {
  return new ProjectV2SyncError({
    message: typeof value.error === "string" ? value.error : "Project V2 cloud sync failed.",
    status: response.status,
    code: typeof value.code === "string" ? value.code : undefined,
    storageRevision: Number.isSafeInteger(value.storageRevision)
      ? Number(value.storageRevision)
      : undefined,
    current: value.project && typeof value.project === "object"
      ? value.project as ProjectV2
      : undefined,
  });
}

export async function loadProjectV2FromCloud(projectId: string): Promise<{
  storageRevision: number;
  project: ProjectV2;
} | null> {
  const response = await fetch(`/api/projects/v2?id=${encodeURIComponent(projectId)}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  const value = await responseValue(response);
  if (!response.ok) throw syncError(response, value);
  if (value.found === false) return null;
  if (!value.project || typeof value.project !== "object" || !Number.isSafeInteger(value.storageRevision)) {
    throw new ProjectV2SyncError({ message: "Project V2 cloud sync returned an invalid snapshot.", status: 502 });
  }
  return {
    storageRevision: Number(value.storageRevision),
    project: value.project as ProjectV2,
  };
}

export async function saveProjectV2ToCloud(
  project: ProjectV2,
  expectedStorageRevision: number,
): Promise<{ storageRevision: number; project: ProjectV2 }> {
  const response = await fetch("/api/projects/v2", {
    method: "PUT",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ project, expectedStorageRevision }),
  });
  const value = await responseValue(response);
  if (!response.ok) throw syncError(response, value);
  if (!value.project || typeof value.project !== "object" || !Number.isSafeInteger(value.storageRevision)) {
    throw new ProjectV2SyncError({ message: "Project V2 cloud sync returned an invalid revision.", status: 502 });
  }
  return {
    storageRevision: Number(value.storageRevision),
    project: value.project as ProjectV2,
  };
}

export async function deleteProjectV2FromCloud(projectId: string): Promise<void> {
  const response = await fetch(`/api/projects/v2?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return;
  const value = await responseValue(response);
  if (!response.ok) throw syncError(response, value);
}
