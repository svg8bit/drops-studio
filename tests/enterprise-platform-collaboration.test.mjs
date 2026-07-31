import assert from "node:assert/strict";
import test from "node:test";

const {
  AiBranchManager,
  CollaborationComments,
  EnterprisePlatformError,
  LocalPresenceRoom,
  applyTextOperations,
  createCollaborativeTextDocument,
  createDeleteOperations,
  createInsertOperations,
  renderCollaborativeText,
} = await import("../lib/enterprise-platform/index.ts");

function hasCode(code) {
  return (error) => error instanceof EnterprisePlatformError && error.code === code;
}

test("concurrent deterministic text operations converge without losing either actor", () => {
  const base = createCollaborativeTextDocument("doc-1", "AB");
  const left = createInsertOperations(base, { actorId: "alice", lamport: 10, index: 1, text: "x" });
  const right = createInsertOperations(base, { actorId: "bob", lamport: 10, index: 1, text: "y" });
  const first = applyTextOperations(base, [...left, ...right]);
  const second = applyTextOperations(base, [...right, ...left]);
  assert.equal(renderCollaborativeText(first), renderCollaborativeText(second));
  assert.match(renderCollaborativeText(first), /^A(?:xy|yx)B$/);

  const deletion = createDeleteOperations(first, { actorId: "alice", lamport: 20, index: 1, length: 1 });
  const deleted = applyTextOperations(first, deletion);
  assert.equal(renderCollaborativeText(deleted).length, 3);
  assert.throws(() => applyTextOperations(base, [{
    kind: "insert", operationId: "bad", actorId: "alice", lamport: 1, afterId: "missing", value: "z",
  }]), hasCode("COLLABORATION_OPERATION_INVALID"));
});

test("deep collaborative documents render without recursive stack overflow", () => {
  const source = "x".repeat(20_000);
  const document = createCollaborativeTextDocument("deep-document", source);
  assert.equal(renderCollaborativeText(document), source);
});

test("presence is authenticated, real, bounded and expires", () => {
  const room = new LocalPresenceRoom({ roomId: "room-1", ttlMs: 5_000, maximumParticipants: 2 });
  room.authorize({ userId: "alice", displayName: "Alice", canEdit: true });
  room.authorize({ userId: "viewer", displayName: "Viewer", canEdit: false });
  room.update({ userId: "alice", activeFile: "app/page.tsx", state: "editing", cursor: { anchor: 2, head: 4 }, at: 1_000 });
  room.update({ userId: "viewer", activeFile: "app/page.tsx", state: "viewing", at: 1_000 });
  assert.equal(room.list(5_999).length, 2);
  assert.equal(room.list(6_001).length, 0);
  assert.throws(() => room.update({ userId: "viewer", activeFile: "app/page.tsx", state: "editing", at: 7_000 }), hasCode("PERMISSION_DENIED"));
  assert.throws(() => room.update({ userId: "unknown", activeFile: "app/page.tsx", state: "viewing", at: 7_000 }), hasCode("ROOM_ACCESS_DENIED"));
});

test("comments support replies and explicit resolve/reopen permissions", () => {
  const permissions = new Map([
    ["owner", new Set(["collaboration.comment", "collaboration.merge"])],
    ["dev", new Set(["collaboration.comment"])],
    ["viewer", new Set()],
  ]);
  let id = 0;
  const comments = new CollaborationComments({
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    id: (prefix) => `${prefix}-${++id}`,
    can: (userId, permission) => permissions.get(userId)?.has(permission) ?? false,
  });
  const thread = comments.createThread({ actorUserId: "owner", projectId: "project-1", filePath: "app/page.tsx", range: { start: 4, end: 10 }, body: "Check this card", mentions: ["dev"] });
  comments.reply({ actorUserId: "dev", threadId: thread.id, body: "Fixed in my branch" });
  comments.resolve({ actorUserId: "owner", threadId: thread.id });
  assert.equal(comments.thread(thread.id).status, "resolved");
  comments.reopen({ actorUserId: "owner", threadId: thread.id });
  assert.equal(comments.thread(thread.id).status, "open");
  assert.equal(comments.thread(thread.id).comments.length, 2);
  assert.throws(() => comments.reply({ actorUserId: "viewer", threadId: thread.id, body: "No access" }), hasCode("PERMISSION_DENIED"));
});

test("AI task branches never overwrite stale canonical work and successful merge checkpoints", () => {
  let id = 0;
  const manager = new AiBranchManager({
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    id: (prefix) => `${prefix}-${++id}`,
  });
  manager.createProject({ projectId: "project-1", files: { "app/page.tsx": "base", "lib/data.ts": "data-v1" } });
  const stale = manager.createBranch({ projectId: "project-1", taskOwnerId: "agent-owner", taskScope: ["app/**"] });
  manager.writeBranchFile({ branchId: stale.id, path: "app/page.tsx", content: "agent edit" });
  manager.updateCanonical({ projectId: "project-1", actorUserId: "developer", expectedRevision: 1, writes: { "app/page.tsx": "human edit" } });
  const conflict = manager.mergeBranch({ branchId: stale.id, actorUserId: "reviewer", approved: true });
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.conflicts.map((entry) => entry.path), ["app/page.tsx"]);
  assert.equal(manager.project("project-1").files["app/page.tsx"], "human edit");
  assert.equal(manager.branch(stale.id).status, "conflict");

  const clean = manager.createBranch({ projectId: "project-1", taskOwnerId: "agent-owner", taskScope: ["lib/**"] });
  manager.writeBranchFile({ branchId: clean.id, path: "lib/data.ts", content: "data-v2" });
  assert.equal(manager.mergeBranch({ branchId: clean.id, actorUserId: "reviewer", approved: false }).status, "approval-required");
  const merged = manager.mergeBranch({ branchId: clean.id, actorUserId: "reviewer", approved: true });
  assert.equal(merged.status, "merged");
  assert.match(merged.checkpointId, /^checkpoint-/);
  assert.equal(manager.project("project-1").files["lib/data.ts"], "data-v2");
  manager.restoreCheckpoint({ projectId: "project-1", checkpointId: merged.checkpointId, actorUserId: "owner", expectedRevision: 3 });
  assert.equal(manager.project("project-1").files["lib/data.ts"], "data-v1");
});
