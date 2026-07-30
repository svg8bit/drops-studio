import { compileProject } from "./project-compiler.ts";
import { evaluateProjectQuality } from "./project-quality.ts";
import type {
  GeneratedProject,
  ProjectCheckpoint,
} from "./project-types.ts";
import { validateEditableRuntimeHtml } from "./source-workspace.ts";
import {
  compileWorkspaceRuntime,
  materializeProjectWorkspace,
  validateProjectWorkspace,
} from "./project-workspace.ts";
import { validateProjectSpec } from "./project-validator.ts";

export const PROJECT_HISTORY_LIMIT = 12;

export interface ProjectHistoryTransition {
  project: GeneratedProject;
  branched: boolean;
  replacedFutureCount: number;
}

function compiledProjectAtCheckpoint(
  project: GeneratedProject,
  checkpoint: ProjectCheckpoint,
  changedAt: string,
  checkpoints: ProjectCheckpoint[],
  futureCheckpoints: ProjectCheckpoint[],
): GeneratedProject {
  const spec = validateProjectSpec(checkpoint.spec);
  const workspaceValidation = checkpoint.workspace
    ? validateProjectWorkspace(spec, checkpoint.workspace)
    : null;
  if (workspaceValidation && !workspaceValidation.valid) {
    throw new Error(
      workspaceValidation.issues[0] ?? "The workspace checkpoint is invalid.",
    );
  }
  const sourceValidation = checkpoint.runtimeHtml
    ? validateEditableRuntimeHtml(spec, checkpoint.runtimeHtml)
    : null;
  if (sourceValidation && !sourceValidation.valid) {
    throw new Error(sourceValidation.issues[0] ?? "The source checkpoint is invalid.");
  }
  const html = checkpoint.workspace
    ? compileWorkspaceRuntime(spec, checkpoint.workspace)
    : checkpoint.runtimeHtml ?? compileProject(spec);
  const workspace = checkpoint.workspace ?? materializeProjectWorkspace({
    ...project,
    spec,
    html,
    updatedAt: changedAt,
    workspace: undefined,
  });
  return {
    ...project,
    spec,
    html,
    workspace,
    quality: evaluateProjectQuality(spec, html),
    updatedAt: changedAt,
    checkpoints,
    futureCheckpoints,
    sourceEditedAt:
      checkpoint.workspace || checkpoint.runtimeHtml
        ? checkpoint.createdAt
        : undefined,
  };
}

export function commitProjectCheckpoint(
  project: GeneratedProject,
  checkpointInput: ProjectCheckpoint,
): ProjectHistoryTransition {
  const sourceOwningCheckpoint =
    checkpointInput.workspace || checkpointInput.runtimeHtml || !project.sourceEditedAt
      ? checkpointInput
      : project.workspace
        ? { ...checkpointInput, workspace: project.workspace }
        : { ...checkpointInput, runtimeHtml: project.html };
  const futureCheckpoints = (project.futureCheckpoints ?? []).slice(
    0,
    PROJECT_HISTORY_LIMIT,
  );
  const replacedFutureCount = futureCheckpoints.length;
  const activeCheckpoint = project.checkpoints?.at(-1);
  const checkpoint: ProjectCheckpoint = replacedFutureCount
    ? {
        ...sourceOwningCheckpoint,
        branch: {
          fromCheckpointId: activeCheckpoint?.id ?? sourceOwningCheckpoint.id,
          replacedCheckpointCount: replacedFutureCount,
        },
      }
    : sourceOwningCheckpoint;
  const checkpoints = [
    ...(project.checkpoints ?? []),
    checkpoint,
  ].slice(-PROJECT_HISTORY_LIMIT);

  return {
    project: compiledProjectAtCheckpoint(
      project,
      checkpoint,
      checkpoint.createdAt,
      checkpoints,
      [],
    ),
    branched: replacedFutureCount > 0,
    replacedFutureCount,
  };
}

export function undoProjectCheckpoint(
  project: GeneratedProject,
  changedAt: string,
): ProjectHistoryTransition | null {
  const checkpoints = [...(project.checkpoints ?? [])];
  if (checkpoints.length < 2) return null;

  const current = checkpoints.pop();
  const previous = checkpoints.at(-1);
  if (!current || !previous) return null;
  const futureCheckpoints = [
    current,
    ...(project.futureCheckpoints ?? []),
  ].slice(0, PROJECT_HISTORY_LIMIT);

  return {
    project: compiledProjectAtCheckpoint(
      project,
      previous,
      changedAt,
      checkpoints,
      futureCheckpoints,
    ),
    branched: false,
    replacedFutureCount: 0,
  };
}

export function redoProjectCheckpoint(
  project: GeneratedProject,
  changedAt: string,
): ProjectHistoryTransition | null {
  const [next, ...remainingFuture] = project.futureCheckpoints ?? [];
  if (!next) return null;
  const checkpoints = [...(project.checkpoints ?? []), next].slice(
    -PROJECT_HISTORY_LIMIT,
  );

  return {
    project: compiledProjectAtCheckpoint(
      project,
      next,
      changedAt,
      checkpoints,
      remainingFuture.slice(0, PROJECT_HISTORY_LIMIT),
    ),
    branched: false,
    replacedFutureCount: 0,
  };
}
