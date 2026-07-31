import { enterpriseError } from "./errors.ts";
import type { EnterpriseRuntime } from "./types.ts";
import { assertSafeId, clone, fileHash, iso, matchesScope, normalizeProjectPath } from "./utils.ts";

export interface CanonicalProjectState {
  projectId: string;
  revision: number;
  files: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

export interface AiTaskBranch {
  id: string;
  projectId: string;
  taskOwnerId: string;
  taskScope: string[];
  baseRevision: number;
  baseFiles: Record<string, string>;
  files: Record<string, string>;
  status: "open" | "conflict" | "merged" | "discarded";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCheckpoint {
  id: string;
  projectId: string;
  sourceRevision: number;
  files: Record<string, string>;
  createdAt: string;
  createdBy: string;
  reason: "pre-ai-merge" | "manual";
}

export interface BranchMergeConflict {
  path: string;
  baseHash: string | null;
  canonicalHash: string | null;
  branchHash: string | null;
}

export type BranchMergeResult =
  | { status: "approval-required" }
  | { status: "conflict"; conflicts: BranchMergeConflict[] }
  | { status: "merged"; checkpointId: string; revision: number };

export class AiBranchManager {
  readonly #runtime: EnterpriseRuntime;
  readonly #projects = new Map<string, CanonicalProjectState>();
  readonly #branches = new Map<string, AiTaskBranch>();
  readonly #checkpoints = new Map<string, ProjectCheckpoint>();

  constructor(runtime: EnterpriseRuntime) {
    this.#runtime = runtime;
  }

  createProject(input: { projectId: string; files: Record<string, string> }): CanonicalProjectState {
    const projectId = assertSafeId(input.projectId, "Project id");
    if (this.#projects.has(projectId)) enterpriseError("INVALID_INPUT", "Project already exists.");
    const project: CanonicalProjectState = {
      projectId,
      revision: 1,
      files: this.#files(input.files),
      updatedAt: iso(this.#runtime.now()),
      updatedBy: "system",
    };
    this.#projects.set(projectId, project);
    return clone(project);
  }

  createBranch(input: { projectId: string; taskOwnerId: string; taskScope: string[] }): AiTaskBranch {
    const project = this.#project(input.projectId);
    const taskScope = [...new Set(input.taskScope.map((scope) => {
      if (!scope.endsWith("/**")) return normalizeProjectPath(scope);
      const prefix = normalizeProjectPath(`${scope.slice(0, -3)}/placeholder`).replace(/\/placeholder$/, "");
      return `${prefix}/**`;
    }))].sort();
    if (!taskScope.length || taskScope.length > 32) enterpriseError("INVALID_INPUT", "AI task scope is invalid.");
    const now = iso(this.#runtime.now());
    const branch: AiTaskBranch = {
      id: assertSafeId(this.#runtime.id("ai-branch"), "AI branch id"),
      projectId: project.projectId,
      taskOwnerId: assertSafeId(input.taskOwnerId, "Task owner id"),
      taskScope,
      baseRevision: project.revision,
      baseFiles: clone(project.files),
      files: clone(project.files),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    this.#branches.set(branch.id, branch);
    return clone(branch);
  }

  writeBranchFile(input: { branchId: string; path: string; content: string }): AiTaskBranch {
    const branch = this.#openBranch(input.branchId);
    const path = normalizeProjectPath(input.path);
    if (!branch.taskScope.some((scope) => matchesScope(path, scope))) enterpriseError("BRANCH_SCOPE_DENIED", "AI branch write is outside its assigned scope.");
    if (input.content.length > 1_000_000 || input.content.includes("\0")) enterpriseError("INVALID_INPUT", "Branch file content is invalid.");
    branch.files[path] = input.content;
    branch.updatedAt = iso(this.#runtime.now());
    return clone(branch);
  }

  deleteBranchFile(input: { branchId: string; path: string }): AiTaskBranch {
    const branch = this.#openBranch(input.branchId);
    const path = normalizeProjectPath(input.path);
    if (!branch.taskScope.some((scope) => matchesScope(path, scope))) enterpriseError("BRANCH_SCOPE_DENIED", "AI branch delete is outside its assigned scope.");
    delete branch.files[path];
    branch.updatedAt = iso(this.#runtime.now());
    return clone(branch);
  }

  updateCanonical(input: {
    projectId: string;
    actorUserId: string;
    expectedRevision: number;
    writes: Record<string, string | null>;
  }): CanonicalProjectState {
    const project = this.#project(input.projectId);
    if (project.revision !== input.expectedRevision) enterpriseError("REVISION_CONFLICT", "Canonical project revision is stale.");
    const files = clone(project.files);
    for (const [rawPath, content] of Object.entries(input.writes)) {
      const path = normalizeProjectPath(rawPath);
      if (content === null) delete files[path];
      else {
        if (content.length > 1_000_000 || content.includes("\0")) enterpriseError("INVALID_INPUT", "Canonical file content is invalid.");
        files[path] = content;
      }
    }
    project.files = files;
    project.revision += 1;
    project.updatedAt = iso(this.#runtime.now());
    project.updatedBy = assertSafeId(input.actorUserId, "Actor user id");
    return clone(project);
  }

  mergeBranch(input: { branchId: string; actorUserId: string; approved: boolean }): BranchMergeResult {
    const branch = this.#openBranch(input.branchId, true);
    if (!input.approved) return { status: "approval-required" };
    const project = this.#project(branch.projectId);
    const changedPaths = [...new Set([...Object.keys(branch.baseFiles), ...Object.keys(branch.files)])]
      .filter((path) => branch.baseFiles[path] !== branch.files[path])
      .sort();
    const conflicts = changedPaths.filter((path) =>
      project.files[path] !== branch.baseFiles[path] && project.files[path] !== branch.files[path])
      .map((path) => ({
        path,
        baseHash: fileHash(branch.baseFiles[path]),
        canonicalHash: fileHash(project.files[path]),
        branchHash: fileHash(branch.files[path]),
      }));
    if (conflicts.length) {
      branch.status = "conflict";
      branch.updatedAt = iso(this.#runtime.now());
      return { status: "conflict", conflicts };
    }
    const checkpoint = this.#checkpoint(project, input.actorUserId, "pre-ai-merge");
    const files = clone(project.files);
    for (const path of changedPaths) {
      const content = branch.files[path];
      if (content === undefined) delete files[path];
      else files[path] = content;
    }
    project.files = files;
    project.revision += 1;
    project.updatedAt = iso(this.#runtime.now());
    project.updatedBy = assertSafeId(input.actorUserId, "Merge actor id");
    branch.status = "merged";
    branch.updatedAt = project.updatedAt;
    return { status: "merged", checkpointId: checkpoint.id, revision: project.revision };
  }

  rebaseBranch(input: { branchId: string }): { status: "rebased" } | { status: "conflict"; conflicts: BranchMergeConflict[] } {
    const branch = this.#branch(input.branchId);
    if (branch.status !== "open" && branch.status !== "conflict") enterpriseError("INVALID_INPUT", "Only an open or conflicting branch can be rebased.");
    const project = this.#project(branch.projectId);
    const changedPaths = [...new Set([...Object.keys(branch.baseFiles), ...Object.keys(branch.files)])]
      .filter((path) => branch.baseFiles[path] !== branch.files[path]);
    const conflicts = changedPaths.filter((path) =>
      project.files[path] !== branch.baseFiles[path] && project.files[path] !== branch.files[path])
      .map((path) => ({ path, baseHash: fileHash(branch.baseFiles[path]), canonicalHash: fileHash(project.files[path]), branchHash: fileHash(branch.files[path]) }));
    if (conflicts.length) return { status: "conflict", conflicts };
    const branchChanges = Object.fromEntries(changedPaths.map((path) => [path, branch.files[path]]));
    branch.baseRevision = project.revision;
    branch.baseFiles = clone(project.files);
    branch.files = clone(project.files);
    for (const [path, content] of Object.entries(branchChanges)) {
      if (content === undefined) delete branch.files[path];
      else branch.files[path] = content;
    }
    branch.status = "open";
    branch.updatedAt = iso(this.#runtime.now());
    return { status: "rebased" };
  }

  discardBranch(input: { branchId: string }): AiTaskBranch {
    const branch = this.#openBranch(input.branchId, true);
    branch.status = "discarded";
    branch.updatedAt = iso(this.#runtime.now());
    return clone(branch);
  }

  restoreCheckpoint(input: { projectId: string; checkpointId: string; actorUserId: string; expectedRevision: number }): CanonicalProjectState {
    const project = this.#project(input.projectId);
    if (project.revision !== input.expectedRevision) enterpriseError("REVISION_CONFLICT", "Restore revision is stale.");
    const checkpoint = this.#checkpoints.get(input.checkpointId);
    if (!checkpoint || checkpoint.projectId !== project.projectId) enterpriseError("NOT_FOUND", "Checkpoint was not found for this project.");
    project.files = clone(checkpoint.files);
    project.revision += 1;
    project.updatedAt = iso(this.#runtime.now());
    project.updatedBy = assertSafeId(input.actorUserId, "Restore actor id");
    return clone(project);
  }

  project(id: string): CanonicalProjectState {
    return clone(this.#project(id));
  }

  branch(id: string): AiTaskBranch {
    return clone(this.#branch(id));
  }

  #checkpoint(project: CanonicalProjectState, actorId: string, reason: ProjectCheckpoint["reason"]): ProjectCheckpoint {
    const checkpoint: ProjectCheckpoint = {
      id: assertSafeId(this.#runtime.id("checkpoint"), "Checkpoint id"),
      projectId: project.projectId,
      sourceRevision: project.revision,
      files: clone(project.files),
      createdAt: iso(this.#runtime.now()),
      createdBy: assertSafeId(actorId, "Checkpoint actor id"),
      reason,
    };
    this.#checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  #files(input: Record<string, string>): Record<string, string> {
    const entries = Object.entries(input);
    if (entries.length > 5_000) enterpriseError("INVALID_INPUT", "Project file count exceeds the branch manager limit.");
    return Object.fromEntries(entries.map(([path, content]) => {
      if (content.length > 1_000_000 || content.includes("\0")) enterpriseError("INVALID_INPUT", "Project file content is invalid.");
      return [normalizeProjectPath(path), content];
    }));
  }

  #project(id: string): CanonicalProjectState {
    const project = this.#projects.get(id);
    if (!project) enterpriseError("NOT_FOUND", "Canonical project was not found.");
    return project;
  }

  #branch(id: string): AiTaskBranch {
    const branch = this.#branches.get(id);
    if (!branch) enterpriseError("NOT_FOUND", "AI task branch was not found.");
    return branch;
  }

  #openBranch(id: string, allowConflict = false): AiTaskBranch {
    const branch = this.#branch(id);
    if (branch.status !== "open" && !(allowConflict && branch.status === "conflict")) enterpriseError("INVALID_INPUT", "AI task branch is not open.");
    return branch;
  }
}
