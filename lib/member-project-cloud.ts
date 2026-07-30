import {
  assertProjectPayloadSafe,
  assertPublishedArtifactSafe,
} from "./artifact-security.ts";
import { compileProject } from "./project-compiler.ts";
import {
  compileWorkspaceRuntime,
  validateProjectWorkspace,
  type ProjectWorkspace,
} from "./project-workspace.ts";
import type {
  GeneratedProjectSpec,
  ProjectChatMessage,
  ProjectCheckpoint,
} from "./project-types.ts";
import { validateProjectSpec } from "./project-validator.ts";

export const MEMBER_PROJECT_BODY_LIMIT_BYTES = 2_000_000;
export const MEMBER_PROJECT_STORE_LIMIT_BYTES = 3_000_000;
export const MEMBER_PROJECT_CHECKPOINT_LIMIT = 12;
export const MEMBER_PROJECT_CONVERSATION_LIMIT = 100;

export interface MemberProjectDraft {
  id: string;
  spec: GeneratedProjectSpec;
  checkpoints: ProjectCheckpoint[];
  futureCheckpoints: ProjectCheckpoint[];
  conversation: ProjectChatMessage[];
  workspace?: ProjectWorkspace;
  publishedUrl?: string;
  publishedSlug?: string;
  publishedAt?: string;
}

export interface MemberProjectRecord extends MemberProjectDraft {
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const projectFields = new Set([
  "id",
  "spec",
  "checkpoints",
  "futureCheckpoints",
  "conversation",
  "workspace",
  "publishedUrl",
  "publishedSlug",
  "publishedAt",
]);
const storedRecordFields = new Set([
  ...projectFields,
  "schemaVersion",
  "revision",
  "createdAt",
  "updatedAt",
]);
const checkpointSources = new Set<ProjectCheckpoint["source"]>([
  "director",
  "design",
  "manual",
  "system",
]);
const checkpointFields = new Set([
  "id",
  "label",
  "createdAt",
  "source",
  "spec",
  "branch",
]);
const forbiddenExecutableFields = new Set([
  "artifact",
  "artifacts",
  "compiledhtml",
  "files",
  "html",
  "publishcapability",
  "sourcecode",
  "sourcedraft",
]);
const credentialField = /(?:api)?key|token|secret|password|authorization|credential/i;
const workspaceFields = new Set([
  "schemaVersion",
  "revision",
  "updatedAt",
  "files",
  "tasks",
  "runtime",
]);
const workspaceFileFields = new Set([
  "path",
  "content",
  "language",
  "role",
  "editable",
]);
const workspaceTaskFields = new Set([
  "id",
  "label",
  "command",
  "args",
  "cwd",
  "port",
]);
const workspaceRuntimeFields = new Set([
  "executionMode",
  "provider",
  "isolation",
  "runtime",
  "packageManager",
  "installScripts",
]);

export class MemberProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberProjectValidationError";
  }
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function onlyFields(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknownFields = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknownFields.length) {
    throw new Error(`${label} contains unsupported fields: ${unknownFields.join(", ")}.`);
  }
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!cleaned || cleaned.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} characters.`);
  }
  return cleaned;
}

function identifier(value: unknown, label: string): string {
  const candidate = text(value, label, 128);
  if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(candidate)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return candidate;
}

function timestamp(value: unknown, label: string): string {
  const candidate = text(value, label, 40);
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return candidate;
}

function optionalUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const candidate = text(value, label, 700);
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error();
    }
    return parsed.href;
  } catch {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials.`);
  }
}

function findForbiddenField(value: unknown, path = "project"): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [rawKey, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = rawKey.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (forbiddenExecutableFields.has(normalized)) {
      return `${path}.${rawKey} is an executable artifact field`;
    }
    if (credentialField.test(normalized)) {
      return `${path}.${rawKey} is a credential field`;
    }
    const found = findForbiddenField(child, `${path}.${rawKey}`);
    if (found) return found;
  }
  return null;
}

function validatedSpec(
  value: unknown,
  label: string,
  verifyArtifact: boolean,
): GeneratedProjectSpec {
  const normalized = validateProjectSpec(value);
  if (verifyArtifact) {
    const html = compileProject(normalized);
    assertPublishedArtifactSafe(normalized, html);
    if (!html.includes("<!doctype html>")) {
      throw new Error(`${label} did not compile into a runnable project.`);
    }
  }
  return normalized;
}

function validatedWorkspace(
  value: unknown,
  spec: GeneratedProjectSpec,
  verifyArtifact: boolean,
): ProjectWorkspace {
  const input = plainObject(value, "Member project workspace");
  onlyFields(input, workspaceFields, "Member project workspace");
  if (!Array.isArray(input.files) || !Array.isArray(input.tasks)) {
    throw new Error("Member project workspace files and tasks must be arrays.");
  }
  const files = input.files.map((value, index) => {
    const item = plainObject(value, `Workspace file ${index + 1}`);
    onlyFields(item, workspaceFileFields, `Workspace file ${index + 1}`);
    return {
      path: item.path,
      content: item.content,
      language: item.language,
      role: item.role,
      editable: item.editable,
    };
  });
  const tasks = input.tasks.map((value, index) => {
    const item = plainObject(value, `Workspace task ${index + 1}`);
    onlyFields(item, workspaceTaskFields, `Workspace task ${index + 1}`);
    if (!Array.isArray(item.args)) {
      throw new Error(`Workspace task ${index + 1} args must be an array.`);
    }
    return {
      id: item.id,
      label: item.label,
      command: item.command,
      args: [...item.args],
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      ...(item.port === undefined ? {} : { port: item.port }),
    };
  });
  const runtime = plainObject(input.runtime, "Member project workspace runtime");
  onlyFields(runtime, workspaceRuntimeFields, "Member project workspace runtime");
  const workspace = {
    schemaVersion: input.schemaVersion,
    revision: input.revision,
    updatedAt: input.updatedAt,
    files,
    tasks,
    runtime: {
      executionMode: runtime.executionMode,
      provider: runtime.provider,
      isolation: runtime.isolation,
      runtime: runtime.runtime,
      packageManager: runtime.packageManager,
      installScripts: runtime.installScripts,
    },
  } as unknown as ProjectWorkspace;
  const validation = validateProjectWorkspace(spec, workspace);
  if (!validation.valid) {
    throw new Error(
      `Member project workspace is invalid: ${validation.issues[0] ?? "workspace validation failed."}`,
    );
  }
  if (verifyArtifact) {
    const html = compileWorkspaceRuntime(spec, workspace);
    assertPublishedArtifactSafe(spec, html);
  }
  return workspace;
}

function checkpoint(
  value: unknown,
  index: number,
  verifyArtifact: boolean,
): ProjectCheckpoint {
  const input = plainObject(value, `Checkpoint ${index + 1}`);
  const unknownFields = Object.keys(input).filter(
    (field) => !checkpointFields.has(field),
  );
  if (unknownFields.length) {
    throw new Error(
      `Checkpoint ${index + 1} contains unsupported fields: ${unknownFields.join(", ")}.`,
    );
  }
  const source = input.source as ProjectCheckpoint["source"];
  if (!checkpointSources.has(source)) {
    throw new Error(`Checkpoint ${index + 1} has an unsupported source.`);
  }
  const branchInput = input.branch === undefined
    ? null
    : plainObject(input.branch, `Checkpoint ${index + 1} branch`);
  if (
    branchInput &&
    (
      Object.keys(branchInput).some(
        (field) => !["fromCheckpointId", "replacedCheckpointCount"].includes(field),
      ) ||
      !Number.isSafeInteger(branchInput.replacedCheckpointCount) ||
      Number(branchInput.replacedCheckpointCount) < 1 ||
      Number(branchInput.replacedCheckpointCount) > MEMBER_PROJECT_CHECKPOINT_LIMIT
    )
  ) {
    throw new Error(`Checkpoint ${index + 1} branch metadata is invalid.`);
  }
  return {
    id: identifier(input.id, `Checkpoint ${index + 1} id`),
    label: text(input.label, `Checkpoint ${index + 1} label`, 160),
    createdAt: timestamp(input.createdAt, `Checkpoint ${index + 1} createdAt`),
    source,
    spec: validatedSpec(
      input.spec,
      `Checkpoint ${index + 1} spec`,
      verifyArtifact,
    ),
    ...(branchInput
      ? {
          branch: {
            fromCheckpointId: identifier(
              branchInput.fromCheckpointId,
              `Checkpoint ${index + 1} branch origin`,
            ),
            replacedCheckpointCount: Number(
              branchInput.replacedCheckpointCount,
            ),
          },
        }
      : {}),
  };
}

function proposal(
  value: unknown,
  messageIndex: number,
  verifyArtifact: boolean,
): NonNullable<ProjectChatMessage["proposal"]> {
  const input = plainObject(value, `Message ${messageIndex + 1} proposal`);
  if (!Array.isArray(input.summary) || input.summary.length > 8) {
    throw new Error(`Message ${messageIndex + 1} proposal summary is invalid.`);
  }
  return {
    label: text(input.label, `Message ${messageIndex + 1} proposal label`, 160),
    summary: input.summary.map((item, summaryIndex) =>
      text(item, `Message ${messageIndex + 1} proposal summary ${summaryIndex + 1}`, 280),
    ),
    spec: validatedSpec(
      input.spec,
      `Message ${messageIndex + 1} proposal spec`,
      verifyArtifact,
    ),
  };
}

function message(
  value: unknown,
  index: number,
  verifyArtifact: boolean,
): ProjectChatMessage {
  const input = plainObject(value, `Message ${index + 1}`);
  if (input.role !== "user" && input.role !== "assistant") {
    throw new Error(`Message ${index + 1} has an unsupported role.`);
  }
  return {
    id: identifier(input.id, `Message ${index + 1} id`),
    role: input.role,
    content: text(input.content, `Message ${index + 1} content`, 8_000),
    createdAt: timestamp(input.createdAt, `Message ${index + 1} createdAt`),
    ...(input.proposal === undefined
      ? {}
      : { proposal: proposal(input.proposal, index, verifyArtifact) }),
  };
}

function sanitizeMemberProjectDraftValue(
  value: unknown,
  verifyArtifacts: boolean,
): MemberProjectDraft {
  assertProjectPayloadSafe(value, "member project sync payload");
  const input = plainObject(value, "Member project");
  const nonWorkspaceInput = { ...input };
  delete nonWorkspaceInput.workspace;
  const forbidden = findForbiddenField(nonWorkspaceInput);
  if (forbidden) {
    throw new Error(`Member project sync rejected ${forbidden}. Credentials and compiled HTML stay out of cloud project storage.`);
  }
  const unknownFields = Object.keys(input).filter((field) => !projectFields.has(field));
  if (unknownFields.length) {
    throw new Error(`Member project contains unsupported fields: ${unknownFields.join(", ")}.`);
  }
  const checkpointInput = input.checkpoints ?? [];
  const futureCheckpointInput = input.futureCheckpoints ?? [];
  const conversationInput = input.conversation ?? [];
  if (!Array.isArray(checkpointInput) || checkpointInput.length > MEMBER_PROJECT_CHECKPOINT_LIMIT) {
    throw new Error(`Member project supports at most ${MEMBER_PROJECT_CHECKPOINT_LIMIT} checkpoints.`);
  }
  if (
    !Array.isArray(futureCheckpointInput) ||
    futureCheckpointInput.length > MEMBER_PROJECT_CHECKPOINT_LIMIT
  ) {
    throw new Error(
      `Member project supports at most ${MEMBER_PROJECT_CHECKPOINT_LIMIT} future checkpoints.`,
    );
  }
  if (!Array.isArray(conversationInput) || conversationInput.length > MEMBER_PROJECT_CONVERSATION_LIMIT) {
    throw new Error(`Member project supports at most ${MEMBER_PROJECT_CONVERSATION_LIMIT} conversation messages.`);
  }
  const publishedSlug = input.publishedSlug === undefined
    ? undefined
    : text(input.publishedSlug, "Published slug", 72);
  if (publishedSlug && !/^[a-z0-9-]{4,72}$/.test(publishedSlug)) {
    throw new Error("Published slug is invalid.");
  }
  const publishedUrl = optionalUrl(input.publishedUrl, "Published URL");
  const id = identifier(input.id, "Project id");
  const spec = validatedSpec(input.spec, "Project spec", verifyArtifacts);
  const workspace = input.workspace === undefined
    ? undefined
    : validatedWorkspace(input.workspace, spec, verifyArtifacts);
  return {
    id,
    spec,
    checkpoints: checkpointInput.map((item, index) =>
      checkpoint(item, index, verifyArtifacts)),
    futureCheckpoints: futureCheckpointInput.map((item, index) =>
      checkpoint(item, index, verifyArtifacts)),
    conversation: conversationInput.map((item, index) =>
      message(item, index, verifyArtifacts)),
    ...(workspace ? { workspace } : {}),
    ...(publishedUrl ? { publishedUrl } : {}),
    ...(publishedSlug ? { publishedSlug } : {}),
    ...(input.publishedAt === undefined ? {} : {
      publishedAt: timestamp(input.publishedAt, "Published at"),
    }),
  };
}

export function sanitizeMemberProjectDraft(value: unknown): MemberProjectDraft {
  try {
    return sanitizeMemberProjectDraftValue(value, true);
  } catch (error) {
    if (error instanceof MemberProjectValidationError) throw error;
    throw new MemberProjectValidationError(
      error instanceof Error && error.message
        ? error.message
        : "Member project payload is invalid or unsafe.",
    );
  }
}

/**
 * Re-validates the bounded persisted shape without recompiling every spec and
 * workspace on each read or optimistic-storage retry. Only data that already
 * passed sanitizeMemberProjectDraft at ingress may enter durable storage.
 */
export function sanitizeStoredMemberProjectDraft(value: unknown): MemberProjectDraft {
  try {
    return sanitizeMemberProjectDraftValue(value, false);
  } catch (error) {
    if (error instanceof MemberProjectValidationError) throw error;
    throw new MemberProjectValidationError(
      error instanceof Error && error.message
        ? error.message
        : "Stored member project is invalid or unsafe.",
    );
  }
}

export function sanitizeMemberProjectRecord(value: unknown): MemberProjectRecord {
  const input = plainObject(value, "Stored member project") as Partial<MemberProjectRecord>;
  if (
    Object.keys(input).some((field) => !storedRecordFields.has(field))
    || input.schemaVersion !== 1
    || typeof input.id !== "string"
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 1
    || typeof input.createdAt !== "string"
    || !Number.isFinite(Date.parse(input.createdAt))
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
  ) {
    throw new Error("Stored member project metadata is invalid.");
  }
  const draft = sanitizeStoredMemberProjectDraft({
    id: input.id,
    spec: input.spec,
    checkpoints: input.checkpoints,
    futureCheckpoints: input.futureCheckpoints,
    conversation: input.conversation,
    ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
    ...(input.publishedUrl ? { publishedUrl: input.publishedUrl } : {}),
    ...(input.publishedSlug ? { publishedSlug: input.publishedSlug } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
  });
  return {
    schemaVersion: 1,
    ...draft,
    revision: Number(input.revision),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function isMemberProjectRecord(value: unknown): value is MemberProjectRecord {
  try {
    sanitizeMemberProjectRecord(value);
    return true;
  } catch {
    return false;
  }
}
