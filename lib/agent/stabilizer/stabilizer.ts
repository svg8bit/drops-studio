import { createHash } from "node:crypto";

import { findArtifactSecrets } from "../../artifact-security.ts";
import { applyProjectV2FileOperations } from "../../project-v2-files.ts";
import {
  PROJECT_V2_FILE_BYTES_LIMIT,
  PROJECT_V2_FILE_LIMIT,
  normalizeProjectV2Path,
} from "../../project-v2-path.ts";
import type { ProjectV2 } from "../../project-v2-types.ts";
import { runDeterministicGenerationChecks } from "./checks.ts";
import {
  GenerationEventDecodeError,
  decodeGenerationEvents,
} from "./events.ts";
import {
  DEFAULT_STABILIZER_FIXER_REGISTRY,
  StabilizerFixerRegistry,
} from "./fixers.ts";
import type {
  GenerationDiagnostic,
  GenerationEvent,
  GenerationEventStream,
  StabilizerEventReceipt,
  StabilizerPatchBundle,
  StabilizerPolicy,
  StabilizerResult,
  StabilizerTransformationProvenance,
} from "./types.ts";

const DEFAULT_POLICY: Readonly<StabilizerPolicy> = Object.freeze({
  maxStreamBytes: 2_000_000,
  maxFiles: PROJECT_V2_FILE_LIMIT,
  maxFileBytes: PROJECT_V2_FILE_BYTES_LIMIT,
  fixerModes: {},
});
const FORBIDDEN_GENERATED_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "next-env.d.ts",
]);

interface BufferedFile {
  path: string;
  content: string;
  expectedHash?: string;
  bytes: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function diagnostic(
  code: GenerationDiagnostic["code"],
  severity: GenerationDiagnostic["severity"],
  message: string,
  path?: string,
  fixerId?: string,
): GenerationDiagnostic {
  return {
    id: hash(`${code}\0${path ?? ""}\0${message}`).slice(0, 24),
    code,
    severity,
    message,
    ...(path ? { path } : {}),
    ...(fixerId ? { fixerId } : {}),
  };
}

function policy(input?: Partial<StabilizerPolicy>): StabilizerPolicy {
  const result = {
    maxStreamBytes: input?.maxStreamBytes ?? DEFAULT_POLICY.maxStreamBytes,
    maxFiles: input?.maxFiles ?? DEFAULT_POLICY.maxFiles,
    maxFileBytes: input?.maxFileBytes ?? DEFAULT_POLICY.maxFileBytes,
    fixerModes: { ...(input?.fixerModes ?? {}) },
  };
  if (!Number.isSafeInteger(result.maxStreamBytes) || result.maxStreamBytes < 1 || result.maxStreamBytes > 4_000_000) {
    throw new Error("Stabilizer stream limit is invalid.");
  }
  if (!Number.isSafeInteger(result.maxFiles) || result.maxFiles < 1 || result.maxFiles > PROJECT_V2_FILE_LIMIT) {
    throw new Error("Stabilizer file limit is invalid.");
  }
  if (!Number.isSafeInteger(result.maxFileBytes) || result.maxFileBytes < 1 || result.maxFileBytes > PROJECT_V2_FILE_BYTES_LIMIT) {
    throw new Error("Stabilizer per-file limit is invalid.");
  }
  return result;
}

function eventBytes(event: GenerationEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

function safePath(value: string): string {
  const path = normalizeProjectV2Path(value);
  if (findArtifactSecrets(path, "generated file path").length) {
    throw new Error("Generated output path contains credential-like material.");
  }
  if (FORBIDDEN_GENERATED_FILES.has(path.toLowerCase())) {
    throw new Error("Generated output targets a policy-controlled file.");
  }
  return path;
}

function baseFiles(project: ProjectV2): Record<string, string> {
  return Object.fromEntries(
    Object.entries(project.files).map(([path, file]) => [path, file.content]),
  );
}

function blocking(diagnostics: readonly GenerationDiagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === "blocking" || entry.severity === "error");
}

function emptyResult(
  status: StabilizerResult["status"],
  diagnostics: GenerationDiagnostic[],
  receipts: StabilizerEventReceipt[],
  transformations: StabilizerTransformationProvenance[] = [],
): StabilizerResult {
  return {
    status,
    project: null,
    patchBundle: null,
    diagnostics,
    eventReceipts: receipts,
    transformations,
    environmentVariableNames: [],
    committed: false,
  };
}

export async function stabilizeGeneration(input: {
  project: ProjectV2;
  stream: GenerationEventStream;
  policy?: Partial<StabilizerPolicy>;
  fixerRegistry?: StabilizerFixerRegistry;
  onEvent?: (event: GenerationEvent, receipt: StabilizerEventReceipt) => void | Promise<void>;
  now?: () => Date;
}): Promise<StabilizerResult> {
  const resolvedPolicy = policy(input.policy);
  const registry = input.fixerRegistry ?? DEFAULT_STABILIZER_FIXER_REGISTRY;
  const open = new Map<string, BufferedFile>();
  const writes = new Map<string, BufferedFile>();
  const diagnostics: GenerationDiagnostic[] = [];
  const receipts: StabilizerEventReceipt[] = [];
  let streamBytes = 0;
  let complete = false;
  let ordinal = 0;

  try {
    for await (const event of decodeGenerationEvents(input.stream)) {
      const bytes = eventBytes(event);
      streamBytes += bytes;
      const rawPath = "path" in event ? event.path : undefined;
      const receipt: StabilizerEventReceipt = {
        ordinal,
        type: event.type,
        ...(rawPath ? { path: rawPath } : {}),
        bytes,
      };
      ordinal += 1;
      receipts.push(receipt);
      await input.onEvent?.(event, receipt);
      if (streamBytes > resolvedPolicy.maxStreamBytes) {
        diagnostics.push(diagnostic("STREAM_LIMIT_EXCEEDED", "blocking", "Generation stream exceeded its bounded byte limit."));
        return emptyResult("rejected", diagnostics, receipts);
      }
      if (complete) {
        diagnostics.push(diagnostic("FILE_PROTOCOL_INVALID", "blocking", "No event may follow the complete event."));
        return emptyResult("rejected", diagnostics, receipts);
      }
      if (event.type === "text.delta") continue;
      if (event.type === "diagnostic") {
        if (findArtifactSecrets(JSON.stringify(event.diagnostic), "generation diagnostic").length) {
          diagnostics.push(diagnostic("SECRET_DETECTED", "blocking", "A streamed diagnostic contained credential-like material and was discarded."));
        } else {
          diagnostics.push(structuredClone(event.diagnostic));
        }
        continue;
      }
      if (event.type === "tool.call") {
        if (findArtifactSecrets(JSON.stringify(event.input), "generation tool proposal").length) {
          diagnostics.push(diagnostic("SECRET_DETECTED", "blocking", "A streamed tool proposal contained credential-like material and was discarded."));
        }
        continue;
      }
      if (event.type === "complete") {
        complete = true;
        continue;
      }
      let path: string;
      try {
        path = safePath(event.path);
      } catch (error) {
        diagnostics.push(diagnostic(
          FORBIDDEN_GENERATED_FILES.has(event.path.toLowerCase()) ? "PATH_FORBIDDEN" : "PATH_INVALID",
          "blocking",
          error instanceof Error ? error.message : "Generated path is invalid.",
        ));
        return emptyResult("rejected", diagnostics, receipts);
      }
      if (event.type === "file.begin") {
        if (open.has(path)) {
          diagnostics.push(diagnostic("FILE_PROTOCOL_INVALID", "blocking", "file.begin was repeated before file.end.", path));
          return emptyResult("rejected", diagnostics, receipts);
        }
        const existing = input.project.files[path];
        if (event.expectedHash && existing?.hash !== event.expectedHash) {
          diagnostics.push(diagnostic("STALE_FILE_HASH", "blocking", "Generated file edit is based on a stale or missing file hash.", path));
          return emptyResult("rejected", diagnostics, receipts);
        }
        open.set(path, {
          path,
          content: "",
          ...(event.expectedHash ? { expectedHash: event.expectedHash } : {}),
          bytes: 0,
        });
        if (new Set([...open.keys(), ...writes.keys()]).size > resolvedPolicy.maxFiles) {
          diagnostics.push(diagnostic("FILE_LIMIT_EXCEEDED", "blocking", "Generation stream exceeded its bounded file count."));
          return emptyResult("rejected", diagnostics, receipts);
        }
        continue;
      }
      const current = open.get(path);
      if (!current) {
        diagnostics.push(diagnostic("FILE_PROTOCOL_INVALID", "blocking", `${event.type} requires a matching file.begin.`, path));
        return emptyResult("rejected", diagnostics, receipts);
      }
      if (event.type === "file.delta") {
        const nextBytes = current.bytes + new TextEncoder().encode(event.value).byteLength;
        if (nextBytes > resolvedPolicy.maxFileBytes) {
          diagnostics.push(diagnostic("STREAM_LIMIT_EXCEEDED", "blocking", "Generated file exceeded its bounded byte limit.", path));
          return emptyResult("rejected", diagnostics, receipts);
        }
        current.content += event.value;
        current.bytes = nextBytes;
        continue;
      }
      open.delete(path);
      const prior = writes.get(path);
      if (prior && (prior.content !== current.content || prior.expectedHash !== current.expectedHash)) {
        diagnostics.push(diagnostic("DUPLICATE_FILE_CONFLICT", "blocking", "Conflicting duplicate file operations cannot be reconciled.", path));
        return emptyResult("rejected", diagnostics, receipts);
      }
      writes.set(path, current);
    }
  } catch (error) {
    diagnostics.push(diagnostic(
      "EVENT_INVALID",
      "blocking",
      error instanceof GenerationEventDecodeError
        ? error.message
        : "Generation event stream could not be decoded.",
    ));
    return emptyResult("rejected", diagnostics, receipts);
  }

  if (!complete || open.size) {
    diagnostics.push(diagnostic(
      "STREAM_INCOMPLETE",
      "blocking",
      "Partial generation stream was retained as diagnostics only; no canonical mutation occurred.",
    ));
    return emptyResult("incomplete", diagnostics, receipts);
  }
  if (!writes.size) {
    diagnostics.push(diagnostic("MALFORMED_PATCH", "blocking", "A complete generation must contain at least one file write."));
    return emptyResult("rejected", diagnostics, receipts);
  }
  if (blocking(diagnostics)) return emptyResult("rejected", diagnostics, receipts);

  const files = baseFiles(input.project);
  for (const write of writes.values()) files[write.path] = write.content;
  const transformations: StabilizerTransformationProvenance[] = [];
  for (const path of [...writes.keys()].sort()) {
    for (const fixer of registry.list()) {
      const mode = registry.modeFor(fixer, resolvedPolicy.fixerModes);
      if (mode === "disabled") continue;
      const before = files[path];
      const proposal = fixer.propose({
        path,
        content: before,
        projectFiles: files,
        diagnostics,
      });
      if (!proposal || proposal.content === before) continue;
      const provenance: StabilizerTransformationProvenance = {
        fixerId: proposal.fixerId,
        version: proposal.version,
        inputHash: hash(before),
        outputHash: hash(proposal.content),
        reasonCode: proposal.reasonCode,
        affectedPaths: [path],
        confidence: "deterministic",
        mode,
        applied: mode === "active",
      };
      transformations.push(provenance);
      if (mode === "active") {
        files[path] = proposal.content;
      } else {
        diagnostics.push(diagnostic(
          "FIXER_SHADOW_ONLY",
          "warning",
          `Fixer ${fixer.id} proposed a deterministic transformation in shadow mode.`,
          path,
          fixer.id,
        ));
      }
    }
  }

  const changedPaths = [...writes.keys()].sort();
  const checks = runDeterministicGenerationChecks({ files, changedPaths });
  diagnostics.push(...checks.diagnostics);
  const sortedDiagnostics = diagnostics.sort((left, right) =>
    (left.path ?? "").localeCompare(right.path ?? "") ||
    left.code.localeCompare(right.code) ||
    left.id.localeCompare(right.id),
  );
  if (blocking(sortedDiagnostics)) {
    return emptyResult(
      transformations.some((entry) => entry.mode === "shadow")
        ? "shadow-blocked"
        : "rejected",
      sortedDiagnostics,
      receipts,
      transformations,
    );
  }

  const patchBundle: StabilizerPatchBundle = {
    schemaVersion: 1,
    baseRevision: input.project.revision,
    baseContentHash: input.project.contentHash,
    writes: changedPaths.map((path) => ({
      type: "write",
      path,
      content: files[path],
      ...(writes.get(path)?.expectedHash
        ? { expectedHash: writes.get(path)!.expectedHash }
        : {}),
    })),
    environmentVariableNames: checks.environmentVariableNames,
    transformations,
  };
  try {
    const project = await applyProjectV2FileOperations(
      input.project,
      patchBundle.baseRevision,
      patchBundle.writes.map((write) => ({
        type: "write" as const,
        path: write.path,
        content: write.content,
        provenance: "ai" as const,
      })),
      { now: input.now },
    );
    return {
      status: "committed",
      project,
      patchBundle,
      diagnostics: sortedDiagnostics,
      eventReceipts: receipts,
      transformations,
      environmentVariableNames: checks.environmentVariableNames,
      committed: true,
    };
  } catch (error) {
    sortedDiagnostics.push(diagnostic(
      "MALFORMED_PATCH",
      "blocking",
      error instanceof Error ? error.message.slice(0, 600) : "Canonical Project V2 mutation rejected the patch bundle.",
    ));
    return emptyResult("rejected", sortedDiagnostics, receipts, transformations);
  }
}
