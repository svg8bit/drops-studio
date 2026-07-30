import type { ProjectFileV2 } from "./project-v2-types.ts";

export interface ProjectFileDiffV2 {
  status: "added" | "deleted" | "modified" | "renamed";
  path: string;
  previousPath?: string;
  beforeHash?: string;
  afterHash?: string;
  additions: number;
  deletions: number;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineChanges(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const left = before ? before.split("\n") : [];
  const right = after ? after.split("\n") : [];
  const counts = new Map<string, number>();
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
  let additions = 0;
  for (const line of right) {
    const count = counts.get(line) ?? 0;
    if (count) counts.set(line, count - 1);
    else additions += 1;
  }
  const deletions = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return { additions, deletions };
}

export function diffProjectV2Files(
  before: Record<string, ProjectFileV2>,
  after: Record<string, ProjectFileV2>,
): ProjectFileDiffV2[] {
  const removed = new Set(Object.keys(before).filter((path) => !after[path]));
  const added = new Set(Object.keys(after).filter((path) => !before[path]));
  const diffs: ProjectFileDiffV2[] = [];

  for (const path of [...added].sort(comparePaths)) {
    const matches = [...removed]
      .filter((candidate) => before[candidate].hash === after[path].hash)
      .sort(comparePaths);
    if (matches.length !== 1) continue;
    const previousPath = matches[0];
    added.delete(path);
    removed.delete(previousPath);
    diffs.push({
      status: "renamed",
      path,
      previousPath,
      beforeHash: before[previousPath].hash,
      afterHash: after[path].hash,
      additions: 0,
      deletions: 0,
    });
  }

  for (const path of Object.keys(before).filter((candidate) => after[candidate]).sort(comparePaths)) {
    if (before[path].hash === after[path].hash) continue;
    diffs.push({
      status: "modified",
      path,
      beforeHash: before[path].hash,
      afterHash: after[path].hash,
      ...lineChanges(before[path].content, after[path].content),
    });
  }
  for (const path of [...added].sort(comparePaths)) {
    diffs.push({
      status: "added",
      path,
      afterHash: after[path].hash,
      additions: after[path].content ? after[path].content.split("\n").length : 0,
      deletions: 0,
    });
  }
  for (const path of [...removed].sort(comparePaths)) {
    diffs.push({
      status: "deleted",
      path,
      beforeHash: before[path].hash,
      additions: 0,
      deletions: before[path].content ? before[path].content.split("\n").length : 0,
    });
  }
  return diffs.sort((left, right) => comparePaths(left.path, right.path));
}
