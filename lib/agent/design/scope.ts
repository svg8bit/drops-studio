import { normalizeProjectV2Path } from "../../project-v2-path.ts";
import { designFileChangeSchema, type DesignFileChange } from "./types.ts";

export const DESIGN_AGENT_ALLOWED_TOOLS = [
  "list_files",
  "read_file",
  "read_files",
  "search_files",
  "write_file",
  "apply_patch",
  "run_typecheck",
  "run_lint",
  "run_tests",
  "run_build",
  "start_preview",
  "browser_check",
  "read_logs",
] as const;

export const VISUAL_VERIFIER_ALLOWED_TOOLS = [
  "list_files",
  "read_file",
  "read_files",
  "search_files",
  "read_logs",
  "browser_check",
] as const;

const FRONTEND_ROOT = /^(?:app|components|styles|public|src\/(?:app|components|styles)|(?:src\/)?lib\/ui)\//;
const FRONTEND_EXTENSION = /\.(?:css|scss|sass|less|tsx|jsx|svg|png|jpe?g|webp|avif|gif|woff2?|ttf)$/i;
const PROTECTED_PATH = /(?:^|\/)(?:api|auth|server|providers?|integrations?|database|db|webhooks?|secrets?|middleware)(?:\/|\.|$)|(?:^|\/)(?:route|actions?)\.(?:ts|tsx|js|jsx)$|^(?:package(?:-lock)?\.json|next\.config\.|tsconfig\.json|\.env)/i;

function withinScope(path: string, scope: string): boolean {
  const normalizedScope = scope.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedScope.endsWith("/**")) {
    const root = normalizedScope.slice(0, -3).replace(/\/$/, "");
    return path === root || path.startsWith(`${root}/`);
  }
  if (normalizedScope.endsWith("/*")) {
    const root = normalizedScope.slice(0, -2).replace(/\/$/, "");
    return path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes("/");
  }
  return path === normalizedScope;
}

export function assertDesignAgentScope(
  changes: readonly DesignFileChange[],
  assignedScopes: readonly string[],
): string[] {
  if (!changes.length) throw new Error("Design Agent patch must contain at least one frontend change.");
  if (!assignedScopes.length) throw new Error("Design Agent requires explicit assigned frontend scopes.");
  const normalized: string[] = [];
  for (const raw of changes) {
    const change = designFileChangeSchema.parse(raw);
    const path = normalizeProjectV2Path(change.path);
    if (!FRONTEND_ROOT.test(path) || !FRONTEND_EXTENSION.test(path) || PROTECTED_PATH.test(path)) {
      throw new Error(`Design Agent cannot mutate non-frontend or protected path ${path}.`);
    }
    if (!assignedScopes.some((scope) => withinScope(path, scope))) {
      throw new Error(`Design Agent path ${path} is outside its assigned scope.`);
    }
    normalized.push(path);
  }
  if (new Set(normalized).size !== normalized.length) throw new Error("Design Agent patch contains duplicate paths.");
  return normalized;
}

export function assertNoVisualSnapshotUpdate(command: readonly string[] | string): void {
  const value = typeof command === "string" ? command : [...command].join(" ");
  if (/(?:--update-snapshots|updateSnapshot|UPDATE_SNAPSHOTS|toHaveScreenshot\([^)]*update)/i.test(value)) {
    throw new Error("Design Agent and Visual Verifier cannot update approved visual snapshots.");
  }
}
