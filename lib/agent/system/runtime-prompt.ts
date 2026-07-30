import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { roleContract } from "../models/role-prompts.ts";
import type {
  ComposedRuntimePrompt,
  RuntimePromptCompositionInput,
  RuntimeSystemPrompt,
} from "./types.ts";
import {
  RUNTIME_SYSTEM_PROMPT_END,
  RUNTIME_SYSTEM_PROMPT_START,
} from "./types.ts";

export const CANONICAL_RUNTIME_SYSTEM_PATH =
  "docs/agent/DROPS_STUDIO_AGENT_SYSTEM_V2.md";

const MAX_CANONICAL_SOURCE_BYTES = 512 * 1024;
const MAX_DYNAMIC_MODULE_BYTES = 256 * 1024;
const VERSION_PATTERN = /^\*\*Version:\*\*\s*([^\s]+)\s*$/m;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function occurrenceCount(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

export function extractRuntimeSystemPrompt(
  source: string,
  sourcePath = CANONICAL_RUNTIME_SYSTEM_PATH,
): RuntimeSystemPrompt {
  if (Buffer.byteLength(source, "utf8") > MAX_CANONICAL_SOURCE_BYTES) {
    throw new Error("Canonical runtime contract exceeds the bounded source size.");
  }
  if (
    occurrenceCount(source, RUNTIME_SYSTEM_PROMPT_START) !== 1 ||
    occurrenceCount(source, RUNTIME_SYSTEM_PROMPT_END) !== 1
  ) {
    throw new Error("Canonical runtime contract must contain exactly one marker pair.");
  }
  const start = source.indexOf(RUNTIME_SYSTEM_PROMPT_START);
  const end = source.indexOf(RUNTIME_SYSTEM_PROMPT_END);
  if (start < 0 || end <= start) {
    throw new Error("Canonical runtime prompt markers are out of order.");
  }
  const content = source
    .slice(start + RUNTIME_SYSTEM_PROMPT_START.length, end)
    .trim();
  if (!content) throw new Error("Canonical runtime prompt is empty.");
  const version = source.match(VERSION_PATTERN)?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    throw new Error("Canonical runtime contract has no valid semantic version.");
  }
  return { version, sourcePath, content, contentHash: hash(content) };
}

export async function loadRuntimeSystemPrompt(input?: {
  source?: string;
  sourcePath?: string;
}): Promise<RuntimeSystemPrompt> {
  const sourcePath = input?.sourcePath ?? CANONICAL_RUNTIME_SYSTEM_PATH;
  const source =
    input?.source ?? (await readFile(resolve(process.cwd(), sourcePath), "utf8"));
  return extractRuntimeSystemPrompt(source, sourcePath);
}

function publicModelProfile(
  model: RuntimePromptCompositionInput["model"],
): Record<string, unknown> {
  return {
    provider: model.provider,
    model: model.model,
    source: model.source,
    supportsTools: model.supportsTools,
    supportsParallelTools: model.supportsParallelTools,
    supportsStructuredOutput: model.supportsStructuredOutput,
    supportsVision: model.supportsVision,
    supportsEmbeddings: model.supportsEmbeddings,
    maxContextTokens: model.maxContextTokens,
    maxOutputTokens: model.maxOutputTokens,
    latencyClass: model.latencyClass,
    qualityClass: model.qualityClass,
    allowedRoles: [...model.allowedRoles].sort(),
    verifiedAt: model.verifiedAt,
  };
}

export function composeRuntimeSystemPrompt(
  input: RuntimePromptCompositionInput,
): ComposedRuntimePrompt {
  if (input.core.version !== input.versions.runtimePromptVersion) {
    throw new Error("Runtime contract version does not match run metadata.");
  }
  if (!input.model.authorized) {
    throw new Error("Runtime prompt cannot be composed for an unauthorized model.");
  }
  const dynamicModules = {
    versions: input.versions,
    role: roleContract(input.role),
    modelCapabilityProfile: publicModelProfile(input.model),
    routingMode: input.routingMode,
    approvalState: input.approvalState,
    task: input.task,
    projectMemory: input.projectMemory,
    selectedSkills: [...input.selectedSkills].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    retrievedContext: [...input.retrievedContext].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    runtimeEvidence: input.runtimeEvidence,
    integrationEvidence: input.integrationEvidence,
  };
  const modules = stableSerialize(dynamicModules);
  if (Buffer.byteLength(modules, "utf8") > MAX_DYNAMIC_MODULE_BYTES) {
    throw new Error("Dynamic runtime context exceeds the bounded prompt size.");
  }
  const prompt = `${input.core.content}\n\n<RUNTIME_MODULES>\n${modules}\n</RUNTIME_MODULES>`;
  return {
    prompt,
    promptHash: hash(prompt),
    coreHash: input.core.contentHash,
    moduleHash: hash(modules),
    versions: structuredClone(input.versions),
  };
}
