import { BlobPreconditionFailedError } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import {
  createTeamInviteCapability,
  hashTeamInviteCapability,
  teamPermission,
  teamWorkspaceName,
  TeamWorkspacePermissionError,
  TeamWorkspaceValidationError,
  validTeamId,
  validTeamIdentity,
  validTeamTimestamp,
  verifyTeamInviteCapability,
  type TeamInvite,
  type TeamMember,
  type TeamRole,
  type TeamSharedProject,
  type TeamWorkspace,
} from "../lib/team-workspaces.ts";
import {
  sanitizeMemberProjectDraft,
  type MemberProjectDraft,
} from "../lib/member-project-cloud.ts";

export const TEAM_WORKSPACE_OWNER_CAPACITY_BYTES = 3 * 1024 * 1024;
const MAX_INVITES_PER_WORKSPACE = 100;
const MAX_PROJECTS_PER_WORKSPACE = 20;
const MEMBER_OWNER_READ_CONCURRENCY = 4;
const ENVELOPE_SCHEMA = `CREATE TABLE IF NOT EXISTS team_workspace_envelopes (
  owner_identity TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  envelope_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

interface StoredTeamInvite extends TeamInvite {
  capabilityHash: string;
  maxCollaborators: number;
}

interface StoredTeamWorkspace extends Omit<TeamWorkspace, "invites"> {
  invites: StoredTeamInvite[];
}

function collaboratorCount(workspace: StoredTeamWorkspace): number {
  return workspace.members.filter((member) => member.role !== "owner").length;
}

interface TeamMembershipPointer {
  ownerIdentity: string;
  workspaceId: string;
  joinedAt: string;
}

interface TeamEnvelope {
  schemaVersion: 1;
  ownerIdentity: string;
  revision: number;
  updatedAt: string;
  workspaces: StoredTeamWorkspace[];
  memberships: TeamMembershipPointer[];
}

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

export interface TeamStorageRuntime {
  storage?: BlobStorage;
  now?: () => Date;
  id?: () => string;
}

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
  var __DROPS_STUDIO_LOCAL_TEAM_WORKSPACES__: Map<string, TeamEnvelope> | undefined;
}

export class TeamWorkspaceStorageUnavailableError extends Error {
  constructor(message = "Team workspace storage is temporarily unavailable.") {
    super(message);
    this.name = "TeamWorkspaceStorageUnavailableError";
  }
}

export class TeamWorkspaceCapacityError extends TeamWorkspaceValidationError {
  constructor() {
    super(
      "Team source capacity is 3 MB per owner across all teams. Archive or replace an existing shared project before saving another large workspace.",
    );
    this.name = "TeamWorkspaceCapacityError";
  }
}

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function localEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export function teamWorkspaceStorageConfigured(): boolean {
  return localEnabled() || Boolean(database()) || blobConfigured();
}

function currentTime(runtime: TeamStorageRuntime): Date {
  const value = runtime.now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TeamWorkspaceValidationError("Team workspace clock is invalid.");
  }
  return value;
}

function nextId(runtime: TeamStorageRuntime): string {
  const id = (runtime.id ?? randomUUID)();
  if (!validTeamId(id)) throw new TeamWorkspaceValidationError("Team workspace id is invalid.");
  return id;
}

function emptyEnvelope(ownerIdentity: string): TeamEnvelope {
  return {
    schemaVersion: 1,
    ownerIdentity,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    workspaces: [],
    memberships: [],
  };
}

function localStore(): Map<string, TeamEnvelope> {
  return globalThis.__DROPS_STUDIO_LOCAL_TEAM_WORKSPACES__ ??= new Map();
}

export function resetLocalTeamWorkspaceStateForTests(): void {
  globalThis.__DROPS_STUDIO_LOCAL_TEAM_WORKSPACES__ = new Map();
}

function blobPath(ownerIdentity: string): string {
  return `drops-studio/team-workspaces/${ownerIdentity}.json`;
}

function validRole(value: unknown): value is TeamRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

function storedMember(value: unknown): TeamMember {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<TeamMember>;
  if (
    typeof input.identity !== "string"
    || !validTeamIdentity(input.identity)
    || !validRole(input.role)
    || typeof input.joinedAt !== "string"
    || !validTeamTimestamp(input.joinedAt)
    || typeof input.consentedAt !== "string"
    || !validTeamTimestamp(input.consentedAt)
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid member.");
  }
  return {
    identity: input.identity,
    role: input.role,
    joinedAt: input.joinedAt,
    consentedAt: input.consentedAt,
  };
}

function storedInvite(value: unknown): StoredTeamInvite {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<StoredTeamInvite>;
  if (
    typeof input.id !== "string"
    || !validTeamId(input.id)
    || (input.role !== "editor" && input.role !== "viewer")
    || typeof input.createdAt !== "string"
    || !validTeamTimestamp(input.createdAt)
    || typeof input.expiresAt !== "string"
    || !validTeamTimestamp(input.expiresAt)
    || (input.acceptedAt !== null
      && (typeof input.acceptedAt !== "string" || !validTeamTimestamp(input.acceptedAt)))
    || (input.acceptedBy !== null
      && (typeof input.acceptedBy !== "string" || !validTeamIdentity(input.acceptedBy)))
    || typeof input.capabilityHash !== "string"
    || !/^[a-f0-9]{64}$/.test(input.capabilityHash)
    || !Number.isSafeInteger(input.maxCollaborators)
    || Number(input.maxCollaborators) < 1
    || Number(input.maxCollaborators) > 100
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid invite.");
  }
  if ((input.acceptedAt === null) !== (input.acceptedBy === null)) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid invite receipt.");
  }
  return {
    id: input.id,
    role: input.role,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    acceptedAt: input.acceptedAt,
    acceptedBy: input.acceptedBy,
    capabilityHash: input.capabilityHash,
    maxCollaborators: Number(input.maxCollaborators),
  };
}

function storedProject(value: unknown): TeamSharedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<TeamSharedProject>;
  if (
    typeof input.projectId !== "string"
    || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(input.projectId)
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 1
    || typeof input.createdAt !== "string"
    || !validTeamTimestamp(input.createdAt)
    || typeof input.updatedAt !== "string"
    || !validTeamTimestamp(input.updatedAt)
    || typeof input.updatedBy !== "string"
    || !validTeamIdentity(input.updatedBy)
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid shared project.");
  }
  let draft: MemberProjectDraft;
  try {
    draft = sanitizeMemberProjectDraft(input.draft);
  } catch {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an unsafe shared project.");
  }
  if (draft.id !== input.projectId) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned a mismatched shared project id.");
  }
  return {
    projectId: input.projectId,
    revision: Number(input.revision),
    draft,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };
}

function storedWorkspace(value: unknown, ownerIdentity: string): StoredTeamWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<StoredTeamWorkspace>;
  if (
    typeof input.id !== "string"
    || !validTeamId(input.id)
    || input.ownerIdentity !== ownerIdentity
    || typeof input.name !== "string"
    || teamWorkspaceName(input.name) !== input.name
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 1
    || typeof input.createdAt !== "string"
    || !validTeamTimestamp(input.createdAt)
    || typeof input.updatedAt !== "string"
    || !validTeamTimestamp(input.updatedAt)
    || !Array.isArray(input.members)
    || input.members.length < 1
    || input.members.length > 100
    || !Array.isArray(input.invites)
    || input.invites.length > MAX_INVITES_PER_WORKSPACE
    || (input.projects !== undefined
      && (!Array.isArray(input.projects)
        || input.projects.length > MAX_PROJECTS_PER_WORKSPACE))
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid workspace.");
  }
  const members = input.members.map(storedMember);
  if (
    members.filter((member) => member.role === "owner").length !== 1
    || members[0]?.identity !== ownerIdentity
    || members[0]?.role !== "owner"
    || new Set(members.map((member) => member.identity)).size !== members.length
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned invalid ownership.");
  }
  const invites = input.invites.map(storedInvite);
  const projects = (input.projects ?? []).map(storedProject);
  if (new Set(projects.map((project) => project.projectId)).size !== projects.length) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned duplicate shared projects.");
  }
  return {
    id: input.id,
    ownerIdentity,
    name: input.name,
    revision: Number(input.revision),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    members,
    invites,
    projects,
  };
}

function storedMembership(value: unknown): TeamMembershipPointer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<TeamMembershipPointer>;
  if (
    typeof input.ownerIdentity !== "string"
    || !validTeamIdentity(input.ownerIdentity)
    || typeof input.workspaceId !== "string"
    || !validTeamId(input.workspaceId)
    || typeof input.joinedAt !== "string"
    || !validTeamTimestamp(input.joinedAt)
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid membership pointer.");
  }
  return {
    ownerIdentity: input.ownerIdentity,
    workspaceId: input.workspaceId,
    joinedAt: input.joinedAt,
  };
}

function parsedEnvelope(value: unknown, ownerIdentity: string): TeamEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  const input = value as Partial<TeamEnvelope>;
  if (
    input.schemaVersion !== 1
    || input.ownerIdentity !== ownerIdentity
    || !Number.isSafeInteger(input.revision)
    || Number(input.revision) < 0
    || typeof input.updatedAt !== "string"
    || !validTeamTimestamp(input.updatedAt)
    || !Array.isArray(input.workspaces)
    || input.workspaces.length > 100
    || (input.memberships !== undefined
      && (!Array.isArray(input.memberships) || input.memberships.length > 500))
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned an invalid owner envelope.");
  }
  const workspaces = input.workspaces.map((item) => storedWorkspace(item, ownerIdentity));
  if (new Set(workspaces.map((item) => item.id)).size !== workspaces.length) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned duplicate workspaces.");
  }
  const memberships = (input.memberships ?? []).map(storedMembership);
  if (
    new Set(memberships.map((item) => `${item.ownerIdentity}:${item.workspaceId}`)).size
      !== memberships.length
  ) {
    throw new TeamWorkspaceStorageUnavailableError("Team storage returned duplicate membership pointers.");
  }
  return {
    schemaVersion: 1,
    ownerIdentity,
    revision: Number(input.revision),
    updatedAt: input.updatedAt,
    workspaces,
    memberships,
  };
}

function serialized(envelope: TeamEnvelope): string {
  const value = JSON.stringify(envelope);
  if (
    new TextEncoder().encode(value).byteLength
      > TEAM_WORKSPACE_OWNER_CAPACITY_BYTES
  ) {
    throw new TeamWorkspaceCapacityError();
  }
  return value;
}

function publicInvite(invite: StoredTeamInvite): TeamInvite {
  return {
    id: invite.id,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    acceptedBy: invite.acceptedBy,
  };
}

function publicWorkspace(workspace: StoredTeamWorkspace): TeamWorkspace {
  return {
    id: workspace.id,
    ownerIdentity: workspace.ownerIdentity,
    name: workspace.name,
    revision: workspace.revision,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    members: structuredClone(workspace.members),
    invites: workspace.invites.map(publicInvite),
    projects: structuredClone(workspace.projects),
  };
}

async function ensureTable(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(ENVELOPE_SCHEMA).run();
  return db;
}

async function readD1(ownerIdentity: string, db: D1Database): Promise<TeamEnvelope> {
  const row = await db.prepare(
    "SELECT envelope_json FROM team_workspace_envelopes WHERE owner_identity = ? LIMIT 1",
  ).bind(ownerIdentity).first<{ envelope_json: string }>();
  if (!row) return emptyEnvelope(ownerIdentity);
  try {
    return parsedEnvelope(JSON.parse(row.envelope_json) as unknown, ownerIdentity);
  } catch (error) {
    if (error instanceof TeamWorkspaceStorageUnavailableError) throw error;
    throw new TeamWorkspaceStorageUnavailableError("Team D1 storage returned unreadable data.");
  }
}

async function readBlob(
  ownerIdentity: string,
  storage: BlobStorage,
): Promise<{ envelope: TeamEnvelope; etag: string | null }> {
  const current = await storage.get(blobPath(ownerIdentity), {
    access: "private",
    useCache: false,
  });
  if (!current) return { envelope: emptyEnvelope(ownerIdentity), etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) {
    throw new TeamWorkspaceStorageUnavailableError();
  }
  try {
    return {
      envelope: parsedEnvelope(
        JSON.parse(await new Response(current.stream).text()) as unknown,
        ownerIdentity,
      ),
      etag: current.blob.etag,
    };
  } catch (error) {
    if (error instanceof TeamWorkspaceStorageUnavailableError) throw error;
    throw new TeamWorkspaceStorageUnavailableError("Team Blob storage returned unreadable data.");
  }
}

async function defaultBlob(runtime: TeamStorageRuntime): Promise<BlobStorage> {
  return runtime.storage ?? import("@vercel/blob");
}

async function readEnvelope(
  ownerIdentity: string,
  runtime: TeamStorageRuntime,
): Promise<TeamEnvelope> {
  if (!validTeamIdentity(ownerIdentity)) {
    throw new TeamWorkspaceValidationError("Team owner identity is invalid.");
  }
  if (runtime.storage) return (await readBlob(ownerIdentity, runtime.storage)).envelope;
  if (localEnabled()) return structuredClone(localStore().get(ownerIdentity) ?? emptyEnvelope(ownerIdentity));
  const db = await ensureTable();
  if (db) return readD1(ownerIdentity, db);
  if (!blobConfigured()) throw new TeamWorkspaceStorageUnavailableError();
  return (await readBlob(ownerIdentity, await defaultBlob(runtime))).envelope;
}

async function mutateEnvelope<T>(
  ownerIdentity: string,
  runtime: TeamStorageRuntime,
  mutate: (envelope: TeamEnvelope) => T,
): Promise<T> {
  if (!validTeamIdentity(ownerIdentity)) {
    throw new TeamWorkspaceValidationError("Team owner identity is invalid.");
  }
  if (!runtime.storage && localEnabled()) {
    const store = localStore();
    const envelope = structuredClone(store.get(ownerIdentity) ?? emptyEnvelope(ownerIdentity));
    const result = mutate(envelope);
    serialized(envelope);
    store.set(ownerIdentity, envelope);
    return result;
  }
  const db = !runtime.storage ? await ensureTable() : null;
  if (db) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await readD1(ownerIdentity, db);
      const next = structuredClone(current);
      const result = mutate(next);
      const value = serialized(next);
      const write = current.revision === 0
        ? await db.prepare(
            `INSERT OR IGNORE INTO team_workspace_envelopes
             (owner_identity, revision, envelope_json, updated_at) VALUES (?, ?, ?, ?)`,
          ).bind(ownerIdentity, next.revision, value, next.updatedAt).run()
        : await db.prepare(
            `UPDATE team_workspace_envelopes SET revision = ?, envelope_json = ?, updated_at = ?
             WHERE owner_identity = ? AND revision = ?`,
          ).bind(next.revision, value, next.updatedAt, ownerIdentity, current.revision).run();
      if (Number(write.meta?.changes ?? 0) === 1) return result;
    }
    throw new TeamWorkspaceStorageUnavailableError("Team D1 storage stayed busy after safe retries.");
  }
  if (!runtime.storage && !blobConfigured()) throw new TeamWorkspaceStorageUnavailableError();
  const storage = await defaultBlob(runtime);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readBlob(ownerIdentity, storage);
    const next = structuredClone(current.envelope);
    const result = mutate(next);
    const value = serialized(next);
    try {
      await storage.put(blobPath(ownerIdentity), value, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(current.etag),
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
        ...(current.etag ? { ifMatch: current.etag } : {}),
      });
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt === 7) {
        throw new TeamWorkspaceStorageUnavailableError();
      }
    }
  }
  throw new TeamWorkspaceStorageUnavailableError();
}

function requireConsent(consent: boolean): void {
  if (consent !== true) {
    throw new TeamWorkspaceValidationError("Explicit consent is required for team workspace changes.");
  }
}

function bump(envelope: TeamEnvelope, workspace: StoredTeamWorkspace, now: string): void {
  workspace.revision += 1;
  workspace.updatedAt = now;
  envelope.revision += 1;
  envelope.updatedAt = now;
}

export async function createTeamWorkspace(
  input: {
    ownerIdentity: string;
    name: string;
    consent: boolean;
    maxWorkspaces: number;
  },
  runtime: TeamStorageRuntime = {},
): Promise<TeamWorkspace> {
  requireConsent(input.consent);
  if (!validTeamIdentity(input.ownerIdentity)) {
    throw new TeamWorkspaceValidationError("Team owner identity is invalid.");
  }
  if (!Number.isSafeInteger(input.maxWorkspaces) || input.maxWorkspaces < 1 || input.maxWorkspaces > 100) {
    throw new TeamWorkspaceValidationError("Team workspace entitlement is invalid.");
  }
  const id = nextId(runtime);
  const name = teamWorkspaceName(input.name);
  const timestamp = currentTime(runtime).toISOString();
  return mutateEnvelope(input.ownerIdentity, runtime, (envelope) => {
    if (envelope.workspaces.length >= input.maxWorkspaces) {
      throw new TeamWorkspaceValidationError("Team workspace entitlement limit reached.");
    }
    const workspace: StoredTeamWorkspace = {
      id,
      ownerIdentity: input.ownerIdentity,
      name,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      members: [{
        identity: input.ownerIdentity,
        role: "owner",
        joinedAt: timestamp,
        consentedAt: timestamp,
      }],
      invites: [],
      projects: [],
    };
    envelope.workspaces.push(workspace);
    envelope.revision += 1;
    envelope.updatedAt = timestamp;
    return publicWorkspace(workspace);
  });
}

export async function readTeamWorkspace(
  ownerIdentity: string,
  workspaceId: string,
  actorIdentity: string,
  runtime: TeamStorageRuntime = {},
): Promise<TeamWorkspace | null> {
  if (!validTeamId(workspaceId) || !validTeamIdentity(actorIdentity)) {
    throw new TeamWorkspaceValidationError("Team workspace lookup is invalid.");
  }
  const workspace = (await readEnvelope(ownerIdentity, runtime)).workspaces
    .find((item) => item.id === workspaceId);
  if (!workspace) return null;
  const visible = publicWorkspace(workspace);
  if (!teamPermission(visible, actorIdentity, "read")) throw new TeamWorkspacePermissionError();
  return visible;
}

export async function listTeamWorkspaces(
  ownerIdentity: string,
  actorIdentity: string,
  runtime: TeamStorageRuntime = {},
): Promise<TeamWorkspace[]> {
  if (!validTeamIdentity(actorIdentity)) {
    throw new TeamWorkspaceValidationError("Team workspace member identity is invalid.");
  }
  return (await readEnvelope(ownerIdentity, runtime)).workspaces
    .map(publicWorkspace)
    .filter((workspace) => teamPermission(workspace, actorIdentity, "read"));
}

export async function listTeamWorkspacesForMember(
  actorIdentity: string,
  runtime: TeamStorageRuntime = {},
): Promise<TeamWorkspace[]> {
  if (!validTeamIdentity(actorIdentity)) {
    throw new TeamWorkspaceValidationError("Team workspace member identity is invalid.");
  }
  const memberEnvelope = await readEnvelope(actorIdentity, runtime);
  const visible = memberEnvelope.workspaces
    .map(publicWorkspace)
    .filter((workspace) => teamPermission(workspace, actorIdentity, "read"));
  const workspaceIdsByOwner = new Map<string, Set<string>>();
  for (const pointer of memberEnvelope.memberships) {
    const workspaceIds = workspaceIdsByOwner.get(pointer.ownerIdentity) ?? new Set<string>();
    workspaceIds.add(pointer.workspaceId);
    workspaceIdsByOwner.set(pointer.ownerIdentity, workspaceIds);
  }
  const owners = [...workspaceIdsByOwner.entries()];
  for (let index = 0; index < owners.length; index += MEMBER_OWNER_READ_CONCURRENCY) {
    const batch = await Promise.all(
      owners.slice(index, index + MEMBER_OWNER_READ_CONCURRENCY).map(
        async ([ownerIdentity, workspaceIds]) => {
          const ownerEnvelope = await readEnvelope(ownerIdentity, runtime);
          return ownerEnvelope.workspaces.filter((workspace) => workspaceIds.has(workspace.id));
        },
      ),
    );
    for (const workspace of batch.flat()) {
      const candidate = publicWorkspace(workspace);
      if (teamPermission(candidate, actorIdentity, "read")) visible.push(candidate);
    }
  }
  return [...new Map(visible.map((workspace) =>
    [`${workspace.ownerIdentity}:${workspace.id}`, workspace])).values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export type TeamMutationResult =
  | { status: "saved"; workspace: TeamWorkspace }
  | { status: "conflict"; current: TeamWorkspace }
  | { status: "forbidden" }
  | { status: "not-found" };

export async function updateTeamWorkspace(
  input: {
    actorIdentity: string;
    ownerIdentity: string;
    workspaceId: string;
    expectedRevision: number;
    name: string;
    consent: boolean;
  },
  runtime: TeamStorageRuntime = {},
): Promise<TeamMutationResult> {
  requireConsent(input.consent);
  const name = teamWorkspaceName(input.name);
  const timestamp = currentTime(runtime).toISOString();
  return mutateEnvelope(input.ownerIdentity, runtime, (envelope) => {
    const workspace = envelope.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) return { status: "not-found" } as const;
    if (!teamPermission(publicWorkspace(workspace), input.actorIdentity, "write")) {
      return { status: "forbidden" } as const;
    }
    if (workspace.revision !== input.expectedRevision) {
      return { status: "conflict", current: publicWorkspace(workspace) } as const;
    }
    workspace.name = name;
    bump(envelope, workspace, timestamp);
    return { status: "saved", workspace: publicWorkspace(workspace) } as const;
  });
}

export async function createTeamWorkspaceInvite(
  input: {
    actorIdentity: string;
    ownerIdentity: string;
    workspaceId: string;
    expectedRevision: number;
    role: "editor" | "viewer";
    expiresAt: string;
    consent: boolean;
    secret: string;
    maxCollaborators: number;
  },
  runtime: TeamStorageRuntime = {},
): Promise<
  | { status: "created"; workspace: TeamWorkspace; invite: TeamInvite; capability: string }
  | { status: "conflict"; current: TeamWorkspace }
  | { status: "forbidden" }
  | { status: "not-found" }
> {
  requireConsent(input.consent);
  if (input.role !== "editor" && input.role !== "viewer") {
    throw new TeamWorkspaceValidationError("Team invite role is invalid.");
  }
  if (!Number.isSafeInteger(input.maxCollaborators) || input.maxCollaborators < 1 || input.maxCollaborators > 100) {
    throw new TeamWorkspaceValidationError("Team collaborator entitlement is invalid.");
  }
  const now = currentTime(runtime);
  const expiresAt = new Date(input.expiresAt);
  if (
    !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() <= now.getTime()
    || expiresAt.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1_000
  ) {
    throw new TeamWorkspaceValidationError("Team invite expiry is invalid.");
  }
  const inviteId = nextId(runtime);
  const capability = createTeamInviteCapability({
    ownerIdentity: input.ownerIdentity,
    workspaceId: input.workspaceId,
    inviteId,
    role: input.role,
    expiresAt: expiresAt.toISOString(),
  }, input.secret);
  const timestamp = now.toISOString();
  return mutateEnvelope(input.ownerIdentity, runtime, (envelope) => {
    const workspace = envelope.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) return { status: "not-found" } as const;
    if (!teamPermission(publicWorkspace(workspace), input.actorIdentity, "manage")) {
      return { status: "forbidden" } as const;
    }
    if (workspace.revision !== input.expectedRevision) {
      return { status: "conflict", current: publicWorkspace(workspace) } as const;
    }
    if (collaboratorCount(workspace) >= input.maxCollaborators) {
      throw new TeamWorkspaceValidationError("Team collaborator entitlement limit reached.");
    }
    if (workspace.invites.length >= MAX_INVITES_PER_WORKSPACE) {
      throw new TeamWorkspaceValidationError("Team workspace invite limit reached.");
    }
    const invite: StoredTeamInvite = {
      id: inviteId,
      role: input.role,
      createdAt: timestamp,
      expiresAt: expiresAt.toISOString(),
      acceptedAt: null,
      acceptedBy: null,
      capabilityHash: hashTeamInviteCapability(capability),
      maxCollaborators: input.maxCollaborators,
    };
    workspace.invites.push(invite);
    bump(envelope, workspace, timestamp);
    return {
      status: "created",
      workspace: publicWorkspace(workspace),
      invite: publicInvite(invite),
      capability,
    } as const;
  });
}

export async function acceptTeamWorkspaceInvite(
  input: {
    capability: string;
    memberIdentity: string;
    consent: boolean;
    secret: string;
  },
  runtime: TeamStorageRuntime = {},
): Promise<
  | { status: "accepted" | "already-accepted"; workspace: TeamWorkspace }
  | { status: "not-found" }
> {
  requireConsent(input.consent);
  if (!validTeamIdentity(input.memberIdentity)) {
    throw new TeamWorkspaceValidationError("Team member identity is invalid.");
  }
  const now = currentTime(runtime);
  const payload = verifyTeamInviteCapability(input.capability, input.secret, now);
  if (!payload) throw new TeamWorkspaceValidationError("Team invite is invalid or expired.");
  const capabilityHash = hashTeamInviteCapability(input.capability);
  const timestamp = now.toISOString();
  const result = await mutateEnvelope(payload.ownerIdentity, runtime, (envelope) => {
    const workspace = envelope.workspaces.find((item) => item.id === payload.workspaceId);
    const invite = workspace?.invites.find((item) =>
      item.id === payload.inviteId && item.capabilityHash === capabilityHash);
    if (!workspace || !invite || invite.role !== payload.role) return { status: "not-found" } as const;
    if (invite.acceptedAt) {
      return invite.acceptedBy === input.memberIdentity
        ? { status: "already-accepted", workspace: publicWorkspace(workspace) } as const
        : { status: "not-found" } as const;
    }
    const existingMember = workspace.members.some(
      (member) => member.identity === input.memberIdentity,
    );
    if (!existingMember && collaboratorCount(workspace) >= invite.maxCollaborators) {
      throw new TeamWorkspaceValidationError("Team collaborator entitlement limit reached.");
    }
    if (!existingMember) {
      workspace.members.push({
        identity: input.memberIdentity,
        role: invite.role,
        joinedAt: timestamp,
        consentedAt: timestamp,
      });
    }
    invite.acceptedAt = timestamp;
    invite.acceptedBy = input.memberIdentity;
    bump(envelope, workspace, timestamp);
    return { status: "accepted", workspace: publicWorkspace(workspace) } as const;
  });
  if (
    result.status !== "not-found"
    && payload.ownerIdentity !== input.memberIdentity
  ) {
    await mutateEnvelope(input.memberIdentity, runtime, (envelope) => {
      if (!envelope.memberships.some((item) =>
        item.ownerIdentity === payload.ownerIdentity
        && item.workspaceId === payload.workspaceId)) {
        envelope.memberships.push({
          ownerIdentity: payload.ownerIdentity,
          workspaceId: payload.workspaceId,
          joinedAt: result.workspace.members.find((member) =>
            member.identity === input.memberIdentity)?.joinedAt ?? timestamp,
        });
        envelope.revision += 1;
        envelope.updatedAt = timestamp;
      }
    });
  }
  return result;
}

export async function changeTeamMemberRole(
  input: {
    actorIdentity: string;
    ownerIdentity: string;
    workspaceId: string;
    memberIdentity: string;
    role: "editor" | "viewer";
    expectedRevision: number;
    consent: boolean;
  },
  runtime: TeamStorageRuntime = {},
): Promise<TeamMutationResult> {
  requireConsent(input.consent);
  if (input.role !== "editor" && input.role !== "viewer") {
    throw new TeamWorkspaceValidationError("Team member role is invalid.");
  }
  const timestamp = currentTime(runtime).toISOString();
  return mutateEnvelope(input.ownerIdentity, runtime, (envelope) => {
    const workspace = envelope.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) return { status: "not-found" } as const;
    if (!teamPermission(publicWorkspace(workspace), input.actorIdentity, "manage")) {
      return { status: "forbidden" } as const;
    }
    if (workspace.revision !== input.expectedRevision) {
      return { status: "conflict", current: publicWorkspace(workspace) } as const;
    }
    const member = workspace.members.find((item) => item.identity === input.memberIdentity);
    if (!member || member.role === "owner") return { status: "not-found" } as const;
    member.role = input.role;
    bump(envelope, workspace, timestamp);
    return { status: "saved", workspace: publicWorkspace(workspace) } as const;
  });
}

export type TeamProjectMutationResult =
  | { status: "saved"; workspace: TeamWorkspace; project: TeamSharedProject }
  | {
      status: "conflict";
      current: TeamWorkspace;
      currentProject?: TeamSharedProject;
    }
  | { status: "forbidden" }
  | { status: "not-found" };

export async function upsertTeamWorkspaceProject(
  input: {
    actorIdentity: string;
    ownerIdentity: string;
    workspaceId: string;
    expectedWorkspaceRevision: number;
    expectedProjectRevision: number;
    project: unknown;
    consent: boolean;
  },
  runtime: TeamStorageRuntime = {},
): Promise<TeamProjectMutationResult> {
  requireConsent(input.consent);
  if (
    !Number.isSafeInteger(input.expectedWorkspaceRevision)
    || input.expectedWorkspaceRevision < 1
    || !Number.isSafeInteger(input.expectedProjectRevision)
    || input.expectedProjectRevision < 0
  ) {
    throw new TeamWorkspaceValidationError("Shared project revision is invalid.");
  }
  const timestamp = currentTime(runtime).toISOString();
  return mutateEnvelope(input.ownerIdentity, runtime, (envelope) => {
    const workspace = envelope.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) return { status: "not-found" } as const;
    if (!teamPermission(publicWorkspace(workspace), input.actorIdentity, "write")) {
      return { status: "forbidden" } as const;
    }
    const draft = sanitizeMemberProjectDraft(input.project);
    const current = workspace.projects.find((item) => item.projectId === draft.id);
    if (
      workspace.revision !== input.expectedWorkspaceRevision
      || (current?.revision ?? 0) !== input.expectedProjectRevision
    ) {
      return {
        status: "conflict",
        current: publicWorkspace(workspace),
        ...(current ? { currentProject: structuredClone(current) } : {}),
      } as const;
    }
    if (!current && workspace.projects.length >= MAX_PROJECTS_PER_WORKSPACE) {
      throw new TeamWorkspaceValidationError("Team workspace shared project limit reached.");
    }
    const project: TeamSharedProject = {
      projectId: draft.id,
      revision: (current?.revision ?? 0) + 1,
      draft: structuredClone(draft),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedBy: input.actorIdentity,
    };
    if (current) Object.assign(current, project);
    else workspace.projects.push(project);
    bump(envelope, workspace, timestamp);
    return {
      status: "saved",
      workspace: publicWorkspace(workspace),
      project: structuredClone(project),
    } as const;
  });
}
