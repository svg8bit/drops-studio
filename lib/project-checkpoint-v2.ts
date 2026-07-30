import {
  hashProjectV2CanonicalState,
  hashProjectV2Snapshot,
  projectV2CanonicalState,
} from "./project-v2-hash.ts";
import { assertProjectPayloadSafe } from "./artifact-security.ts";
import { ProjectV2RevisionConflictError } from "./project-v2-files.ts";
import type {
  ProjectCanonicalSnapshotV2,
  ProjectCheckpointV2,
  ProjectV2,
} from "./project-v2-types.ts";
import { validateProjectV2 } from "./project-v2-validator.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export async function createProjectCheckpointV2(
  project: ProjectV2,
  input: Pick<ProjectCheckpointV2, "id" | "label" | "source"> & {
    createdAt?: string;
  },
): Promise<ProjectCheckpointV2> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.id)) {
    throw new Error("Project checkpoint id is invalid.");
  }
  const label = input.label.trim().slice(0, 120);
  if (!label) throw new Error("Project checkpoint label is required.");
  if ((await hashProjectV2CanonicalState(project)) !== project.contentHash) {
    throw new Error("A checkpoint cannot capture a project with an invalid content hash.");
  }
  await validateProjectV2(project);
  const snapshot: ProjectCanonicalSnapshotV2 = clone({
    ...projectV2CanonicalState(project),
    contentHash: project.contentHash,
  });
  assertProjectPayloadSafe(snapshot, "Project V2 checkpoint");
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(new Date(createdAt).getTime())) {
    throw new Error("Project checkpoint timestamp is invalid.");
  }
  return {
    id: input.id,
    label,
    source: input.source,
    createdAt: new Date(createdAt).toISOString(),
    snapshotHash: await hashProjectV2Snapshot(snapshot),
    snapshot,
  };
}

export async function restoreProjectCheckpointV2(
  project: ProjectV2,
  checkpoint: ProjectCheckpointV2,
  expectedRevision: number,
  options: { now?: () => Date } = {},
): Promise<ProjectV2> {
  if (expectedRevision !== project.revision) {
    throw new ProjectV2RevisionConflictError(project.revision, expectedRevision);
  }
  if (await hashProjectV2Snapshot(checkpoint.snapshot) !== checkpoint.snapshotHash) {
    throw new Error("Project checkpoint snapshot hash is invalid.");
  }
  assertProjectPayloadSafe(checkpoint.snapshot, "Project V2 checkpoint");
  if (
    await hashProjectV2CanonicalState(checkpoint.snapshot) !==
      checkpoint.snapshot.contentHash
  ) {
    throw new Error("Project checkpoint content hash is invalid.");
  }
  const snapshot = clone(checkpoint.snapshot);
  const now = (options.now?.() ?? new Date()).toISOString();
  const restored: ProjectV2 = {
    ...project,
    ...snapshot,
    revision: project.revision + 1,
    contentHash: "",
    runs: project.runs,
    logs: project.logs,
    checkpoints: [
      ...project.checkpoints.filter((item) => item.id !== checkpoint.id),
      clone(checkpoint),
    ].slice(-50),
    preview: project.preview
      ? { status: "stopped", projectRevision: project.revision + 1, stoppedAt: now }
      : undefined,
    deployment: project.deployment,
    createdAt: project.createdAt,
    updatedAt: now,
  };
  restored.contentHash = await hashProjectV2CanonicalState(restored);
  return validateProjectV2(restored);
}
