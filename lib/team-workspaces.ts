import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { MemberProjectDraft } from "./member-project-cloud.ts";

export type TeamRole = "owner" | "editor" | "viewer";
export type TeamAction = "read" | "write" | "manage";

export interface TeamMember {
  identity: string;
  role: TeamRole;
  joinedAt: string;
  consentedAt: string;
}

export interface TeamInvite {
  id: string;
  role: Exclude<TeamRole, "owner">;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export interface TeamWorkspace {
  id: string;
  ownerIdentity: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  members: TeamMember[];
  invites: TeamInvite[];
  projects: TeamSharedProject[];
}

export interface TeamSharedProject {
  projectId: string;
  revision: number;
  draft: MemberProjectDraft;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface TeamInviteCapabilityPayload {
  ownerIdentity: string;
  workspaceId: string;
  inviteId: string;
  role: Exclude<TeamRole, "owner">;
  expiresAt: string;
}

export class TeamWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamWorkspaceValidationError";
  }
}

export class TeamWorkspacePermissionError extends Error {
  constructor(message = "This account does not have permission for the team workspace.") {
    super(message);
    this.name = "TeamWorkspacePermissionError";
  }
}

export function validTeamIdentity(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function validTeamId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

export function validTeamTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function teamWorkspaceName(value: unknown): string {
  if (typeof value !== "string") {
    throw new TeamWorkspaceValidationError("Team workspace name must be text.");
  }
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 80) {
    throw new TeamWorkspaceValidationError("Team workspace name must contain 2 to 80 characters.");
  }
  return name;
}

function validInviteRole(value: unknown): value is "editor" | "viewer" {
  return value === "editor" || value === "viewer";
}

function capabilityPayload(value: unknown): TeamInviteCapabilityPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    input.v !== 1
    || typeof input.ownerIdentity !== "string"
    || !validTeamIdentity(input.ownerIdentity)
    || typeof input.workspaceId !== "string"
    || !validTeamId(input.workspaceId)
    || typeof input.inviteId !== "string"
    || !validTeamId(input.inviteId)
    || !validInviteRole(input.role)
    || typeof input.expiresAt !== "string"
    || !validTeamTimestamp(input.expiresAt)
  ) {
    return null;
  }
  return {
    ownerIdentity: input.ownerIdentity,
    workspaceId: input.workspaceId,
    inviteId: input.inviteId,
    role: input.role,
    expiresAt: input.expiresAt,
  };
}

function validInviteSecret(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= 32;
}

function signCapability(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signaturesMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createTeamInviteCapability(
  input: TeamInviteCapabilityPayload,
  secret: string,
): string {
  if (!validInviteSecret(secret) || !capabilityPayload({ v: 1, ...input })) {
    throw new TeamWorkspaceValidationError("Team invite signing is not configured or the invite is invalid.");
  }
  const payload = Buffer.from(JSON.stringify({ v: 1, ...input }), "utf8").toString("base64url");
  return `${payload}.${signCapability(payload, secret)}`;
}

export function verifyTeamInviteCapability(
  capability: string,
  secret: string,
  now = new Date(),
): TeamInviteCapabilityPayload | null {
  if (!validInviteSecret(secret)) return null;
  const separator = capability.lastIndexOf(".");
  if (separator <= 0 || capability.length > 2_048) return null;
  const encoded = capability.slice(0, separator);
  const signature = capability.slice(separator + 1);
  if (!signaturesMatch(signature, signCapability(encoded, secret))) return null;
  try {
    const parsed = capabilityPayload(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown,
    );
    if (!parsed || Date.parse(parsed.expiresAt) <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashTeamInviteCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

export function resolveTeamInviteSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.DROPS_TEAM_INVITE_SECRET?.trim() ?? "";
  return validInviteSecret(secret) ? secret : "";
}

export function teamPermission(
  workspace: Pick<TeamWorkspace, "members">,
  identity: string,
  action: TeamAction,
): boolean {
  const role = workspace.members.find((member) => member.identity === identity)?.role;
  if (role === "owner") return true;
  if (role === "editor") return action === "read" || action === "write";
  return role === "viewer" && action === "read";
}
