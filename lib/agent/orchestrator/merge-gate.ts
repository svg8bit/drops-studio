import { applyProjectV2FileOperations } from "../../project-v2-files.ts";
import type { ProjectFileOperationV2, ProjectV2 } from "../../project-v2-types.ts";
import { validateProjectV2 } from "../../project-v2-validator.ts";
import { validatePatchBundle, PatchValidationError } from "./patch-validator.ts";
import type { AgentTask, FileLease, MergeResult, PatchBundle } from "./types.ts";

export interface MergeGateInput {
  project: ProjectV2;
  proposals: Array<{ task: AgentTask; lease: FileLease; bundle: PatchBundle }>;
  now?: () => Date;
}

function touchedPaths(bundle: PatchBundle): string[] {
  return bundle.operations.flatMap((operation) =>
    operation.type === "rename" ? [operation.from, operation.to] : [operation.path],
  );
}

function rerun(
  project: ProjectV2,
  taskIds: string[],
  code: "stale-base" | "stale-hash" | "bundle-conflict",
  reason: string,
): MergeResult {
  return { status: "rerun-required", project: structuredClone(project), taskIds, code, reason };
}

function mergeDependencies(project: ProjectV2, bundles: readonly PatchBundle[]): ProjectFileOperationV2 | null {
  const changes = bundles.flatMap((bundle) => bundle.dependencyChanges.map((change) => ({ ...change, taskId: bundle.taskId })));
  if (!changes.length) return null;
  const seen = new Map<string, string>();
  for (const change of changes) {
    const key = `${change.dev ? "dev" : "runtime"}:${change.name}`;
    const signature = `${change.action}:${change.version ?? ""}`;
    const existing = seen.get(key);
    if (existing && existing !== signature) throw new Error(`Conflicting dependency change for ${change.name}.`);
    seen.set(key, signature);
  }
  const manifest = JSON.parse(project.files["package.json"].content) as Record<string, unknown>;
  const dependencies = { ...((manifest.dependencies as Record<string, string> | undefined) ?? {}) };
  const devDependencies = { ...((manifest.devDependencies as Record<string, string> | undefined) ?? {}) };
  for (const change of changes.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const target = change.dev ? devDependencies : dependencies;
    if (change.action === "remove") delete target[change.name];
    else target[change.name] = change.version as string;
  }
  manifest.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b, "en")));
  manifest.devDependencies = Object.fromEntries(Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b, "en")));
  return {
    type: "write",
    path: "package.json",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    provenance: "ai",
  };
}

export async function mergePatchBundlesAtomically(input: MergeGateInput): Promise<MergeResult> {
  const original = structuredClone(input.project);
  if (!input.proposals.length) throw new Error("Merge gate requires at least one patch proposal.");
  const proposals = [...input.proposals].sort((left, right) => left.task.taskId.localeCompare(right.task.taskId, "en"));
  const validated: PatchBundle[] = [];
  try {
    for (const proposal of proposals) {
      validated.push(
        validatePatchBundle({
          bundle: proposal.bundle,
          task: proposal.task,
          project: original,
          lease: proposal.lease,
        }),
      );
    }
  } catch (error) {
    if (error instanceof PatchValidationError && error.rerunRequired) {
      const code = error.code === "stale-hash" ? "stale-hash" : "stale-base";
      return rerun(original, proposals.map(({ task }) => task.taskId), code, error.message);
    }
    throw error;
  }

  const ownerByPath = new Map<string, string>();
  for (const bundle of validated) {
    for (const path of touchedPaths(bundle)) {
      const owner = ownerByPath.get(path);
      if (owner && owner !== bundle.taskId) {
        return rerun(original, [owner, bundle.taskId], "bundle-conflict", `Tasks ${owner} and ${bundle.taskId} both change ${path}.`);
      }
      ownerByPath.set(path, bundle.taskId);
    }
  }
  let dependencyOperation: ProjectFileOperationV2 | null;
  try {
    dependencyOperation = mergeDependencies(original, validated);
  } catch (error) {
    return rerun(original, proposals.map(({ task }) => task.taskId), "bundle-conflict", error instanceof Error ? error.message : "Dependency conflict.");
  }
  const operations = [
    ...validated.flatMap((bundle) => bundle.operations),
    ...(dependencyOperation ? [dependencyOperation] : []),
  ];
  if (!operations.length) throw new Error("Patch proposals contain no changes.");
  const next = await applyProjectV2FileOperations(original, original.revision, operations, {
    ...(input.now ? { now: input.now } : {}),
  });
  await validateProjectV2(next);
  return {
    status: "merged",
    project: next,
    mergedTaskIds: proposals.map(({ task }) => task.taskId),
    changedPaths: [...new Set(operations.flatMap((operation) => operation.type === "rename" ? [operation.from, operation.to] : [operation.path]))].sort(),
  };
}
