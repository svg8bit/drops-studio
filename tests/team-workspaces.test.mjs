import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const teamModule = await import("../lib/team-workspaces.ts").catch(() => null);
const teamApiModule = await import("../lib/team-api.ts").catch(() => null);
const teamStoreModule = await import("../db/team-workspaces.ts").catch(() => null);
const teamsRouteModule = await import("../app/api/teams/route.ts").catch(
  () => null,
);
const teamRouteModule = await import(
  "../app/api/teams/[workspaceId]/route.ts"
).catch(() => null);
const inviteRouteModule = await import(
  "../app/api/teams/[workspaceId]/invites/route.ts"
).catch(() => null);
const acceptInviteRouteModule = await import(
  "../app/api/teams/invites/accept/route.ts"
).catch(() => null);
const memberRouteModule = await import(
  "../app/api/teams/[workspaceId]/members/route.ts"
).catch(() => null);
const teamProjectRouteModule = await import(
  "../app/api/teams/[workspaceId]/projects/route.ts"
).catch(() => null);
const { createProjectSpec } = await import("../lib/project-factory.ts");
const { compileProject } = await import("../lib/project-compiler.ts");
const {
  addWorkspaceFile,
  materializeProjectWorkspace,
  updateWorkspaceFile,
} = await import("../lib/project-workspace.ts");

const ownerIdentity = "1".repeat(64);
const editorIdentity = "2".repeat(64);
const viewerIdentity = "3".repeat(64);
const inviteSecret = "team-invite-test-secret-with-more-than-32-bytes";
const accountSecret = "team-account-cookie-test-secret-with-more-than-32-bytes";
const now = new Date("2026-07-30T12:00:00.000Z");

function modules() {
  assert.ok(teamModule, "team workspace module must exist");
  assert.ok(teamStoreModule, "team workspace store must exist");
  return { ...teamModule, ...teamStoreModule };
}

test("team JSON boundary rejects JSON-like media types exactly", async () => {
  assert.ok(teamApiModule, "team API boundary module must exist");
  await assert.rejects(
    () => teamApiModule.teamRequestBody(
      new NextRequest("https://drops.example/api/teams", {
        method: "POST",
        headers: { "content-type": "application/jsonp" },
        body: "{}",
      }),
    ),
    (error) => error.status === 415,
  );
  assert.deepEqual(
    await teamApiModule.teamRequestBody(
      new NextRequest("https://drops.example/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: '{"consent":true}',
      }),
    ),
    { consent: true },
  );
});

function withEnv(values, run) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

function fakeBlobStorage() {
  const entries = new Map();
  const writes = [];
  let revision = 0;
  return {
    entries,
    writes,
    async get(pathname) {
      const entry = entries.get(pathname);
      if (!entry) return null;
      return {
        statusCode: 200,
        blob: { etag: entry.etag },
        stream: new Blob([entry.body]).stream(),
      };
    },
    async put(pathname, body, options) {
      const current = entries.get(pathname);
      if (options.ifMatch && current?.etag !== options.ifMatch) {
        throw new Error("precondition");
      }
      revision += 1;
      const entry = { body: String(body), etag: `etag-${revision}` };
      entries.set(pathname, entry);
      writes.push({ pathname, body: entry.body, options });
      return { etag: entry.etag };
    },
  };
}

function sharedProjectDraft(id = "shared-project-1", name = "Shared Alpha") {
  const projectSpec = createProjectSpec({
    presetId: "morning-alpha",
    values: {},
    prompt: name,
    tools: ["DropsTab API", "Drops Bot"],
    provider: "free",
    model: "Free compiler",
    market: [],
    prediction: {
      title: "Waiting for verified market evidence",
      probability: null,
      change: null,
    },
    origin: "https://drops-studio.vercel.app",
  });
  const generated = {
    id,
    spec: projectSpec,
    html: compileProject(projectSpec),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return {
    id,
    spec: projectSpec,
    checkpoints: [],
    futureCheckpoints: [],
    conversation: [],
    workspace: materializeProjectWorkspace(generated),
  };
}

test("team invite capabilities are HMAC-bound, expiring and tamper evident", () => {
  const {
    createTeamInviteCapability,
    hashTeamInviteCapability,
    verifyTeamInviteCapability,
  } = modules();
  const payload = {
    ownerIdentity,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    inviteId: "22222222-2222-4222-8222-222222222222",
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
  };
  const capability = createTeamInviteCapability(payload, inviteSecret);

  assert.match(capability, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  assert.deepEqual(
    verifyTeamInviteCapability(capability, inviteSecret, now),
    payload,
  );
  assert.equal(
    verifyTeamInviteCapability(`${capability}x`, inviteSecret, now),
    null,
  );
  assert.equal(
    verifyTeamInviteCapability(
      capability,
      inviteSecret,
      new Date("2026-08-01T12:00:00.000Z"),
    ),
    null,
  );
  assert.match(hashTeamInviteCapability(capability), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(hashTeamInviteCapability(capability), new RegExp(capability));
});

test("owner-scoped team storage accepts one consented invite and enforces revisions and roles", async () => {
  const {
    acceptTeamWorkspaceInvite,
    changeTeamMemberRole,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    listTeamWorkspacesForMember,
    readTeamWorkspace,
    teamPermission,
    updateTeamWorkspace,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 0;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };

  await assert.rejects(
    createTeamWorkspace(
      { ownerIdentity, name: "Alpha Desk", consent: false, maxWorkspaces: 10 },
      runtime,
    ),
    /consent/i,
  );
  assert.equal(storage.writes.length, 0);

  const created = await createTeamWorkspace(
    { ownerIdentity, name: "Alpha Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  assert.equal(created.revision, 1);
  assert.deepEqual(created.members, [{
    identity: ownerIdentity,
    role: "owner",
    joinedAt: now.toISOString(),
    consentedAt: now.toISOString(),
  }]);

  const invitation = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: created.id,
    expectedRevision: 1,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  assert.equal(invitation.status, "created");
  assert.equal(invitation.workspace.revision, 2);
  assert.equal("capabilityHash" in invitation.invite, false);

  const accepted = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.workspace.revision, 3);
  assert.equal(
    accepted.workspace.members.find((member) => member.identity === editorIdentity)?.role,
    "editor",
  );
  const joinedAfterReload = await listTeamWorkspacesForMember(
    editorIdentity,
    runtime,
  );
  assert.equal(joinedAfterReload.length, 1);
  assert.equal(joinedAfterReload[0].ownerIdentity, ownerIdentity);
  assert.equal(joinedAfterReload[0].id, created.id);

  const stale = await updateTeamWorkspace({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: created.id,
    expectedRevision: 2,
    name: "Stale edit",
    consent: true,
  }, runtime);
  assert.equal(stale.status, "conflict");
  assert.equal(stale.current.revision, 3);

  const edited = await updateTeamWorkspace({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: created.id,
    expectedRevision: 3,
    name: "Shared Alpha Desk",
    consent: true,
  }, runtime);
  assert.equal(edited.status, "saved");
  assert.equal(edited.workspace.revision, 4);

  const roleChanged = await changeTeamMemberRole({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: created.id,
    memberIdentity: editorIdentity,
    role: "viewer",
    expectedRevision: 4,
    consent: true,
  }, runtime);
  assert.equal(roleChanged.status, "saved");
  assert.equal(roleChanged.workspace.revision, 5);
  assert.equal(teamPermission(roleChanged.workspace, ownerIdentity, "manage"), true);
  assert.equal(teamPermission(roleChanged.workspace, editorIdentity, "read"), true);
  assert.equal(teamPermission(roleChanged.workspace, editorIdentity, "write"), false);
  assert.equal(teamPermission(roleChanged.workspace, viewerIdentity, "read"), false);

  const forbidden = await updateTeamWorkspace({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: created.id,
    expectedRevision: 5,
    name: "Viewer overwrite",
    consent: true,
  }, runtime);
  assert.equal(forbidden.status, "forbidden");

  const visible = await readTeamWorkspace(
    ownerIdentity,
    created.id,
    editorIdentity,
    runtime,
  );
  assert.equal(visible.name, "Shared Alpha Desk");
  assert.equal("capabilityHash" in visible.invites[0], false);
  assert.equal("capability" in visible.invites[0], false);

  assert.deepEqual(new Set(storage.writes.map((write) => write.pathname)), new Set([
    `drops-studio/team-workspaces/${ownerIdentity}.json`,
    `drops-studio/team-workspaces/${editorIdentity}.json`,
  ]));
  const persisted = storage.entries.get(
    `drops-studio/team-workspaces/${ownerIdentity}.json`,
  ).body;
  assert.doesNotMatch(persisted, new RegExp(invitation.capability.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(persisted, /capabilityHash/);
  const memberIndex = storage.entries.get(
    `drops-studio/team-workspaces/${editorIdentity}.json`,
  ).body;
  assert.doesNotMatch(memberIndex, /Shared Alpha Desk|capabilityHash|projects/);
});

test("one-time invite acceptance records explicit member consent", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 10;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Consent Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const invitation = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "viewer",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);

  await assert.rejects(
    acceptTeamWorkspaceInvite({
      capability: invitation.capability,
      memberIdentity: viewerIdentity,
      consent: false,
      secret: inviteSecret,
    }, runtime),
    /consent/i,
  );
  const first = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: viewerIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  const replay = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: viewerIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  const hijack = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  assert.equal(first.status, "accepted");
  assert.equal(replay.status, "already-accepted");
  assert.equal(hijack.status, "not-found");
  assert.equal(
    first.workspace.members.find((member) => member.identity === viewerIdentity)?.consentedAt,
    now.toISOString(),
  );
});

test("an accepted invite replay repairs a missing member membership pointer", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    listTeamWorkspacesForMember,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 20;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Repair Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const invitation = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);

  const memberPath = `drops-studio/team-workspaces/${editorIdentity}.json`;
  const stored = storage.entries.get(memberPath);
  const missingPointer = JSON.parse(stored.body);
  missingPointer.memberships = [];
  missingPointer.revision += 1;
  storage.entries.set(memberPath, {
    body: JSON.stringify(missingPointer),
    etag: `${stored.etag}-without-pointer`,
  });

  const replay = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  const visible = await listTeamWorkspacesForMember(editorIdentity, runtime);
  assert.equal(replay.status, "already-accepted");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, workspace.id);
});

test("accepted invite receipts do not consume the pending cap and stay replayable", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    listTeamWorkspacesForMember,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 200;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Receipt Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const acceptedInvite = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  await acceptTeamWorkspaceInvite({
    capability: acceptedInvite.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);

  const ownerPath = `drops-studio/team-workspaces/${ownerIdentity}.json`;
  const ownerEntry = storage.entries.get(ownerPath);
  const ownerEnvelope = JSON.parse(ownerEntry.body);
  const receipt = ownerEnvelope.workspaces[0].invites[0];
  for (let index = 0; index < 99; index += 1) {
    ownerEnvelope.workspaces[0].invites.push({
      ...receipt,
      id: `${String(1_000 + index).padStart(8, "0")}-0000-4000-8000-000000000000`,
      capabilityHash: (index + 1).toString(16).padStart(64, "0"),
    });
  }
  storage.entries.set(ownerPath, {
    body: JSON.stringify(ownerEnvelope),
    etag: `${ownerEntry.etag}-accepted-receipts`,
  });

  const memberPath = `drops-studio/team-workspaces/${editorIdentity}.json`;
  const memberEntry = storage.entries.get(memberPath);
  const memberEnvelope = JSON.parse(memberEntry.body);
  memberEnvelope.memberships = [];
  memberEnvelope.revision += 1;
  storage.entries.set(memberPath, {
    body: JSON.stringify(memberEnvelope),
    etag: `${memberEntry.etag}-without-pointer`,
  });

  const nextInvite = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 3,
    role: "viewer",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  assert.equal(nextInvite.status, "created");
  assert.equal(nextInvite.workspace.invites.filter((invite) => invite.acceptedAt === null).length, 1);
  assert.equal(nextInvite.workspace.invites.filter((invite) => invite.acceptedAt !== null).length, 100);

  const replay = await acceptTeamWorkspaceInvite({
    capability: acceptedInvite.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  assert.equal(replay.status, "already-accepted");
  assert.equal((await listTeamWorkspacesForMember(editorIdentity, runtime)).length, 1);
});

test("expired pending invites are pruned before enforcing the pending invite cap", async () => {
  const {
    createTeamWorkspace,
    createTeamWorkspaceInvite,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 400;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Expiry Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "viewer",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);

  const ownerPath = `drops-studio/team-workspaces/${ownerIdentity}.json`;
  const ownerEntry = storage.entries.get(ownerPath);
  const ownerEnvelope = JSON.parse(ownerEntry.body);
  const pending = ownerEnvelope.workspaces[0].invites[0];
  ownerEnvelope.workspaces[0].invites = Array.from({ length: 100 }, (_, index) => ({
    ...pending,
    id: `${String(2_000 + index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    expiresAt: "2026-07-29T12:00:00.000Z",
    capabilityHash: (index + 1).toString(16).padStart(64, "0"),
  }));
  storage.entries.set(ownerPath, {
    body: JSON.stringify(ownerEnvelope),
    etag: `${ownerEntry.etag}-expired-pending`,
  });

  const nextInvite = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 2,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  assert.equal(nextInvite.status, "created");
  assert.equal(nextInvite.workspace.invites.length, 1);
  assert.equal(nextInvite.workspace.invites[0].acceptedAt, null);
  assert.ok(Date.parse(nextInvite.workspace.invites[0].expiresAt) > now.getTime());
});

test("member workspace listing deduplicates owner reads and uses bounded parallel batches", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    listTeamWorkspacesForMember,
  } = modules();
  const storage = fakeBlobStorage();
  const memberIdentity = "6".repeat(64);
  const owners = ["4".repeat(64), "5".repeat(64)];
  let uuid = 30;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };

  for (const [ownerIndex, workspaceCount] of [2, 1].entries()) {
    const currentOwner = owners[ownerIndex];
    for (let index = 0; index < workspaceCount; index += 1) {
      const workspace = await createTeamWorkspace({
        ownerIdentity: currentOwner,
        name: `Parallel Desk ${ownerIndex + 1}-${index + 1}`,
        consent: true,
        maxWorkspaces: 10,
      }, runtime);
      const invitation = await createTeamWorkspaceInvite({
        actorIdentity: currentOwner,
        ownerIdentity: currentOwner,
        workspaceId: workspace.id,
        expectedRevision: 1,
        role: "viewer",
        expiresAt: "2026-07-31T12:00:00.000Z",
        consent: true,
        secret: inviteSecret,
        maxCollaborators: 25,
      }, runtime);
      await acceptTeamWorkspaceInvite({
        capability: invitation.capability,
        memberIdentity,
        consent: true,
        secret: inviteSecret,
      }, runtime);
    }
  }

  const originalGet = storage.get.bind(storage);
  const reads = new Map();
  let activeOwnerReads = 0;
  let maxActiveOwnerReads = 0;
  storage.get = async (pathname) => {
    const ownerRead = owners.some((identity) => pathname.endsWith(`${identity}.json`));
    if (ownerRead) {
      reads.set(pathname, (reads.get(pathname) ?? 0) + 1);
      activeOwnerReads += 1;
      maxActiveOwnerReads = Math.max(maxActiveOwnerReads, activeOwnerReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    try {
      return await originalGet(pathname);
    } finally {
      if (ownerRead) activeOwnerReads -= 1;
    }
  };

  const visible = await listTeamWorkspacesForMember(memberIdentity, runtime);
  assert.equal(visible.length, 3);
  for (const identity of owners) {
    assert.equal(
      reads.get(`drops-studio/team-workspaces/${identity}.json`),
      1,
      "each owner envelope must be fetched once even with multiple pointers",
    );
  }
  assert.ok(maxActiveOwnerReads > 1, "independent owner envelopes should load concurrently");
  assert.ok(maxActiveOwnerReads <= 4, "owner envelope reads must remain bounded");
});

test("unauthorized team mutations never disclose current revisions or project state", async () => {
  const {
    changeTeamMemberRole,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    updateTeamWorkspace,
    upsertTeamWorkspaceProject,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 25;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Private Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );

  const rename = await updateTeamWorkspace({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 999,
    name: "Unauthorized rename",
    consent: true,
  }, runtime);
  const invite = await createTeamWorkspaceInvite({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 999,
    role: "viewer",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  const role = await changeTeamMemberRole({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    memberIdentity: editorIdentity,
    role: "viewer",
    expectedRevision: 999,
    consent: true,
  }, runtime);
  const project = await upsertTeamWorkspaceProject({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 999,
    expectedProjectRevision: 999,
    project: sharedProjectDraft("secret-project", "Must stay private"),
    consent: true,
  }, runtime);
  const unsafeProject = await upsertTeamWorkspaceProject({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 1,
    expectedProjectRevision: 0,
    project: {
      html: "<html>unauthorized payload must not reach source validation</html>",
      providerKey: "unauthorized-key",
    },
    consent: true,
  }, runtime);

  assert.deepEqual(rename, { status: "forbidden" });
  assert.deepEqual(invite, { status: "forbidden" });
  assert.deepEqual(role, { status: "forbidden" });
  assert.deepEqual(project, { status: "forbidden" });
  assert.deepEqual(unsafeProject, { status: "forbidden" });
});

test("editors persist a validated shared project draft with independent optimistic revision", async () => {
  const {
    acceptTeamWorkspaceInvite,
    changeTeamMemberRole,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    readTeamWorkspace,
    upsertTeamWorkspaceProject,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 30;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Project Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  assert.deepEqual(workspace.projects, []);
  const invitation = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);

  const createdProject = await upsertTeamWorkspaceProject({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 3,
    expectedProjectRevision: 0,
    project: sharedProjectDraft(),
    consent: true,
  }, runtime);
  assert.equal(createdProject.status, "saved");
  assert.equal(createdProject.workspace.revision, 4);
  assert.equal(createdProject.project.revision, 1);
  assert.equal(createdProject.project.updatedBy, editorIdentity);

  const stale = await upsertTeamWorkspaceProject({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 4,
    expectedProjectRevision: 0,
    project: sharedProjectDraft("shared-project-1", "Stale Alpha"),
    consent: true,
  }, runtime);
  assert.equal(stale.status, "conflict");
  assert.equal(stale.currentProject.revision, 1);

  const invalid = structuredClone(sharedProjectDraft("shared-project-2"));
  invalid.html = "<html>must never enter team storage</html>";
  await assert.rejects(
    upsertTeamWorkspaceProject({
      actorIdentity: editorIdentity,
      ownerIdentity,
      workspaceId: workspace.id,
      expectedWorkspaceRevision: 4,
      expectedProjectRevision: 0,
      project: invalid,
      consent: true,
    }, runtime),
    /compiled html|executable artifact/i,
  );

  await changeTeamMemberRole({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    memberIdentity: editorIdentity,
    role: "viewer",
    expectedRevision: 4,
    consent: true,
  }, runtime);
  const visible = await readTeamWorkspace(
    ownerIdentity,
    workspace.id,
    editorIdentity,
    runtime,
  );
  assert.equal(visible.projects[0].draft.spec.name, "Shared Alpha");
  const forbidden = await upsertTeamWorkspaceProject({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 5,
    expectedProjectRevision: 1,
    project: sharedProjectDraft("shared-project-1", "Viewer overwrite"),
    consent: true,
  }, runtime);
  assert.equal(forbidden.status, "forbidden");
});

test("team source workspace round-trips through owner, editor and read-only viewer revisions", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
    readTeamWorkspace,
    upsertTeamWorkspaceProject,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 60;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Source Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const ownerDraft = sharedProjectDraft("shared-source-1", "Collaborative Source");
  const ownerSave = await upsertTeamWorkspaceProject({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 1,
    expectedProjectRevision: 0,
    project: ownerDraft,
    consent: true,
  }, runtime);
  assert.equal(ownerSave.status, "saved");
  assert.equal(ownerSave.workspace.revision, 2);
  assert.equal(ownerSave.project.revision, 1);

  const editorInvite = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 2,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  await acceptTeamWorkspaceInvite({
    capability: editorInvite.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);

  const editedWorkspace = updateWorkspaceFile(
    ownerDraft.spec,
    ownerDraft.workspace,
    "src/app.js",
    `${ownerDraft.workspace.files.find((item) => item.path === "src/app.js").content}\nwindow.__teamSourceRevision = 2;`,
  );
  const editorSave = await upsertTeamWorkspaceProject({
    actorIdentity: editorIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 4,
    expectedProjectRevision: 1,
    project: { ...ownerDraft, workspace: editedWorkspace },
    consent: true,
  }, runtime);
  assert.equal(editorSave.status, "saved");
  assert.equal(editorSave.workspace.revision, 5);
  assert.equal(editorSave.project.revision, 2);
  assert.equal(editorSave.project.draft.workspace.revision, editedWorkspace.revision);

  const viewerInvite = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 5,
    role: "viewer",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 25,
  }, runtime);
  await acceptTeamWorkspaceInvite({
    capability: viewerInvite.capability,
    memberIdentity: viewerIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);

  for (const identity of [ownerIdentity, editorIdentity, viewerIdentity]) {
    const visible = await readTeamWorkspace(
      ownerIdentity,
      workspace.id,
      identity,
      runtime,
    );
    assert.equal(visible.revision, 7);
    assert.equal(visible.projects[0].revision, 2);
    assert.match(
      visible.projects[0].draft.workspace.files.find((item) => item.path === "src/app.js").content,
      /__teamSourceRevision = 2/,
    );
  }

  assert.deepEqual(await upsertTeamWorkspaceProject({
    actorIdentity: viewerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedWorkspaceRevision: 7,
    expectedProjectRevision: 2,
    project: ownerDraft,
    consent: true,
  }, runtime), { status: "forbidden" });
});

test("team source boundary rejects unsafe, malformed and receipt-bearing workspaces", async () => {
  const {
    createTeamWorkspace,
    upsertTeamWorkspaceProject,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 70;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Boundary Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const base = sharedProjectDraft("shared-boundary-1", "Boundary Source");
  const invalidDrafts = [];

  const unsafePath = structuredClone(base);
  unsafePath.workspace.files.push({
    path: ".env.production",
    content: "PUBLIC_FLAG=true",
    language: "text",
    role: "project-config",
    editable: true,
  });
  invalidDrafts.push(unsafePath);

  const secretSource = structuredClone(base);
  secretSource.workspace.files.find((item) => item.path === "src/app.js").content +=
    '\nconst apiKey = "sk-or-v1-this-is-a-real-looking-secret-value";';
  invalidDrafts.push(secretSource);

  const malformed = structuredClone(base);
  malformed.workspace.files = "not-a-file-graph";
  invalidDrafts.push(malformed);

  const receiptBearing = structuredClone(base);
  receiptBearing.workspace.receipt = { runId: "run-private-123" };
  receiptBearing.workspace.terminalOutput = "npm token should never be shared";
  receiptBearing.workspace.runtime.providerKey = "request-only-key";
  invalidDrafts.push(receiptBearing);

  for (const project of invalidDrafts) {
    await assert.rejects(
      upsertTeamWorkspaceProject({
        actorIdentity: ownerIdentity,
        ownerIdentity,
        workspaceId: workspace.id,
        expectedWorkspaceRevision: 1,
        expectedProjectRevision: 0,
        project,
        consent: true,
      }, runtime),
      /workspace|secret|credential|unsafe|malformed|unsupported/i,
    );
  }
  assert.equal(storage.writes.length, 1, "rejected source never mutates team storage");
  assert.doesNotMatch(storage.writes[0].body, /run-private|terminalOutput|providerKey/);
});

test("collaborator entitlement excludes the owner seat", async () => {
  const {
    acceptTeamWorkspaceInvite,
    createTeamWorkspace,
    createTeamWorkspaceInvite,
  } = modules();
  const storage = fakeBlobStorage();
  let uuid = 90;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const workspace = await createTeamWorkspace(
    { ownerIdentity, name: "Seat Boundary", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const invitation = await createTeamWorkspaceInvite({
    actorIdentity: ownerIdentity,
    ownerIdentity,
    workspaceId: workspace.id,
    expectedRevision: 1,
    role: "editor",
    expiresAt: "2026-07-31T12:00:00.000Z",
    consent: true,
    secret: inviteSecret,
    maxCollaborators: 1,
  }, runtime);
  const accepted = await acceptTeamWorkspaceInvite({
    capability: invitation.capability,
    memberIdentity: editorIdentity,
    consent: true,
    secret: inviteSecret,
  }, runtime);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.workspace.members.length, 2);

  await assert.rejects(
    () => createTeamWorkspaceInvite({
      actorIdentity: ownerIdentity,
      ownerIdentity,
      workspaceId: workspace.id,
      expectedRevision: 3,
      role: "viewer",
      expiresAt: "2026-07-31T12:00:00.000Z",
      consent: true,
      secret: inviteSecret,
      maxCollaborators: 1,
    }, runtime),
    /collaborator entitlement limit reached/i,
  );
});

test("team owner source capacity fails explicitly without mutating the last durable revision", async () => {
  const {
    createTeamWorkspace,
    TEAM_WORKSPACE_OWNER_CAPACITY_BYTES,
    TeamWorkspaceCapacityError,
    upsertTeamWorkspaceProject,
  } = modules();
  assert.equal(TEAM_WORKSPACE_OWNER_CAPACITY_BYTES, 3 * 1024 * 1024);
  const storage = fakeBlobStorage();
  let uuid = 80;
  const runtime = {
    storage,
    now: () => now,
    id: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
  const team = await createTeamWorkspace(
    { ownerIdentity, name: "Capacity Desk", consent: true, maxWorkspaces: 10 },
    runtime,
  );
  const nearLimitDraft = (id, marker) => {
    const draft = sharedProjectDraft(id, `Capacity ${marker}`);
    const used = draft.workspace.files.reduce(
      (total, item) => total + new TextEncoder().encode(item.content).byteLength,
      0,
    );
    draft.workspace = addWorkspaceFile(draft.spec, draft.workspace, {
      path: `docs/capacity-${marker}.md`,
      content: marker.repeat(Math.max(1, 1_400_000 - used)),
      language: "markdown",
      role: "documentation",
    });
    return draft;
  };

  let workspaceRevision = team.revision;
  for (const [index, marker] of ["a", "b"].entries()) {
    const saved = await upsertTeamWorkspaceProject({
      actorIdentity: ownerIdentity,
      ownerIdentity,
      workspaceId: team.id,
      expectedWorkspaceRevision: workspaceRevision,
      expectedProjectRevision: 0,
      project: nearLimitDraft(`capacity-${marker}`, marker),
      consent: true,
    }, runtime);
    assert.equal(saved.status, "saved");
    workspaceRevision = saved.workspace.revision;
    assert.equal(saved.project.revision, 1);
    assert.equal(index + 2, workspaceRevision);
  }
  const durableBefore = storage.entries.get(`drops-studio/team-workspaces/${ownerIdentity}.json`).body;
  await assert.rejects(
    upsertTeamWorkspaceProject({
      actorIdentity: ownerIdentity,
      ownerIdentity,
      workspaceId: team.id,
      expectedWorkspaceRevision: workspaceRevision,
      expectedProjectRevision: 0,
      project: nearLimitDraft("capacity-c", "c"),
      consent: true,
    }, runtime),
    (error) => {
      assert.equal(error instanceof TeamWorkspaceCapacityError, true);
      assert.match(error.message, /3 MB.*per owner.*(?:archive|replace)/i);
      return true;
    },
  );
  assert.equal(
    storage.entries.get(`drops-studio/team-workspaces/${ownerIdentity}.json`).body,
    durableBefore,
  );
});

test("team creation endpoint fails closed without billing and durable storage", async () => {
  assert.ok(teamsRouteModule, "teams route must exist");
  const { createStudioAccountCookie, STUDIO_ACCOUNT_COOKIE } = await import(
    "../lib/access-tier.ts"
  );
  const cookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "team-route-owner" },
    accountSecret,
  );
  await withEnv({
    DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: undefined,
    BLOB_READ_WRITE_TOKEN: undefined,
    BLOB_STORE_ID: undefined,
    VERCEL_OIDC_TOKEN: undefined,
    DROPS_TEAM_INVITE_SECRET: undefined,
  }, async () => {
    const response = await teamsRouteModule.POST(
      new NextRequest("https://drops-studio.vercel.app/api/teams", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
          origin: "https://drops-studio.vercel.app",
        },
        body: JSON.stringify({ name: "Unavailable Team", consent: true }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /not configured|unavailable/i);
    assert.doesNotMatch(JSON.stringify(body), /secret|token|STRIPE_/i);
  });
});

test("invite acceptance rechecks the owner's current Pro entitlement before mutation", async () => {
  assert.ok(teamsRouteModule, "teams route must exist");
  assert.ok(inviteRouteModule, "team invite route must exist");
  assert.ok(acceptInviteRouteModule, "team invite acceptance route must exist");
  const {
    readTeamWorkspace,
    resetLocalTeamWorkspaceStateForTests,
  } = modules();
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = await import("../db/billing.ts");
  const {
    createStudioAccountCookie,
    readStudioAccountCookie,
    STUDIO_ACCOUNT_COOKIE,
  } = await import("../lib/access-tier.ts");
  const ownerCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "invite-entitlement-owner" },
    accountSecret,
  );
  const memberCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "invite-entitlement-member" },
    accountSecret,
  );
  const owner = readStudioAccountCookie(ownerCookie, accountSecret);
  assert.ok(owner);
  resetLocalTeamWorkspaceStateForTests();
  resetLocalBillingStateForTests();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();

  const headers = (cookie) => ({
    "content-type": "application/json",
    cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
    origin: "https://drops-studio.vercel.app",
  });

  await withEnv({
    DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
    VERCEL: undefined,
    STRIPE_PRO_PRICE_ID: "price_pro_monthly",
    DROPS_TEAM_INVITE_SECRET: inviteSecret,
  }, async () => {
    await applyBillingWebhookEvent({
      id: "evt_invite_owner_active_123",
      type: "customer.subscription.updated",
      mutation: "subscription",
      createdAt: "2026-07-30T12:00:00.000Z",
      accountIdentity: owner.identity,
      stripeCustomerId: "cus_invite_owner_123456",
      stripeSubscriptionId: "sub_invite_owner_123456",
      priceId: "price_pro_monthly",
      status: "active",
      currentPeriodEnd: "2026-08-30T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    });

    const createdResponse = await teamsRouteModule.POST(
      new NextRequest("https://drops-studio.vercel.app/api/teams", {
        method: "POST",
        headers: headers(ownerCookie),
        body: JSON.stringify({ name: "Entitlement Desk", consent: true }),
      }),
    );
    const createdBody = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    const workspaceId = createdBody.workspace.id;

    const inviteResponse = await inviteRouteModule.POST(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}/invites`,
        {
          method: "POST",
          headers: headers(ownerCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            expectedRevision: 1,
            role: "editor",
            expiresInHours: 24,
            consent: true,
          }),
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    const inviteBody = await inviteResponse.json();
    assert.equal(inviteResponse.status, 201);

    await applyBillingWebhookEvent({
      id: "evt_invite_owner_canceled_123",
      type: "customer.subscription.deleted",
      mutation: "subscription",
      createdAt: "2026-07-30T12:01:00.000Z",
      accountIdentity: owner.identity,
      stripeCustomerId: "cus_invite_owner_123456",
      stripeSubscriptionId: "sub_invite_owner_123456",
      priceId: "price_pro_monthly",
      status: "canceled",
      currentPeriodEnd: "2026-07-30T12:01:00.000Z",
      cancelAtPeriodEnd: false,
    });

    const acceptedResponse = await acceptInviteRouteModule.POST(
      new NextRequest(
        "https://drops-studio.vercel.app/api/teams/invites/accept",
        {
          method: "POST",
          headers: headers(memberCookie),
          body: JSON.stringify({ capability: inviteBody.capability, consent: true }),
        },
      ),
    );
    const acceptedBody = await acceptedResponse.json();
    assert.equal(acceptedResponse.status, 403);
    assert.equal(acceptedBody.code, "PRO_REQUIRED");

    const durable = await readTeamWorkspace(
      owner.identity,
      workspaceId,
      owner.identity,
    );
    assert.equal(durable.revision, 2);
    assert.equal(durable.members.length, 1);
    assert.equal(durable.invites[0].acceptedAt, null);
  });
});

test("HTTP team flow enforces exact-Price Pro ownership, roles, revisions and consent", async () => {
  assert.ok(teamRouteModule, "team workspace route must exist");
  assert.ok(inviteRouteModule, "team invite route must exist");
  assert.ok(acceptInviteRouteModule, "team invite acceptance route must exist");
  assert.ok(memberRouteModule, "team member route must exist");
  assert.ok(teamProjectRouteModule, "team shared project route must exist");
  const {
    resetLocalTeamWorkspaceStateForTests,
  } = modules();
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = await import("../db/billing.ts");
  const {
    createStudioAccountCookie,
    readStudioAccountCookie,
    STUDIO_ACCOUNT_COOKIE,
  } = await import("../lib/access-tier.ts");
  const ownerCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "http-team-owner" },
    accountSecret,
  );
  const editorCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "http-team-editor" },
    accountSecret,
  );
  const owner = readStudioAccountCookie(ownerCookie, accountSecret);
  const editor = readStudioAccountCookie(editorCookie, accountSecret);
  assert.ok(owner);
  assert.ok(editor);
  resetLocalTeamWorkspaceStateForTests();
  resetLocalBillingStateForTests();
  globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map();

  const commonHeaders = (cookie) => ({
    "content-type": "application/json",
    cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
    origin: "https://drops-studio.vercel.app",
  });
  const context = (workspaceId) => ({ params: Promise.resolve({ workspaceId }) });

  await withEnv({
    DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
    VERCEL: undefined,
    STRIPE_PRO_PRICE_ID: "price_pro_monthly",
    DROPS_TEAM_INVITE_SECRET: inviteSecret,
  }, async () => {
    await applyBillingWebhookEvent({
      id: "evt_http_team_owner_pro_123",
      type: "customer.subscription.updated",
      mutation: "subscription",
      createdAt: "2026-07-30T12:00:00.000Z",
      accountIdentity: owner.identity,
      stripeCustomerId: "cus_http_team_123456",
      stripeSubscriptionId: "sub_http_team_123456",
      priceId: "price_pro_monthly",
      status: "active",
      currentPeriodEnd: "2026-08-30T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    });

    const createdResponse = await teamsRouteModule.POST(
      new NextRequest("https://drops-studio.vercel.app/api/teams", {
        method: "POST",
        headers: commonHeaders(ownerCookie),
        body: JSON.stringify({ name: "HTTP Alpha Desk", consent: true }),
      }),
    );
    const createdBody = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.equal(createdBody.workspace.revision, 1);
    const workspaceId = createdBody.workspace.id;

    const inviteResponse = await inviteRouteModule.POST(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}/invites`,
        {
          method: "POST",
          headers: commonHeaders(ownerCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            expectedRevision: 1,
            role: "editor",
            expiresInHours: 24,
            consent: true,
          }),
        },
      ),
      context(workspaceId),
    );
    const inviteBody = await inviteResponse.json();
    assert.equal(inviteResponse.status, 201);
    assert.match(inviteBody.capability, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    assert.equal(inviteBody.workspace.revision, 2);

    const acceptedResponse = await acceptInviteRouteModule.POST(
      new NextRequest(
        "https://drops-studio.vercel.app/api/teams/invites/accept",
        {
          method: "POST",
          headers: commonHeaders(editorCookie),
          body: JSON.stringify({ capability: inviteBody.capability, consent: true }),
        },
      ),
    );
    const acceptedBody = await acceptedResponse.json();
    assert.equal(acceptedResponse.status, 200);
    assert.equal(acceptedBody.status, "accepted");
    assert.equal(acceptedBody.workspace.revision, 3);
    assert.equal("capability" in acceptedBody, false);

    const projectResponse = await teamProjectRouteModule.PUT(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}/projects`,
        {
          method: "PUT",
          headers: commonHeaders(editorCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            expectedWorkspaceRevision: 3,
            expectedProjectRevision: 0,
            project: sharedProjectDraft(),
            consent: true,
          }),
        },
      ),
      context(workspaceId),
    );
    const projectBody = await projectResponse.json();
    assert.equal(projectResponse.status, 201);
    assert.equal(projectBody.project.revision, 1);
    assert.equal(projectBody.workspace.revision, 4);

    const editedResponse = await teamRouteModule.PATCH(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}`,
        {
          method: "PATCH",
          headers: commonHeaders(editorCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            expectedRevision: 4,
            name: "HTTP Shared Desk",
            consent: true,
          }),
        },
      ),
      context(workspaceId),
    );
    assert.equal(editedResponse.status, 200);
    assert.equal((await editedResponse.json()).workspace.revision, 5);

    const changedRoleResponse = await memberRouteModule.PATCH(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}/members`,
        {
          method: "PATCH",
          headers: commonHeaders(ownerCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            memberIdentity: editor.identity,
            role: "viewer",
            expectedRevision: 5,
            consent: true,
          }),
        },
      ),
      context(workspaceId),
    );
    assert.equal(changedRoleResponse.status, 200);
    assert.equal((await changedRoleResponse.json()).workspace.revision, 6);

    const forbiddenResponse = await teamRouteModule.PATCH(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}`,
        {
          method: "PATCH",
          headers: commonHeaders(editorCookie),
          body: JSON.stringify({
            ownerIdentity: owner.identity,
            expectedRevision: 6,
            name: "Viewer overwrite",
            consent: true,
          }),
        },
      ),
      context(workspaceId),
    );
    assert.equal(forbiddenResponse.status, 403);

    const readResponse = await teamRouteModule.GET(
      new NextRequest(
        `https://drops-studio.vercel.app/api/teams/${workspaceId}?owner=${owner.identity}`,
        { headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${editorCookie}` } },
      ),
      context(workspaceId),
    );
    const readBody = await readResponse.json();
    assert.equal(readResponse.status, 200);
    assert.equal(readBody.workspace.name, "HTTP Shared Desk");
    assert.equal(readBody.workspace.projects[0].revision, 1);
    assert.equal(readBody.workspace.members.find((item) =>
      item.identity === editor.identity).role, "viewer");

    const joinedResponse = await teamsRouteModule.GET(
      new NextRequest("https://drops-studio.vercel.app/api/teams", {
        headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${editorCookie}` },
      }),
    );
    const joinedBody = await joinedResponse.json();
    assert.equal(joinedResponse.status, 200);
    assert.equal(joinedBody.accountIdentity, editor.identity);
    assert.equal(joinedBody.workspaces.length, 1);
    assert.equal(joinedBody.workspaces[0].ownerIdentity, owner.identity);
    assert.equal(joinedBody.workspaces[0].id, workspaceId);
  });
});
