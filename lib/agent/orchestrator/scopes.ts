import { normalizeProjectV2Path } from "../../project-v2-path.ts";

const SAFE_SCOPE_SEGMENT = /^[A-Za-z0-9@._+()[\]-]+$/;
const MAX_SCOPE_BYTES = 240;
const MAX_SCOPE_SEGMENTS = 64;

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeScopePattern(value: string): string {
  if (typeof value !== "string") throw new Error("File scope must be a string.");
  const pattern = value.normalize("NFC");
  if (!pattern || pattern !== pattern.trim() || pattern.startsWith("/") || pattern.includes("\\") || pattern.includes("\0")) {
    throw new Error("File scope must be a relative POSIX pattern.");
  }
  const segments = pattern.split("/");
  if (bytes(pattern) > MAX_SCOPE_BYTES || segments.length > MAX_SCOPE_SEGMENTS) {
    throw new Error("File scope is too long or contains too many segments.");
  }
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        (segment !== "*" && segment !== "**" && !SAFE_SCOPE_SEGMENT.test(segment)),
    )
  ) {
    throw new Error(`File scope ${value} is unsafe.`);
  }
  return segments.join("/");
}

function matchSegments(pattern: readonly string[], path: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const visit = (patternIndex: number, pathIndex: number): boolean => {
    const key = `${patternIndex}:${pathIndex}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (patternIndex === pattern.length) {
      const result = pathIndex === path.length;
      memo.set(key, result);
      return result;
    }
    const segment = pattern[patternIndex];
    const result = segment === "**"
      ? visit(patternIndex + 1, pathIndex) ||
        (pathIndex < path.length && visit(patternIndex, pathIndex + 1))
      : pathIndex < path.length &&
        (segment === "*" || segment === path[pathIndex]) &&
        visit(patternIndex + 1, pathIndex + 1);
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

export function scopeMatchesPath(pattern: string, value: string): boolean {
  const safePattern = normalizeScopePattern(pattern);
  const path = normalizeProjectV2Path(value);
  return matchSegments(safePattern.split("/"), path.split("/"));
}

function segmentsCanMatch(left: string, right: string): boolean {
  return left === "*" || left === "**" || right === "*" || right === "**" || left === right;
}

function patternLanguagesIntersect(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const queue: Array<readonly [number, number]> = [[0, 0]];
  const visited = new Set<string>();
  while (queue.length) {
    const [leftIndex, rightIndex] = queue.shift()!;
    const key = `${leftIndex}:${rightIndex}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (leftIndex === left.length && rightIndex === right.length) return true;

    const leftSegment = left[leftIndex];
    const rightSegment = right[rightIndex];
    if (leftSegment === "**") queue.push([leftIndex + 1, rightIndex]);
    if (rightSegment === "**") queue.push([leftIndex, rightIndex + 1]);
    if (
      leftSegment !== undefined &&
      rightSegment !== undefined &&
      segmentsCanMatch(leftSegment, rightSegment)
    ) {
      const nextLeft = leftSegment === "**" ? leftIndex : leftIndex + 1;
      const nextRight = rightSegment === "**" ? rightIndex : rightIndex + 1;
      if (nextLeft !== leftIndex || nextRight !== rightIndex) {
        queue.push([nextLeft, nextRight]);
      }
    }
  }
  return false;
}

export function scopePatternsOverlap(left: string, right: string): boolean {
  const a = normalizeScopePattern(left).split("/");
  const b = normalizeScopePattern(right).split("/");
  return patternLanguagesIntersect(a, b);
}

export function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((a) => right.some((b) => scopePatternsOverlap(a, b)));
}

export function pathWithinScopes(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => scopeMatchesPath(scope, path));
}
