import { enterpriseError } from "./errors.ts";
import type { EnterprisePermission, EnterpriseRuntime } from "./types.ts";
import { assertSafeId, boundedText, clone, iso, normalizeProjectPath, sha256, stableJson } from "./utils.ts";

export interface TextInsertOperation {
  kind: "insert";
  operationId: string;
  actorId: string;
  lamport: number;
  afterId: string | "ROOT";
  value: string;
}

export interface TextDeleteOperation {
  kind: "delete";
  operationId: string;
  actorId: string;
  lamport: number;
  targetId: string;
}

export type CollaborativeTextOperation = TextInsertOperation | TextDeleteOperation;

export interface CollaborativeTextDocument {
  id: string;
  operations: CollaborativeTextOperation[];
}

interface RenderNode {
  id: string;
  value: string;
}

const MAX_DOCUMENT_CHARACTERS = 100_000;
const MAX_DOCUMENT_OPERATIONS = 250_000;

function operationOrder(left: TextInsertOperation, right: TextInsertOperation): number {
  return right.lamport - left.lamport
    || left.actorId.localeCompare(right.actorId)
    || left.operationId.localeCompare(right.operationId);
}

function validateOperations(operations: readonly CollaborativeTextOperation[]): void {
  if (operations.length > MAX_DOCUMENT_OPERATIONS) enterpriseError("COLLABORATION_OPERATION_INVALID", "Collaborative operation limit exceeded.");
  const inserts = new Map<string, TextInsertOperation>();
  const ids = new Map<string, CollaborativeTextOperation>();
  for (const operation of operations) {
    assertSafeId(operation.operationId, "Operation id");
    assertSafeId(operation.actorId, "Operation actor id");
    if (!Number.isSafeInteger(operation.lamport) || operation.lamport < 0) enterpriseError("COLLABORATION_OPERATION_INVALID", "Lamport clock is invalid.");
    const existing = ids.get(operation.operationId);
    if (existing && stableJson(existing) !== stableJson(operation)) enterpriseError("COLLABORATION_OPERATION_INVALID", "Operation id has conflicting content.");
    ids.set(operation.operationId, operation);
    if (operation.kind === "insert") {
      if (!operation.value || [...operation.value].length !== 1 || operation.value.includes("\0")) {
        enterpriseError("COLLABORATION_OPERATION_INVALID", "Insert operations contain exactly one Unicode character.");
      }
      inserts.set(operation.operationId, operation);
    }
  }
  for (const operation of ids.values()) {
    if (operation.kind === "insert" && operation.afterId !== "ROOT" && !inserts.has(operation.afterId)) {
      enterpriseError("COLLABORATION_OPERATION_INVALID", "Insert anchor does not exist.");
    }
    if (operation.kind === "delete" && !inserts.has(operation.targetId)) {
      enterpriseError("COLLABORATION_OPERATION_INVALID", "Delete target does not exist.");
    }
  }
}

function renderNodes(document: CollaborativeTextDocument): RenderNode[] {
  validateOperations(document.operations);
  const inserts = document.operations.filter((operation): operation is TextInsertOperation => operation.kind === "insert");
  const deleted = new Set(document.operations.filter((operation): operation is TextDeleteOperation => operation.kind === "delete").map((operation) => operation.targetId));
  const children = new Map<string, TextInsertOperation[]>();
  for (const insert of inserts) {
    const entries = children.get(insert.afterId) ?? [];
    entries.push(insert);
    children.set(insert.afterId, entries);
  }
  for (const entries of children.values()) entries.sort(operationOrder);
  const result: RenderNode[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: Array<{ parentId: string; children: TextInsertOperation[]; index: number }> = [
    { parentId: "ROOT", children: children.get("ROOT") ?? [], index: 0 },
  ];
  while (stack.length) {
    const frame = stack.at(-1)!;
    if (frame.index >= frame.children.length) {
      stack.pop();
      if (frame.parentId !== "ROOT") visiting.delete(frame.parentId);
      continue;
    }
    const child = frame.children[frame.index++];
    if (visiting.has(child.operationId)) enterpriseError("COLLABORATION_OPERATION_INVALID", "Collaborative operation cycle detected.");
    if (visited.has(child.operationId)) continue;
    visiting.add(child.operationId);
    visited.add(child.operationId);
    if (!deleted.has(child.operationId)) result.push({ id: child.operationId, value: child.value });
    stack.push({ parentId: child.operationId, children: children.get(child.operationId) ?? [], index: 0 });
  }
  if (visited.size !== inserts.length) enterpriseError("COLLABORATION_OPERATION_INVALID", "Collaborative document contains unreachable operations.");
  if (result.length > MAX_DOCUMENT_CHARACTERS) enterpriseError("COLLABORATION_OPERATION_INVALID", "Collaborative document size limit exceeded.");
  return result;
}

export function createCollaborativeTextDocument(id: string, initialText = ""): CollaborativeTextDocument {
  assertSafeId(id, "Document id");
  if ([...initialText].length > MAX_DOCUMENT_CHARACTERS || initialText.includes("\0")) enterpriseError("COLLABORATION_OPERATION_INVALID", "Initial document is invalid.");
  let afterId: string | "ROOT" = "ROOT";
  const operations: TextInsertOperation[] = [];
  [...initialText].forEach((value, index) => {
    const operationId = `${id}:base:${String(index).padStart(6, "0")}`;
    operations.push({ kind: "insert", operationId, actorId: "system-base", lamport: 0, afterId, value });
    afterId = operationId;
  });
  return { id, operations };
}

export function renderCollaborativeText(document: CollaborativeTextDocument): string {
  return renderNodes(document).map((node) => node.value).join("");
}

export function createInsertOperations(
  document: CollaborativeTextDocument,
  input: { actorId: string; lamport: number; index: number; text: string },
): TextInsertOperation[] {
  assertSafeId(input.actorId, "Operation actor id");
  if (!Number.isSafeInteger(input.lamport) || input.lamport < 1) enterpriseError("COLLABORATION_OPERATION_INVALID", "Lamport clock is invalid.");
  const nodes = renderNodes(document);
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index > nodes.length) enterpriseError("COLLABORATION_OPERATION_INVALID", "Insert index is invalid.");
  const characters = [...input.text];
  if (!characters.length || characters.length > 4_096 || input.text.includes("\0")) enterpriseError("COLLABORATION_OPERATION_INVALID", "Insert text is invalid.");
  let afterId: string | "ROOT" = input.index === 0 ? "ROOT" : nodes[input.index - 1].id;
  return characters.map((value, index) => {
    const lamport = input.lamport + index;
    const operationId = `${input.actorId}:insert:${lamport}:${index}:${sha256(`${document.id}:${afterId}:${value}`).slice(0, 8)}`;
    const operation: TextInsertOperation = { kind: "insert", operationId, actorId: input.actorId, lamport, afterId, value };
    afterId = operationId;
    return operation;
  });
}

export function createDeleteOperations(
  document: CollaborativeTextDocument,
  input: { actorId: string; lamport: number; index: number; length: number },
): TextDeleteOperation[] {
  assertSafeId(input.actorId, "Operation actor id");
  const nodes = renderNodes(document);
  if (
    !Number.isSafeInteger(input.lamport) || input.lamport < 1
    || !Number.isSafeInteger(input.index) || input.index < 0
    || !Number.isSafeInteger(input.length) || input.length < 1
    || input.index + input.length > nodes.length
  ) enterpriseError("COLLABORATION_OPERATION_INVALID", "Delete range is invalid.");
  return nodes.slice(input.index, input.index + input.length).map((node, index) => ({
    kind: "delete",
    operationId: `${input.actorId}:delete:${input.lamport + index}:${sha256(node.id).slice(0, 8)}`,
    actorId: input.actorId,
    lamport: input.lamport + index,
    targetId: node.id,
  }));
}

export function applyTextOperations(
  document: CollaborativeTextDocument,
  incoming: readonly CollaborativeTextOperation[],
): CollaborativeTextDocument {
  const merged = new Map<string, CollaborativeTextOperation>();
  for (const operation of [...document.operations, ...incoming]) {
    const existing = merged.get(operation.operationId);
    if (existing && stableJson(existing) !== stableJson(operation)) enterpriseError("COLLABORATION_OPERATION_INVALID", "Operation id has conflicting content.");
    merged.set(operation.operationId, clone(operation));
  }
  const next = { id: document.id, operations: [...merged.values()].sort((left, right) => left.operationId.localeCompare(right.operationId)) };
  renderNodes(next);
  return next;
}

export interface PresenceParticipant {
  userId: string;
  displayName: string;
  activeFile: string;
  state: "editing" | "viewing";
  cursor?: { anchor: number; head: number };
  connectedAt: number;
  updatedAt: number;
  expiresAt: number;
}

export class LocalPresenceRoom {
  readonly #roomId: string;
  readonly #ttlMs: number;
  readonly #maximumParticipants: number;
  readonly #authorized = new Map<string, { displayName: string; canEdit: boolean }>();
  readonly #presence = new Map<string, PresenceParticipant>();

  constructor(input: { roomId: string; ttlMs: number; maximumParticipants: number }) {
    this.#roomId = assertSafeId(input.roomId, "Room id");
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 120_000) enterpriseError("INVALID_INPUT", "Presence TTL is invalid.");
    if (!Number.isSafeInteger(input.maximumParticipants) || input.maximumParticipants < 1 || input.maximumParticipants > 100) enterpriseError("INVALID_INPUT", "Room capacity is invalid.");
    this.#ttlMs = input.ttlMs;
    this.#maximumParticipants = input.maximumParticipants;
  }

  authorize(input: { userId: string; displayName: string; canEdit: boolean }): void {
    this.#authorized.set(assertSafeId(input.userId, "User id"), { displayName: boundedText(input.displayName, "Display name", 80), canEdit: input.canEdit });
  }

  revoke(userId: string): void {
    this.#authorized.delete(userId);
    this.#presence.delete(userId);
  }

  update(input: {
    userId: string;
    activeFile: string;
    state: "editing" | "viewing";
    cursor?: { anchor: number; head: number };
    at: number;
  }): PresenceParticipant {
    const authorization = this.#authorized.get(input.userId);
    if (!authorization) enterpriseError("ROOM_ACCESS_DENIED", `User is not authorized for room ${this.#roomId}.`);
    if (input.state === "editing" && !authorization.canEdit) enterpriseError("PERMISSION_DENIED", "Viewer cannot publish editing presence.");
    if (!Number.isSafeInteger(input.at) || input.at < 0) enterpriseError("INVALID_INPUT", "Presence timestamp is invalid.");
    if (input.cursor && (!Number.isSafeInteger(input.cursor.anchor) || !Number.isSafeInteger(input.cursor.head) || input.cursor.anchor < 0 || input.cursor.head < 0)) {
      enterpriseError("INVALID_INPUT", "Presence cursor is invalid.");
    }
    const existing = this.#presence.get(input.userId);
    if (!existing && this.list(input.at).length >= this.#maximumParticipants) enterpriseError("ROOM_CAPACITY_EXCEEDED", "Presence room is full.");
    const participant: PresenceParticipant = {
      userId: input.userId,
      displayName: authorization.displayName,
      activeFile: normalizeProjectPath(input.activeFile),
      state: input.state,
      ...(input.cursor ? { cursor: clone(input.cursor) } : {}),
      connectedAt: existing?.connectedAt ?? input.at,
      updatedAt: input.at,
      expiresAt: input.at + this.#ttlMs,
    };
    this.#presence.set(input.userId, participant);
    return clone(participant);
  }

  list(at: number): PresenceParticipant[] {
    for (const [userId, participant] of this.#presence) if (participant.expiresAt < at) this.#presence.delete(userId);
    return [...this.#presence.values()].sort((left, right) => left.userId.localeCompare(right.userId)).map(clone);
  }

  state(): { status: "working-local-test"; mode: "deterministic-local-test"; providerEvidence: false } {
    return { status: "working-local-test", mode: "deterministic-local-test", providerEvidence: false };
  }
}

export interface CommentRecord {
  id: string;
  authorUserId: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface CommentThreadRecord {
  id: string;
  projectId: string;
  filePath: string;
  range: { start: number; end: number };
  status: "open" | "resolved";
  comments: CommentRecord[];
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export class CollaborationComments {
  readonly #runtime: EnterpriseRuntime & { can(userId: string, permission: EnterprisePermission): boolean };
  readonly #threads = new Map<string, CommentThreadRecord>();

  constructor(runtime: EnterpriseRuntime & { can(userId: string, permission: EnterprisePermission): boolean }) {
    this.#runtime = runtime;
  }

  createThread(input: {
    actorUserId: string;
    projectId: string;
    filePath: string;
    range: { start: number; end: number };
    body: string;
    mentions?: string[];
  }): CommentThreadRecord {
    this.#assert(input.actorUserId, "collaboration.comment");
    if (!Number.isSafeInteger(input.range.start) || !Number.isSafeInteger(input.range.end) || input.range.start < 0 || input.range.end < input.range.start) {
      enterpriseError("INVALID_INPUT", "Comment range is invalid.");
    }
    const now = iso(this.#runtime.now());
    const thread: CommentThreadRecord = {
      id: assertSafeId(this.#runtime.id("comment-thread"), "Comment thread id"),
      projectId: assertSafeId(input.projectId, "Project id"),
      filePath: normalizeProjectPath(input.filePath),
      range: clone(input.range),
      status: "open",
      comments: [this.#comment(input.actorUserId, input.body, input.mentions ?? [], now)],
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: now,
    };
    this.#threads.set(thread.id, thread);
    return clone(thread);
  }

  reply(input: { actorUserId: string; threadId: string; body: string; mentions?: string[] }): CommentRecord {
    this.#assert(input.actorUserId, "collaboration.comment");
    const thread = this.#thread(input.threadId);
    const comment = this.#comment(input.actorUserId, input.body, input.mentions ?? [], iso(this.#runtime.now()));
    thread.comments.push(comment);
    return clone(comment);
  }

  resolve(input: { actorUserId: string; threadId: string }): CommentThreadRecord {
    this.#assert(input.actorUserId, "collaboration.merge");
    const thread = this.#thread(input.threadId);
    thread.status = "resolved";
    thread.resolvedByUserId = input.actorUserId;
    thread.resolvedAt = iso(this.#runtime.now());
    return clone(thread);
  }

  reopen(input: { actorUserId: string; threadId: string }): CommentThreadRecord {
    this.#assert(input.actorUserId, "collaboration.merge");
    const thread = this.#thread(input.threadId);
    thread.status = "open";
    thread.resolvedByUserId = null;
    thread.resolvedAt = null;
    return clone(thread);
  }

  thread(id: string): CommentThreadRecord {
    return clone(this.#thread(id));
  }

  #comment(actorUserId: string, body: string, mentions: string[], createdAt: string): CommentRecord {
    return {
      id: assertSafeId(this.#runtime.id("comment"), "Comment id"),
      authorUserId: assertSafeId(actorUserId, "Comment author id"),
      body: boundedText(body, "Comment body", 4_000),
      mentions: [...new Set(mentions.map((mention) => assertSafeId(mention, "Mention user id")))].sort(),
      createdAt,
    };
  }

  #thread(id: string): CommentThreadRecord {
    const thread = this.#threads.get(id);
    if (!thread) enterpriseError("NOT_FOUND", "Comment thread was not found.");
    return thread;
  }

  #assert(userId: string, permission: EnterprisePermission): void {
    if (!this.#runtime.can(userId, permission)) enterpriseError("PERMISSION_DENIED", `Permission ${permission} is required.`);
  }
}
