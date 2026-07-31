import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_ROLE_PERMISSIONS,
  EnterpriseDirectory,
  EnterprisePlatformError,
} = await import("../lib/enterprise-platform/index.ts");

function runtime(at = "2026-07-30T12:00:00.000Z") {
  let sequence = 0;
  let current = new Date(at);
  return {
    now: () => new Date(current),
    id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
    token: () => `invite_${String(++sequence).padStart(4, "0")}_${"x".repeat(32)}`,
    advance: (milliseconds) => { current = new Date(current.getTime() + milliseconds); },
  };
}

function hasCode(code) {
  return (error) => error instanceof EnterprisePlatformError && error.code === code;
}

test("default roles are bounded and viewers cannot mutate projects", () => {
  assert.ok(DEFAULT_ROLE_PERMISSIONS.owner.includes("organization.manage"));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.developer.includes("project.edit"));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.security.includes("audit.read"));
  assert.equal(DEFAULT_ROLE_PERMISSIONS.viewer.includes("project.edit"), false);
  assert.equal(DEFAULT_ROLE_PERMISSIONS.billing.includes("security.manage"), false);
});

test("organizations, workspaces, invitations and ownership remain tenant safe", () => {
  const clock = runtime();
  const directory = new EnterpriseDirectory(clock);
  const created = directory.createOrganization({
    ownerUserId: "user-owner",
    name: "Alpha Research",
    kind: "organization",
  });
  const secondWorkspace = directory.createWorkspace({
    actorUserId: "user-owner",
    organizationId: created.organization.id,
    name: "Trading Lab",
  });
  const invited = directory.inviteMember({
    actorUserId: "user-owner",
    organizationId: created.organization.id,
    workspaceId: secondWorkspace.id,
    email: "Dev@Example.com",
    roleId: "developer",
    expiresInMs: 60_000,
  });
  assert.match(invited.token, /^invite_/);
  assert.equal(JSON.stringify(directory.snapshot()).includes(invited.token), false);

  const accepted = directory.acceptInvitation({
    token: invited.token,
    userId: "user-dev",
    email: "dev@example.com",
  });
  assert.equal(accepted.organizationRoleId, "developer");
  assert.equal(directory.can("user-dev", created.organization.id, "project.edit"), true);
  assert.equal(directory.can("user-dev", created.organization.id, "billing.manage"), false);
  assert.equal(directory.createProject({ actorUserId: "user-dev", workspaceId: secondWorkspace.id, name: "Scoped project" }).workspaceId, secondWorkspace.id);
  assert.throws(() => directory.createProject({ actorUserId: "user-dev", workspaceId: created.workspace.id, name: "Unscoped project" }), hasCode("PERMISSION_DENIED"));
  assert.throws(() => directory.acceptInvitation({
    token: invited.token,
    userId: "user-dev-2",
    email: "dev@example.com",
  }), hasCode("INVITATION_REPLAY"));

  const other = directory.createOrganization({
    ownerUserId: "other-owner",
    name: "Other Tenant",
    kind: "organization",
  });
  assert.equal(directory.can("user-dev", other.organization.id, "project.read"), false);
  assert.throws(() => directory.createWorkspace({
    actorUserId: "user-dev",
    organizationId: other.organization.id,
    name: "Cross tenant",
  }), hasCode("PERMISSION_DENIED"));

  assert.throws(() => directory.transferOwnership({
    actorUserId: "user-owner",
    organizationId: created.organization.id,
    nextOwnerUserId: "user-dev",
    confirmation: "wrong",
  }), hasCode("CONFIRMATION_REQUIRED"));
  directory.transferOwnership({
    actorUserId: "user-owner",
    organizationId: created.organization.id,
    nextOwnerUserId: "user-dev",
    confirmation: `TRANSFER ${created.organization.id}`,
  });
  assert.equal(directory.membership(created.organization.id, "user-dev").roleId, "owner");
  assert.equal(directory.membership(created.organization.id, "user-owner").roleId, "admin");
});

test("expired and revoked invitations cannot be replayed and resend rotates the token", () => {
  const clock = runtime();
  const directory = new EnterpriseDirectory(clock);
  const { organization } = directory.createOrganization({ ownerUserId: "owner", name: "Alpha", kind: "organization" });
  const expired = directory.inviteMember({
    actorUserId: "owner", organizationId: organization.id, email: "old@example.com", roleId: "viewer", expiresInMs: 1_000,
  });
  clock.advance(1_001);
  assert.throws(() => directory.acceptInvitation({ token: expired.token, userId: "old", email: "old@example.com" }), hasCode("INVITATION_EXPIRED"));

  const pending = directory.inviteMember({
    actorUserId: "owner", organizationId: organization.id, email: "new@example.com", roleId: "viewer", expiresInMs: 10_000,
  });
  const resent = directory.resendInvitation({ actorUserId: "owner", invitationId: pending.invitation.id, expiresInMs: 20_000 });
  assert.notEqual(resent.token, pending.token);
  assert.throws(() => directory.acceptInvitation({ token: pending.token, userId: "new", email: "new@example.com" }), hasCode("INVITATION_REVOKED"));
  directory.revokeInvitation({ actorUserId: "owner", invitationId: resent.invitation.id });
  assert.throws(() => directory.acceptInvitation({ token: resent.token, userId: "new", email: "new@example.com" }), hasCode("INVITATION_REVOKED"));
});

test("failed invitation resend keeps the original invitation usable", () => {
  const clock = runtime();
  const directory = new EnterpriseDirectory(clock);
  const { organization } = directory.createOrganization({ ownerUserId: "owner", name: "Alpha", kind: "organization" });
  const pending = directory.inviteMember({
    actorUserId: "owner", organizationId: organization.id, email: "safe@example.com", roleId: "viewer", expiresInMs: 10_000,
  });
  clock.token = () => "too-short";
  assert.throws(() => directory.resendInvitation({ actorUserId: "owner", invitationId: pending.invitation.id, expiresInMs: 20_000 }), hasCode("INVALID_INPUT"));
  assert.equal(directory.acceptInvitation({ token: pending.token, userId: "safe-user", email: "safe@example.com" }).organizationRoleId, "viewer");
});

test("an active member cannot consume a second invitation", () => {
  const clock = runtime();
  const directory = new EnterpriseDirectory(clock);
  const { organization } = directory.createOrganization({ ownerUserId: "owner", name: "Alpha", kind: "organization" });
  const first = directory.inviteMember({
    actorUserId: "owner", organizationId: organization.id, email: "member@example.com", roleId: "viewer", expiresInMs: 10_000,
  });
  directory.acceptInvitation({ token: first.token, userId: "member", email: "member@example.com" });
  const second = directory.inviteMember({
    actorUserId: "owner", organizationId: organization.id, email: "member+second@example.com", roleId: "developer", expiresInMs: 10_000,
  });
  assert.throws(() => directory.acceptInvitation({ token: second.token, userId: "member", email: "member+second@example.com" }), hasCode("INVALID_INPUT"));
  const storedSecond = directory.snapshot().invitations.find((invitation) => invitation.id === second.invitation.id);
  assert.equal(storedSecond.acceptedAt, null);
  assert.equal(directory.membership(organization.id, "member").roleId, "viewer");
});

test("custom roles cannot grant permissions the creator lacks and project transfer checks both workspaces", () => {
  const clock = runtime();
  const directory = new EnterpriseDirectory(clock);
  const { organization, workspace } = directory.createOrganization({ ownerUserId: "owner", name: "Alpha", kind: "organization" });
  const target = directory.createWorkspace({ actorUserId: "owner", organizationId: organization.id, name: "Target" });
  const project = directory.createProject({ actorUserId: "owner", workspaceId: workspace.id, name: "Whale Lab" });
  directory.transferProject({ actorUserId: "owner", projectId: project.id, targetWorkspaceId: target.id });
  assert.equal(directory.project(project.id).workspaceId, target.id);

  const custom = directory.createCustomRole({
    actorUserId: "owner",
    organizationId: organization.id,
    name: "Reviewer",
    permissions: ["project.read", "collaboration.comment"],
  });
  assert.deepEqual(custom.permissions, ["collaboration.comment", "project.read"]);
  const reviewerInvitation = directory.inviteMember({
    actorUserId: "owner",
    organizationId: organization.id,
    email: "reviewer@example.com",
    roleId: "developer",
    expiresInMs: 60_000,
  });
  directory.acceptInvitation({ token: reviewerInvitation.token, userId: "reviewer", email: "reviewer@example.com" });
  assert.throws(() => directory.createCustomRole({
    actorUserId: "reviewer",
    organizationId: organization.id,
    name: "Escalated",
    permissions: ["organization.manage"],
  }), hasCode("PERMISSION_DENIED"));
});
