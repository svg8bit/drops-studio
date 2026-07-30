import type { ProjectV2 } from "../../project-v2-types.ts";

export const GENERATION_EVENT_VERSION = 1 as const;
export const GENERATION_STABILIZER_VERSION = "3.0.0";

export type GenerationDiagnosticCode =
  | "EVENT_INVALID"
  | "STREAM_INCOMPLETE"
  | "STREAM_LIMIT_EXCEEDED"
  | "FILE_LIMIT_EXCEEDED"
  | "PATH_INVALID"
  | "PATH_FORBIDDEN"
  | "FILE_PROTOCOL_INVALID"
  | "STALE_FILE_HASH"
  | "DUPLICATE_FILE_CONFLICT"
  | "SECRET_DETECTED"
  | "SYNTAX_INVALID"
  | "JSON_INVALID"
  | "PACKAGE_MANIFEST_INVALID"
  | "INSTALL_SCRIPT_FORBIDDEN"
  | "IMPORT_UNRESOLVED"
  | "IMPORT_EXTENSION_AMBIGUOUS"
  | "ALIAS_UNRESOLVED"
  | "PACKAGE_EXPORT_INVALID"
  | "DEPENDENCY_MISSING"
  | "LUCIDE_ICON_UNAVAILABLE"
  | "NEXT_CLIENT_BOUNDARY"
  | "ASSET_PATH_INVALID"
  | "API_ROUTE_MISSING"
  | "MALFORMED_PATCH"
  | "FIXER_SHADOW_ONLY";

export interface GenerationDiagnostic {
  id: string;
  code: GenerationDiagnosticCode;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
  path?: string;
  line?: number;
  evidence?: string;
  fixerId?: string;
}

export type GenerationEvent =
  | { version: 1; type: "text.delta"; value: string }
  | { version: 1; type: "file.begin"; path: string; expectedHash?: string }
  | { version: 1; type: "file.delta"; path: string; value: string }
  | { version: 1; type: "file.end"; path: string }
  | { version: 1; type: "tool.call"; tool: string; input: unknown }
  | { version: 1; type: "diagnostic"; diagnostic: GenerationDiagnostic }
  | { version: 1; type: "complete" };

export type GenerationEventInput = GenerationEvent | string;
export type GenerationEventStream =
  | Iterable<GenerationEventInput>
  | AsyncIterable<GenerationEventInput>;

export type StabilizerFixerMode = "disabled" | "shadow" | "active";

export interface StabilizerTransformationProvenance {
  fixerId: string;
  version: string;
  inputHash: string;
  outputHash: string;
  reasonCode: string;
  affectedPaths: string[];
  confidence: "deterministic";
  mode: StabilizerFixerMode;
  applied: boolean;
}

export interface StabilizerPatchWrite {
  type: "write";
  path: string;
  content: string;
  expectedHash?: string;
}

export interface StabilizerPatchBundle {
  schemaVersion: 1;
  baseRevision: number;
  baseContentHash: string;
  writes: StabilizerPatchWrite[];
  environmentVariableNames: string[];
  transformations: StabilizerTransformationProvenance[];
}

export interface StabilizerPolicy {
  maxStreamBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  fixerModes: Record<string, StabilizerFixerMode | undefined>;
}

export interface StabilizerEventReceipt {
  ordinal: number;
  type: GenerationEvent["type"];
  path?: string;
  bytes: number;
}

export interface StabilizerResult {
  status: "committed" | "shadow-blocked" | "rejected" | "incomplete";
  project: ProjectV2 | null;
  patchBundle: StabilizerPatchBundle | null;
  diagnostics: GenerationDiagnostic[];
  eventReceipts: StabilizerEventReceipt[];
  transformations: StabilizerTransformationProvenance[];
  environmentVariableNames: string[];
  committed: boolean;
}

export interface StabilizerFixerContext {
  path: string;
  content: string;
  projectFiles: Readonly<Record<string, string>>;
  diagnostics: readonly GenerationDiagnostic[];
}

export interface StabilizerFixerProposal {
  fixerId: string;
  version: string;
  reasonCode: string;
  path: string;
  content: string;
}

export interface StabilizerFixer {
  id: string;
  version: string;
  defaultMode: StabilizerFixerMode;
  propose(context: StabilizerFixerContext): StabilizerFixerProposal | null;
}
