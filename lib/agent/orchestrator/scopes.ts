import { normalizeProjectV2Path } from "../../project-v2-path.ts";

const SAFE_SCOPE_SEGMENT = /^[A-Za-z0-9@._+()[\]-]+$/;

export function normalizeScopePattern(value: string): string {
  if (typeof value !== "string") throw new Error("File scope must be a string.");
  const pattern = value.normalize("NFC");
  if (!pattern || pattern !== pattern.trim() || pattern.startsWith("/") || pattern.includes("\\") || pattern.includes("\0")) {
    throw new Error("File scope must be a relative POSIX pattern.");
  }
  const segments = pattern.split("/");
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

function matchSegments(pattern: string[], path: string[], patternIndex = 0, pathIndex = 0): boolean {
  if (patternIndex === pattern.length) return pathIndex === path.length;
  const segment = pattern[patternIndex];
  if (segment === "**") {
    if (patternIndex === pattern.length - 1) return true;
    for (let index = pathIndex; index <= path.length; index += 1) {
      if (matchSegments(pattern, path, patternIndex + 1, index)) return true;
    }
    return false;
  }
  if (pathIndex >= path.length) return false;
  if (segment !== "*" && segment !== path[pathIndex]) return false;
  return matchSegments(pattern, path, patternIndex + 1, pathIndex + 1);
}

export function scopeMatchesPath(pattern: string, value: string): boolean {
  const safePattern = normalizeScopePattern(pattern);
  const path = normalizeProjectV2Path(value);
  return matchSegments(safePattern.split("/"), path.split("/"));
}

function staticPrefix(pattern: string): string[] {
  const segments = normalizeScopePattern(pattern).split("/");
  const wildcard = segments.findIndex((segment) => segment === "*" || segment === "**");
  return wildcard < 0 ? segments : segments.slice(0, wildcard);
}

function prefixCompatible(left: string[], right: string[]): boolean {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function scopePatternsOverlap(left: string, right: string): boolean {
  const a = normalizeScopePattern(left);
  const b = normalizeScopePattern(right);
  const aWildcard = a.includes("*");
  const bWildcard = b.includes("*");
  if (!aWildcard && !bWildcard) return a === b;
  if (!aWildcard) return scopeMatchesPath(b, a);
  if (!bWildcard) return scopeMatchesPath(a, b);
  return prefixCompatible(staticPrefix(a), staticPrefix(b));
}

export function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((a) => right.some((b) => scopePatternsOverlap(a, b)));
}

export function pathWithinScopes(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => scopeMatchesPath(scope, path));
}
