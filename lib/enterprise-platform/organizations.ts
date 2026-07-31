import { enterpriseError } from "./errors.ts";
import type { DefaultRoleId, EnterprisePermission, EnterpriseRuntime } from "./types.ts";
import { DEFAULT_ROLE_IDS, ENTERPRISE_PERMISSIONS } from "./types.ts";
import { assertSafeId, boundedText, clone, iso, normalizeEmail, sha256 } from "./utils.ts";

const allPermissions = [...ENTERPRISE_PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<DefaultRoleId, readonly EnterprisePermission[]>> = Object.freeze({
  owner: allPermissions,
  admin: allPermissions.filter((permission) => permission !== "billing.manage"),
  developer: [
    "project.create", "project.read", "project.edit", "project.delete", "project.publish", "project.export",
    "backend.schema.manage", "backend.data.read", "backend.data.write", "backend.functions.manage", "backend.logs.read",
    "collaboration.comment", "collaboration.edit", "collaboration.merge", "integrations.manage", "github.manage", "deployment.manage",
  ],
  designer: ["project.read", "project.edit", "project.export", "collaboration.comment", "collaboration.edit"],
  analyst: ["project.read", "project.export", "backend.data.read", "backend.logs.read", "collaboration.comment"],
  viewer: ["project.read", "collaboration.comment"],
  billing: ["billing.manage", "project.read"],
  security: ["security.manage", "audit.read", "project.read", "backend.secrets.manage", "backend.logs.read"],
});

export interface OrganizationRecord {
  id: string;
  name: string;
  kind: "personal" | "organization";
  ownerUserId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  id: string;
  organizationId: string;
  name: string;
  personal: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRecord {
  organizationId: string;
  userId: string;
  roleId: string;
  status: "active" | "removed";
  createdAt: string;
  updatedAt: string;
}

export interface CustomRoleRecord {
  id: string;
  organizationId: string;
  name: string;
  permissions: EnterprisePermission[];
  createdAt: string;
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  workspaceId?: string;
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  replacedInvitationId: string | null;
  resendCount: number;
  createdAt: string;
}

export interface ProjectDirectoryRecord {
  id: string;
  workspaceId: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface DirectoryRuntime extends EnterpriseRuntime {
  token(): string;
}

interface DirectorySnapshot {
  organizations: OrganizationRecord[];
  workspaces: WorkspaceRecord[];
  memberships: MembershipRecord[];
  roles: CustomRoleRecord[];
  invitations: InvitationRecord[];
  projects: ProjectDirectoryRecord[];
}

export class EnterpriseDirectory {
  readonly #runtime: DirectoryRuntime;
  readonly #organizations = new Map<string, OrganizationRecord>();
  readonly #workspaces = new Map<string, WorkspaceRecord>();
  readonly #memberships = new Map<string, MembershipRecord>();
  readonly #workspaceMembers = new Map<string, Set<string>>();
  readonly #roles = new Map<string, CustomRoleRecord>();
  readonly #invitations = new Map<string, InvitationRecord>();
  readonly #projects = new Map<string, ProjectDirectoryRecord>();

  constructor(runtime: DirectoryRuntime) {
    this.#runtime = runtime;
  }

  createOrganization(input: { ownerUserId: string; name: string; kind: "personal" | "organization" }): {
    organization: OrganizationRecord;
    workspace: WorkspaceRecord;
  } {
    const ownerUserId = assertSafeId(input.ownerUserId, "Owner user id");
    const now = iso(this.#runtime.now());
    const organization: OrganizationRecord = {
      id: assertSafeId(this.#runtime.id("organization"), "Organization id"),
      name: boundedText(input.name, "Organization name", 120),
      kind: input.kind,
      ownerUserId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const workspace: WorkspaceRecord = {
      id: assertSafeId(this.#runtime.id("workspace"), "Workspace id"),
      organizationId: organization.id,
      name: input.kind === "personal" ? "Personal" : "Default",
      personal: input.kind === "personal",
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#organizations.set(organization.id, organization);
    this.#workspaces.set(workspace.id, workspace);
    this.#memberships.set(this.#membershipKey(organization.id, ownerUserId), {
      organizationId: organization.id,
      userId: ownerUserId,
      roleId: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    this.#workspaceMembers.set(workspace.id, new Set([ownerUserId]));
    return { organization: clone(organization), workspace: clone(workspace) };
  }

  createWorkspace(input: { actorUserId: string; organizationId: string; name: string }): WorkspaceRecord {
    this.#assertPermission(input.actorUserId, input.organizationId, "workspace.manage");
    const organization = this.#organization(input.organizationId);
    if (organization.archivedAt) enterpriseError("INVALID_INPUT", "Archived organization cannot create a workspace.");
    const now = iso(this.#runtime.now());
    const workspace: WorkspaceRecord = {
      id: assertSafeId(this.#runtime.id("workspace"), "Workspace id"),
      organizationId: organization.id,
      name: boundedText(input.name, "Workspace name", 120),
      personal: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#workspaces.set(workspace.id, workspace);
    this.#workspaceMembers.set(workspace.id, new Set([organization.ownerUserId]));
    return clone(workspace);
  }

  renameOrganization(input: { actorUserId: string; organizationId: string; name: string }): OrganizationRecord {
    this.#assertPermission(input.actorUserId, input.organizationId, "organization.manage");
    const organization = this.#organization(input.organizationId);
    organization.name = boundedText(input.name, "Organization name", 120);
    organization.updatedAt = iso(this.#runtime.now());
    return clone(organization);
  }

  archiveOrganization(input: { actorUserId: string; organizationId: string; confirmation: string }): OrganizationRecord {
    this.#assertPermission(input.actorUserId, input.organizationId, "organization.manage");
    if (input.confirmation !== `ARCHIVE ${input.organizationId}`) enterpriseError("CONFIRMATION_REQUIRED", "Explicit organization archive confirmation is required.");
    const organization = this.#organization(input.organizationId);
    organization.archivedAt = iso(this.#runtime.now());
    organization.updatedAt = organization.archivedAt;
    return clone(organization);
  }

  inviteMember(input: {
    actorUserId: string;
    organizationId: string;
    workspaceId?: string;
    email: string;
    roleId: string;
    expiresInMs: number;
  }): { invitation: InvitationRecord; token: string } {
    this.#assertPermission(input.actorUserId, input.organizationId, "members.manage");
    if (input.workspaceId && this.#workspace(input.workspaceId).organizationId !== input.organizationId) {
      enterpriseError("TENANT_MISMATCH", "Invitation workspace belongs to another organization.");
    }
    this.#permissionsForRole(input.organizationId, input.roleId);
    if (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs < 1_000 || input.expiresInMs > 30 * 86_400_000) {
      enterpriseError("INVALID_INPUT", "Invitation expiry is invalid.");
    }
    const token = this.#runtime.token();
    if (token.length < 32) enterpriseError("INVALID_INPUT", "Invitation token entropy is insufficient.");
    const now = this.#runtime.now();
    const invitation: InvitationRecord = {
      id: assertSafeId(this.#runtime.id("invitation"), "Invitation id"),
      organizationId: input.organizationId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      email: normalizeEmail(input.email),
      roleId: input.roleId,
      tokenHash: sha256(token),
      expiresAt: iso(new Date(now.getTime() + input.expiresInMs)),
      revokedAt: null,
      acceptedAt: null,
      acceptedByUserId: null,
      replacedInvitationId: null,
      resendCount: 0,
      createdAt: iso(now),
    };
    this.#invitations.set(invitation.id, invitation);
    return { invitation: clone(invitation), token };
  }

  acceptInvitation(input: { token: string; userId: string; email: string }): {
    organizationId: string;
    workspaceId?: string;
    organizationRoleId: string;
  } {
    const tokenHash = sha256(input.token);
    const invitation = [...this.#invitations.values()].find((entry) => entry.tokenHash === tokenHash);
    if (!invitation) enterpriseError("INVITATION_REVOKED", "Invitation is invalid or has been rotated.");
    if (invitation.acceptedAt) enterpriseError("INVITATION_REPLAY", "Invitation has already been accepted.");
    if (invitation.revokedAt) enterpriseError("INVITATION_REVOKED", "Invitation has been revoked.");
    if (this.#runtime.now().getTime() > Date.parse(invitation.expiresAt)) enterpriseError("INVITATION_EXPIRED", "Invitation has expired.");
    if (normalizeEmail(input.email) !== invitation.email) enterpriseError("INVITATION_EMAIL_MISMATCH", "Invitation email does not match.");
    const userId = assertSafeId(input.userId, "User id");
    const existingMembership = this.#memberships.get(this.#membershipKey(invitation.organizationId, userId));
    if (existingMembership?.status === "active") enterpriseError("INVALID_INPUT", "User is already an active member of this organization.");
    const now = iso(this.#runtime.now());
    invitation.acceptedAt = now;
    invitation.acceptedByUserId = userId;
    this.#memberships.set(this.#membershipKey(invitation.organizationId, userId), {
      organizationId: invitation.organizationId,
      userId,
      roleId: invitation.roleId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    if (invitation.workspaceId) {
      const members = this.#workspaceMembers.get(invitation.workspaceId) ?? new Set<string>();
      members.add(userId);
      this.#workspaceMembers.set(invitation.workspaceId, members);
    }
    return {
      organizationId: invitation.organizationId,
      ...(invitation.workspaceId ? { workspaceId: invitation.workspaceId } : {}),
      organizationRoleId: invitation.roleId,
    };
  }

  resendInvitation(input: { actorUserId: string; invitationId: string; expiresInMs: number }): { invitation: InvitationRecord; token: string } {
    const prior = this.#invitation(input.invitationId);
    this.#assertPermission(input.actorUserId, prior.organizationId, "members.manage");
    if (prior.acceptedAt) enterpriseError("INVITATION_REPLAY", "Accepted invitation cannot be resent.");
    const replacement = this.inviteMember({
      actorUserId: input.actorUserId,
      organizationId: prior.organizationId,
      ...(prior.workspaceId ? { workspaceId: prior.workspaceId } : {}),
      email: prior.email,
      roleId: prior.roleId,
      expiresInMs: input.expiresInMs,
    });
    prior.revokedAt = iso(this.#runtime.now());
    const stored = this.#invitation(replacement.invitation.id);
    stored.replacedInvitationId = prior.id;
    stored.resendCount = prior.resendCount + 1;
    return { invitation: clone(stored), token: replacement.token };
  }

  revokeInvitation(input: { actorUserId: string; invitationId: string }): InvitationRecord {
    const invitation = this.#invitation(input.invitationId);
    this.#assertPermission(input.actorUserId, invitation.organizationId, "members.manage");
    if (invitation.acceptedAt) enterpriseError("INVITATION_REPLAY", "Accepted invitation cannot be revoked.");
    invitation.revokedAt = iso(this.#runtime.now());
    return clone(invitation);
  }

  transferOwnership(input: { actorUserId: string; organizationId: string; nextOwnerUserId: string; confirmation: string }): void {
    const organization = this.#organization(input.organizationId);
    if (organization.ownerUserId !== input.actorUserId) enterpriseError("PERMISSION_DENIED", "Only the current owner can transfer ownership.");
    if (input.confirmation !== `TRANSFER ${input.organizationId}`) enterpriseError("CONFIRMATION_REQUIRED", "Explicit ownership transfer confirmation is required.");
    const next = this.#membership(input.organizationId, input.nextOwnerUserId);
    if (next.status !== "active") enterpriseError("NOT_FOUND", "Next owner must be an active organization member.");
    const current = this.#membership(input.organizationId, input.actorUserId);
    const now = iso(this.#runtime.now());
    current.roleId = "admin";
    current.updatedAt = now;
    next.roleId = "owner";
    next.updatedAt = now;
    organization.ownerUserId = next.userId;
    organization.updatedAt = now;
  }

  removeMember(input: { actorUserId: string; organizationId: string; userId: string }): void {
    this.#assertPermission(input.actorUserId, input.organizationId, "members.manage");
    const organization = this.#organization(input.organizationId);
    if (organization.ownerUserId === input.userId) enterpriseError("CONFIRMATION_REQUIRED", "Transfer ownership before removing the owner.");
    const membership = this.#membership(input.organizationId, input.userId);
    membership.status = "removed";
    membership.updatedAt = iso(this.#runtime.now());
    for (const workspace of this.#workspaces.values()) {
      if (workspace.organizationId === input.organizationId) this.#workspaceMembers.get(workspace.id)?.delete(input.userId);
    }
  }

  createCustomRole(input: {
    actorUserId: string;
    organizationId: string;
    name: string;
    permissions: EnterprisePermission[];
  }): CustomRoleRecord {
    this.#assertPermission(input.actorUserId, input.organizationId, "security.manage");
    const actorPermissions = new Set(this.#effectivePermissions(input.actorUserId, input.organizationId));
    const permissions = [...new Set(input.permissions)].sort();
    if (!permissions.length || permissions.some((permission) => !ENTERPRISE_PERMISSIONS.includes(permission))) {
      enterpriseError("INVALID_INPUT", "Custom role permissions are invalid.");
    }
    if (permissions.some((permission) => !actorPermissions.has(permission))) {
      enterpriseError("PERMISSION_DENIED", "Custom role cannot grant a permission the creator lacks.");
    }
    const role: CustomRoleRecord = {
      id: assertSafeId(this.#runtime.id("role"), "Role id"),
      organizationId: input.organizationId,
      name: boundedText(input.name, "Role name", 80),
      permissions,
      createdAt: iso(this.#runtime.now()),
    };
    this.#roles.set(role.id, role);
    return clone(role);
  }

  createProject(input: { actorUserId: string; workspaceId: string; name: string }): ProjectDirectoryRecord {
    const workspace = this.#workspace(input.workspaceId);
    this.#assertWorkspaceAccess(input.actorUserId, workspace);
    this.#assertPermission(input.actorUserId, workspace.organizationId, "project.create");
    const now = iso(this.#runtime.now());
    const project: ProjectDirectoryRecord = {
      id: assertSafeId(this.#runtime.id("project"), "Project id"),
      workspaceId: workspace.id,
      organizationId: workspace.organizationId,
      name: boundedText(input.name, "Project name", 120),
      createdAt: now,
      updatedAt: now,
    };
    this.#projects.set(project.id, project);
    return clone(project);
  }

  transferProject(input: { actorUserId: string; projectId: string; targetWorkspaceId: string }): ProjectDirectoryRecord {
    const project = this.#project(input.projectId);
    const source = this.#workspace(project.workspaceId);
    const target = this.#workspace(input.targetWorkspaceId);
    this.#assertWorkspaceAccess(input.actorUserId, source);
    this.#assertWorkspaceAccess(input.actorUserId, target);
    this.#assertPermission(input.actorUserId, source.organizationId, "project.edit");
    this.#assertPermission(input.actorUserId, target.organizationId, "project.create");
    if (source.organizationId !== target.organizationId) {
      this.#assertPermission(input.actorUserId, source.organizationId, "organization.manage");
      this.#assertPermission(input.actorUserId, target.organizationId, "organization.manage");
    }
    project.workspaceId = target.id;
    project.organizationId = target.organizationId;
    project.updatedAt = iso(this.#runtime.now());
    return clone(project);
  }

  can(userId: string, organizationId: string, permission: EnterprisePermission): boolean {
    try {
      return this.#effectivePermissions(userId, organizationId).includes(permission);
    } catch {
      return false;
    }
  }

  membership(organizationId: string, userId: string): MembershipRecord {
    return clone(this.#membership(organizationId, userId));
  }

  project(projectId: string): ProjectDirectoryRecord {
    return clone(this.#project(projectId));
  }

  snapshot(): DirectorySnapshot {
    return clone({
      organizations: [...this.#organizations.values()],
      workspaces: [...this.#workspaces.values()],
      memberships: [...this.#memberships.values()],
      roles: [...this.#roles.values()],
      invitations: [...this.#invitations.values()],
      projects: [...this.#projects.values()],
    });
  }

  #effectivePermissions(userId: string, organizationId: string): EnterprisePermission[] {
    const organization = this.#organization(organizationId);
    if (organization.archivedAt) return [];
    const membership = this.#membership(organizationId, userId);
    if (membership.status !== "active") return [];
    return this.#permissionsForRole(organizationId, membership.roleId);
  }

  #permissionsForRole(organizationId: string, roleId: string): EnterprisePermission[] {
    if ((DEFAULT_ROLE_IDS as readonly string[]).includes(roleId)) {
      return [...DEFAULT_ROLE_PERMISSIONS[roleId as DefaultRoleId]];
    }
    const role = this.#roles.get(roleId);
    if (!role || role.organizationId !== organizationId) enterpriseError("NOT_FOUND", "Role was not found in this organization.");
    return [...role.permissions];
  }

  #assertPermission(userId: string, organizationId: string, permission: EnterprisePermission): void {
    if (!this.can(userId, organizationId, permission)) enterpriseError("PERMISSION_DENIED", `Permission ${permission} is required.`);
  }

  #assertWorkspaceAccess(userId: string, workspace: WorkspaceRecord): void {
    const membership = this.#membership(workspace.organizationId, userId);
    if (membership.status !== "active") enterpriseError("PERMISSION_DENIED", "Active organization membership is required.");
    const explicit = this.#workspaceMembers.get(workspace.id);
    if (explicit && !explicit.has(userId) && membership.roleId !== "owner" && membership.roleId !== "admin") {
      enterpriseError("PERMISSION_DENIED", "Workspace membership is required.");
    }
  }

  #membershipKey(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  #membership(organizationId: string, userId: string): MembershipRecord {
    const membership = this.#memberships.get(this.#membershipKey(organizationId, userId));
    if (!membership) enterpriseError("PERMISSION_DENIED", "Organization membership was not found.");
    return membership;
  }

  #organization(id: string): OrganizationRecord {
    const organization = this.#organizations.get(id);
    if (!organization) enterpriseError("NOT_FOUND", "Organization was not found.");
    return organization;
  }

  #workspace(id: string): WorkspaceRecord {
    const workspace = this.#workspaces.get(id);
    if (!workspace) enterpriseError("NOT_FOUND", "Workspace was not found.");
    return workspace;
  }

  #project(id: string): ProjectDirectoryRecord {
    const project = this.#projects.get(id);
    if (!project) enterpriseError("NOT_FOUND", "Project was not found.");
    return project;
  }

  #invitation(id: string): InvitationRecord {
    const invitation = this.#invitations.get(id);
    if (!invitation) enterpriseError("NOT_FOUND", "Invitation was not found.");
    return invitation;
  }
}
