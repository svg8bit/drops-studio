import type {
  ProjectFileV2,
  ProjectPreviewStateV2,
} from "../lib/project-v2-types.ts";

export type ProjectV2DraftMap = Record<string, string>;

export function resolveProjectV2DraftContent(
  drafts: ProjectV2DraftMap,
  path: string | null,
  files: Readonly<Record<string, ProjectFileV2>>,
): string {
  if (!path) return "";
  return Object.hasOwn(drafts, path)
    ? drafts[path]
    : files[path]?.content ?? "";
}

export function updateProjectV2DraftMap(
  drafts: ProjectV2DraftMap,
  path: string,
  content: string,
  savedContent: string,
): ProjectV2DraftMap {
  if (content === savedContent) {
    if (!Object.hasOwn(drafts, path)) return drafts;
    const next = { ...drafts };
    delete next[path];
    return next;
  }
  if (drafts[path] === content) return drafts;
  return { ...drafts, [path]: content };
}

export function clearProjectV2Draft(
  drafts: ProjectV2DraftMap,
  path: string,
): ProjectV2DraftMap {
  if (!Object.hasOwn(drafts, path)) return drafts;
  const next = { ...drafts };
  delete next[path];
  return next;
}

export interface ProjectV2FileTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: ProjectV2FileTreeNode[];
}

function compareTreeNodes(left: ProjectV2FileTreeNode, right: ProjectV2FileTreeNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" });
}

export function buildProjectV2FileTree(paths: readonly string[]): ProjectV2FileTreeNode[] {
  interface MutableNode {
    kind: "directory" | "file";
    name: string;
    path: string;
    children: Map<string, MutableNode>;
  }
  const roots = new Map<string, MutableNode>();
  for (const path of [...new Set(paths)].sort()) {
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) continue;
    let level: Map<string, MutableNode> = roots;
    let currentPath = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const kind = index === parts.length - 1 ? "file" : "directory";
      let node = level.get(name);
      if (!node) {
        node = { kind, name, path: currentPath, children: new Map() };
        level.set(name, node);
      }
      if (kind === "directory") level = node.children;
    }
  }

  function materialize(nodes: Map<string, MutableNode>): ProjectV2FileTreeNode[] {
    return [...nodes.values()].map((node) => {
      return {
        kind: node.kind,
        name: node.name,
        path: node.path,
        children: materialize(node.children),
      };
    }).sort(compareTreeNodes);
  }

  return materialize(roots);
}

export function filterProjectV2FileTree(
  nodes: readonly ProjectV2FileTreeNode[],
  query: string,
): ProjectV2FileTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes.map((node) => ({ ...node, children: filterProjectV2FileTree(node.children, "") }));
  return nodes.flatMap((node) => {
    const matchesSelf = node.path.toLowerCase().includes(normalized);
    const children = matchesSelf
      ? node.children.map((child) => ({ ...child, children: filterProjectV2FileTree(child.children, "") }))
      : filterProjectV2FileTree(node.children, normalized);
    if (!matchesSelf && !children.length) return [];
    return [{ ...node, children }];
  });
}

export interface ProjectV2LineDiff {
  kind: "context" | "added" | "removed";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function fallbackLineDiff(before: string[], after: string[]): ProjectV2LineDiff[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const result: ProjectV2LineDiff[] = [];
  for (let index = 0; index < prefix; index += 1) {
    result.push({ kind: "context", content: before[index], oldLine: index + 1, newLine: index + 1 });
  }
  for (let index = prefix; index < before.length - suffix; index += 1) {
    result.push({ kind: "removed", content: before[index], oldLine: index + 1 });
  }
  for (let index = prefix; index < after.length - suffix; index += 1) {
    result.push({ kind: "added", content: after[index], newLine: index + 1 });
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    const oldIndex = before.length - offset;
    const newIndex = after.length - offset;
    result.push({ kind: "context", content: before[oldIndex], oldLine: oldIndex + 1, newLine: newIndex + 1 });
  }
  return result;
}

export function createProjectV2LineDiff(beforeText: string, afterText: string): ProjectV2LineDiff[] {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length > 600 || after.length > 600) return fallbackLineDiff(before, after);
  const width = after.length + 1;
  const table = new Uint16Array((before.length + 1) * width);
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex;
      table[offset] = before[oldIndex] === after[newIndex]
        ? table[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex], table[oldIndex * width + newIndex + 1]);
    }
  }
  const result: ProjectV2LineDiff[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < before.length && newIndex < after.length) {
    if (before[oldIndex] === after[newIndex]) {
      result.push({ kind: "context", content: before[oldIndex], oldLine: oldIndex + 1, newLine: newIndex + 1 });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      result.push({ kind: "removed", content: before[oldIndex], oldLine: oldIndex + 1 });
      oldIndex += 1;
    } else {
      result.push({ kind: "added", content: after[newIndex], newLine: newIndex + 1 });
      newIndex += 1;
    }
  }
  while (oldIndex < before.length) {
    result.push({ kind: "removed", content: before[oldIndex], oldLine: oldIndex + 1 });
    oldIndex += 1;
  }
  while (newIndex < after.length) {
    result.push({ kind: "added", content: after[newIndex], newLine: newIndex + 1 });
    newIndex += 1;
  }
  return result;
}

export function verifiedProjectV2PreviewUrl(preview: ProjectPreviewStateV2 | undefined): string | null {
  if (preview?.status !== "ready" || !preview.url) return null;
  try {
    const url = new URL(preview.url);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatProjectV2Duration(startedAt: string | undefined, now: number): string {
  if (!startedAt) return "—";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "—";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
