import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractRuntimeSystemPrompt } from "../system/runtime-prompt.ts";
import {
  AGENT_PROMPT_ROLES,
  type AgentPromptRole,
  type PromptCoreDocument,
  type RolePromptDocument,
} from "./types.ts";
import {
  estimatePromptTokens,
  promptContentHash,
  promptLineCount,
} from "./metrics.ts";

export const COMPACT_CORE_PATH = "docs/agent/core/CORE_SYSTEM.md";
export const LEGACY_CORE_PATH = "docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md";

const COMPACT_START = "<!-- COMPACT_CORE_START -->";
const COMPACT_END = "<!-- COMPACT_CORE_END -->";
const ROLE_START = "<!-- ROLE_PROMPT_START -->";
const ROLE_END = "<!-- ROLE_PROMPT_END -->";
const MAX_SOURCE_BYTES = 512 * 1024;

const ROLE_PATHS: Record<AgentPromptRole, string> = {
  router: "docs/agent/roles/ROUTER.md",
  planner: "docs/agent/roles/PLANNER.md",
  coder: "docs/agent/roles/CODER.md",
  "quick-edit": "docs/agent/roles/QUICK_EDIT.md",
  autofix: "docs/agent/roles/AUTOFIX.md",
  verifier: "docs/agent/roles/VERIFIER.md",
  "design-agent": "docs/agent/roles/DESIGN_AGENT.md",
  "visual-verifier": "docs/agent/roles/VISUAL_VERIFIER.md",
  qa: "docs/agent/roles/QA.md",
  security: "docs/agent/roles/SECURITY.md",
  "retrieval-reranker": "docs/agent/roles/RETRIEVAL_RERANKER.md",
  "eval-judge": "docs/agent/roles/EVAL_JUDGE.md",
};

type SourceReader = (path: string) => Promise<string>;

function defaultReader(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf8");
}

function boundedSource(source: string, label: string): void {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error(`${label} exceeds the bounded prompt source size.`);
  }
}

function exactlyOne(source: string, marker: string): boolean {
  return source.split(marker).length === 2;
}

function markedContent(source: string, start: string, end: string, label: string): string {
  if (!exactlyOne(source, start) || !exactlyOne(source, end)) {
    throw new Error(`${label} must contain exactly one prompt marker pair.`);
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (endIndex <= startIndex) throw new Error(`${label} prompt markers are out of order.`);
  const content = source.slice(startIndex + start.length, endIndex).trim();
  if (!content) throw new Error(`${label} prompt is empty.`);
  return content;
}

function inlineValue(source: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = source.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60\\s*$`, "m"))?.[1];
  if (!value) throw new Error(`Prompt metadata ${label} is missing.`);
  return value;
}

function booleanValue(source: string, label: string): boolean {
  const value = inlineValue(source, label);
  if (value !== "true" && value !== "false") throw new Error(`${label} must be true or false.`);
  return value === "true";
}

function listValue(source: string, label: string): string[] {
  const value = inlineValue(source, label);
  if (value === "none") return [];
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length || new Set(entries).size !== entries.length) {
    throw new Error(`${label} must contain unique comma-separated values.`);
  }
  return entries;
}

export async function loadCompactCorePrompt(options: { readSource?: SourceReader } = {}): Promise<PromptCoreDocument> {
  const source = await (options.readSource ?? defaultReader)(COMPACT_CORE_PATH);
  boundedSource(source, "Compact core");
  const content = markedContent(source, COMPACT_START, COMPACT_END, "Compact core");
  const version = inlineValue(source, "Version");
  if (!/^3\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    throw new Error("Compact core must use a V3 semantic version.");
  }
  return {
    mode: "compact-v3",
    version,
    sourcePath: COMPACT_CORE_PATH,
    content,
    contentHash: promptContentHash(content),
    estimatedTokens: estimatePromptTokens(content),
    lineCount: promptLineCount(content),
  };
}

export async function loadLegacyCorePrompt(options: { readSource?: SourceReader; fallbackReason?: string } = {}): Promise<PromptCoreDocument> {
  const source = await (options.readSource ?? defaultReader)(LEGACY_CORE_PATH);
  const legacy = extractRuntimeSystemPrompt(source, LEGACY_CORE_PATH);
  return {
    mode: "legacy-v2",
    version: legacy.version,
    sourcePath: legacy.sourcePath,
    content: legacy.content,
    contentHash: legacy.contentHash,
    estimatedTokens: estimatePromptTokens(legacy.content),
    lineCount: promptLineCount(legacy.content),
    ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
  };
}

export async function resolvePromptCore(options: {
  env?: Record<string, string | undefined>;
  readSource?: SourceReader;
} = {}): Promise<PromptCoreDocument> {
  const env = options.env ?? process.env;
  if (env.DROPS_AGENT_COMPACT_CORE_ENABLED !== "1") {
    return loadLegacyCorePrompt({ readSource: options.readSource });
  }
  try {
    return await loadCompactCorePrompt({ readSource: options.readSource });
  } catch (error) {
    if (env.DROPS_AGENT_LEGACY_CORE_FALLBACK === "0") throw error;
    return loadLegacyCorePrompt({
      readSource: options.readSource,
      fallbackReason: error instanceof Error ? error.message : "Compact core unavailable.",
    });
  }
}

export async function loadRolePrompt(
  role: AgentPromptRole,
  options: { readSource?: SourceReader } = {},
): Promise<RolePromptDocument> {
  if (!(AGENT_PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Unknown agent prompt role: ${role}.`);
  }
  const sourcePath = ROLE_PATHS[role];
  const source = await (options.readSource ?? defaultReader)(sourcePath);
  boundedSource(source, `${role} role prompt`);
  const declaredRole = inlineValue(source, "Role ID");
  if (declaredRole !== role) throw new Error(`${role} role prompt declares ${declaredRole}.`);
  const version = inlineValue(source, "Version");
  if (!/^3\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    throw new Error(`${role} role prompt must use a V3 semantic version.`);
  }
  const content = markedContent(source, ROLE_START, ROLE_END, `${role} role`);
  return {
    role,
    version,
    sourcePath,
    content,
    contentHash: promptContentHash(content),
    estimatedTokens: estimatePromptTokens(content),
    lineCount: promptLineCount(content),
    allowedTools: listValue(source, "Allowed tools"),
    mayMutateFiles: booleanValue(source, "May mutate files"),
    mayRunRuntime: booleanValue(source, "May run runtime"),
  };
}

export function rolePromptPath(role: AgentPromptRole): string {
  return ROLE_PATHS[role];
}
