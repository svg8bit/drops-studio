import type { GeneratedProject } from "./project-types.ts";
import { PROJECTS_STORAGE_KEY } from "./project-types.ts";

export const PROJECT_STORE_LOCK_NAME = "drops-studio-project-store";
export const PROJECT_STORE_ITEM_PREFIX = `${PROJECTS_STORAGE_KEY}:item:`;
export const PROJECT_STORE_SCOPE_COOKIE = "drops_project_scope";
export const PROJECT_STORE_LEGACY_MIGRATION_KEY = `${PROJECTS_STORAGE_KEY}:legacy-owner:v1`;
export const PROJECT_STORE_LIMIT = 50;

export interface ProjectStoreScope {
  kind: "guest" | "member";
  identity: string;
}

interface ProjectStoreReadOptions {
  scope?: ProjectStoreScope | null;
}

interface ProjectStoreAccessOptions extends ProjectStoreReadOptions {
  storage?: StorageLike;
  locks?: LockManagerLike | null;
}

type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

type StoredProjectItem = {
  schemaVersion: 1;
  version: number;
  project: GeneratedProject;
};

export type ProjectStoreWriteResult =
  | { status: "saved"; projects: GeneratedProject[]; version: number }
  | { status: "conflict"; projects: GeneratedProject[]; current?: GeneratedProject };

export type ProjectStoreDeleteResult =
  | { status: "deleted"; projects: GeneratedProject[] }
  | { status: "not-found"; projects: GeneratedProject[] }
  | { status: "conflict"; projects: GeneratedProject[]; current: GeneratedProject };

function isProject(value: unknown): value is GeneratedProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<GeneratedProject>;
  return typeof project.id === "string"
    && project.id.length > 0
    && typeof project.html === "string"
    && typeof project.createdAt === "string"
    && typeof project.updatedAt === "string"
    && Boolean(project.spec && typeof project.spec === "object");
}

function parseLegacyProjects(value: string | null): GeneratedProject[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isProject) : [];
  } catch {
    return [];
  }
}

function normalizeScope(scope: ProjectStoreScope): ProjectStoreScope {
  if (
    (scope.kind !== "guest" && scope.kind !== "member")
    || !/^[a-f0-9]{64}$/.test(scope.identity)
  ) {
    throw new Error("Project storage requires a valid signed actor scope.");
  }
  return { kind: scope.kind, identity: scope.identity };
}

export function projectStoreScopeCookieValue(scope: ProjectStoreScope): string {
  const normalized = normalizeScope(scope);
  return `${normalized.kind}.${normalized.identity}`;
}

export function parseProjectStoreScopeCookieValue(
  value: string | null | undefined,
): ProjectStoreScope | null {
  const match = /^(guest|member)\.([a-f0-9]{64})$/.exec(value?.trim() ?? "");
  return match
    ? { kind: match[1] as ProjectStoreScope["kind"], identity: match[2] }
    : null;
}

function browserProjectStoreScope(): ProjectStoreScope | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== PROJECT_STORE_SCOPE_COOKIE) continue;
    try {
      return parseProjectStoreScopeCookieValue(
        decodeURIComponent(part.slice(separator + 1).trim()),
      );
    } catch {
      return null;
    }
  }
  return null;
}

function scopeNamespace(scope: ProjectStoreScope): string {
  const normalized = normalizeScope(scope);
  return `${PROJECTS_STORAGE_KEY}:scope:${normalized.kind}:${normalized.identity}`;
}

export function projectStoreIndexKey(scope: ProjectStoreScope): string {
  return scopeNamespace(scope);
}

export function projectStoreItemPrefix(scope: ProjectStoreScope): string {
  return `${scopeNamespace(scope)}:item:`;
}

function itemKey(projectId: string, scope: ProjectStoreScope | null): string {
  const prefix = scope ? projectStoreItemPrefix(scope) : PROJECT_STORE_ITEM_PREFIX;
  return `${prefix}${encodeURIComponent(projectId)}`;
}

function parseItem(value: string | null): StoredProjectItem | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredProjectItem>;
    if (parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.version) || Number(parsed.version) < 1 || !isProject(parsed.project)) return null;
    return parsed as StoredProjectItem;
  } catch {
    return null;
  }
}

function storedItems(storage: StorageLike, prefix = PROJECT_STORE_ITEM_PREFIX): StoredProjectItem[] {
  const items: StoredProjectItem[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const item = parseItem(storage.getItem(key));
    if (item) items.push(item);
  }
  return items;
}

function storedItemKeys(storage: StorageLike, prefix = PROJECT_STORE_ITEM_PREFIX): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function timestamp(project: GeneratedProject): number {
  const updated = Date.parse(project.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(project.createdAt);
  return Number.isFinite(created) ? created : 0;
}

function compactProjectForCompatibilityIndex(
  project: GeneratedProject,
): GeneratedProject {
  const compact = { ...project };
  Reflect.deleteProperty(compact, "projectV2");
  return compact;
}

export function readProjectsFromStore(
  storage?: StorageLike,
  options: ProjectStoreReadOptions = {},
): GeneratedProject[] {
  const browserDefault = storage === undefined;
  const resolvedStorage = storage ?? window.localStorage;
  const scope = options.scope === undefined
    ? browserDefault ? browserProjectStoreScope() : null
    : options.scope ? normalizeScope(options.scope) : null;
  if (browserDefault && !scope) return [];
  return readProjects(resolvedStorage, scope);
}

function readProjects(
  storage: StorageLike,
  scope: ProjectStoreScope | null,
): GeneratedProject[] {
  const indexKey = scope ? projectStoreIndexKey(scope) : PROJECTS_STORAGE_KEY;
  const itemPrefix = scope ? projectStoreItemPrefix(scope) : PROJECT_STORE_ITEM_PREFIX;
  const projects = new Map<string, GeneratedProject>();
  for (const project of parseLegacyProjects(storage.getItem(indexKey))) {
    projects.set(project.id, project);
  }
  for (const item of storedItems(storage, itemPrefix)) {
    const current = projects.get(item.project.id);
    if (!current || timestamp(item.project) >= timestamp(current)) {
      projects.set(item.project.id, item.project);
    }
  }
  return [...projects.values()]
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, PROJECT_STORE_LIMIT);
}

export function isProjectStoreLegacyOwner(
  scope: ProjectStoreScope,
  storage: StorageLike = window.localStorage,
): boolean {
  return storage.getItem(PROJECT_STORE_LEGACY_MIGRATION_KEY)
    === projectStoreScopeCookieValue(scope);
}

function migrateLegacyProjectsToScope(
  scopeInput: ProjectStoreScope,
  storage: StorageLike = window.localStorage,
): boolean {
  const scope = normalizeScope(scopeInput);
  const owner = projectStoreScopeCookieValue(scope);
  const currentOwner = storage.getItem(PROJECT_STORE_LEGACY_MIGRATION_KEY);
  if (currentOwner) return currentOwner === owner;

  const merged = new Map<string, GeneratedProject>();
  for (const project of readProjects(storage, null)) merged.set(project.id, project);
  for (const project of readProjects(storage, scope)) {
    const current = merged.get(project.id);
    if (!current || timestamp(project) >= timestamp(current)) merged.set(project.id, project);
  }
  const projects = [...merged.values()]
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, PROJECT_STORE_LIMIT);
  const indexKey = projectStoreIndexKey(scope);
  const touched = new Map<string, string | null>();
  const remember = (key: string) => {
    if (!touched.has(key)) touched.set(key, storage.getItem(key));
  };

  try {
    remember(indexKey);
    storage.setItem(
      indexKey,
      JSON.stringify(projects.map(compactProjectForCompatibilityIndex)),
    );
    for (const project of projects) {
      const key = itemKey(project.id, scope);
      remember(key);
      const current = parseItem(storage.getItem(key));
      storage.setItem(key, JSON.stringify({
        schemaVersion: 1,
        version: current?.version ?? 1,
        project,
      } satisfies StoredProjectItem));
    }
    remember(PROJECT_STORE_LEGACY_MIGRATION_KEY);
    storage.setItem(PROJECT_STORE_LEGACY_MIGRATION_KEY, owner);
    return true;
  } catch {
    for (const [key, value] of [...touched.entries()].reverse()) {
      try {
        restoreValue(storage, key, value);
      } catch {
        // Keep the migration marker unclaimed so a later read can retry safely.
      }
    }
    return false;
  }
}

export async function claimLegacyProjectsSafely(
  options: ProjectStoreAccessOptions = {},
): Promise<boolean> {
  const browserDefault = options.storage === undefined;
  const storage = options.storage ?? window.localStorage;
  const scope = options.scope === undefined
    ? browserDefault ? browserProjectStoreScope() : null
    : options.scope ? normalizeScope(options.scope) : null;
  if (browserDefault && !scope) {
    throw new Error("Project storage is waiting for a signed actor scope.");
  }
  if (!scope) return true;
  const detectedLocks = options.locks === undefined
    ? (browserDefault && typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as unknown as LockManagerLike
        : null)
    : options.locks;
  const claim = () => migrateLegacyProjectsToScope(scope, storage);
  return detectedLocks
    ? detectedLocks.request(
        PROJECT_STORE_LOCK_NAME,
        { mode: "exclusive" },
        claim,
      )
    : claim();
}

export async function readProjectsAfterScopeBootstrap(
  establishActorScope: () => Promise<unknown>,
  options: ProjectStoreAccessOptions = {},
): Promise<GeneratedProject[]> {
  await establishActorScope();
  await claimLegacyProjectsSafely(options);
  return readProjectsFromStore(options.storage, { scope: options.scope });
}

function restoreValue(storage: StorageLike, key: string, value: string | null): void {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
}

function writeProject(
  project: GeneratedProject,
  storage: StorageLike,
  scope: ProjectStoreScope | null,
  expectedUpdatedAt: string | null | undefined,
): ProjectStoreWriteResult {
  const projects = readProjectsFromStore(storage, { scope });
  const current = projects.find((item) => item.id === project.id);
  if (
    (expectedUpdatedAt === null && current)
    || (typeof expectedUpdatedAt === "string" && current?.updatedAt !== expectedUpdatedAt)
  ) {
    return { status: "conflict", projects, ...(current ? { current } : {}) };
  }

  const key = itemKey(project.id, scope);
  const indexKey = scope ? projectStoreIndexKey(scope) : PROJECTS_STORAGE_KEY;
  const itemPrefix = scope ? projectStoreItemPrefix(scope) : PROJECT_STORE_ITEM_PREFIX;
  const currentItem = parseItem(storage.getItem(key));
  const version = (currentItem?.version ?? 0) + 1;
  const retainedExisting = projects
    .filter((item) => item.id !== project.id)
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, PROJECT_STORE_LIMIT - 1);
  const merged = [project, ...retainedExisting]
    .sort((left, right) => timestamp(right) - timestamp(left));
  const compatibilityIndex = merged.map(compactProjectForCompatibilityIndex);
  const retainedKeys = new Set(merged.map((item) => itemKey(item.id, scope)));
  const evictedItems = storedItemKeys(storage, itemPrefix)
    .filter((storedKey) => !retainedKeys.has(storedKey))
    .map((storedKey) => ({ key: storedKey, value: storage.getItem(storedKey) }));
  const previousItem = storage.getItem(key);
  const previousIndex = storage.getItem(indexKey);
  let itemWritten = false;
  let indexWritten = false;
  const removedItems: Array<{ key: string; value: string | null }> = [];

  try {
    // Compact the compatibility index first so an existing full Project V2
    // snapshot cannot consume the quota needed by the canonical item record.
    storage.setItem(indexKey, JSON.stringify(compatibilityIndex));
    indexWritten = true;
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, version, project } satisfies StoredProjectItem));
    itemWritten = true;
    for (const evicted of evictedItems) {
      storage.removeItem(evicted.key);
      removedItems.push(evicted);
    }
  } catch (error) {
    let rollbackFailed = false;
    try {
      if (itemWritten) restoreValue(storage, key, previousItem);
      if (indexWritten) restoreValue(storage, indexKey, previousIndex);
      for (const removed of removedItems) restoreValue(storage, removed.key, removed.value);
    } catch {
      rollbackFailed = true;
    }
    throw new Error(
      rollbackFailed
        ? "Project storage failed and could not be fully restored. Reload before editing again."
        : "Project could not be saved because browser storage is unavailable or full.",
      { cause: error },
    );
  }

  return { status: "saved", projects: merged, version };
}

export async function saveProjectSafely(
  project: GeneratedProject,
  options: {
    storage?: StorageLike;
    locks?: LockManagerLike | null;
    expectedUpdatedAt?: string | null;
    scope?: ProjectStoreScope | null;
  } = {},
): Promise<ProjectStoreWriteResult> {
  const browserDefault = options.storage === undefined;
  const storage = options.storage ?? window.localStorage;
  const scope = options.scope === undefined
    ? browserDefault ? browserProjectStoreScope() : null
    : options.scope ? normalizeScope(options.scope) : null;
  if (browserDefault && !scope) {
    throw new Error("Project storage is waiting for a signed actor scope.");
  }
  const detectedLocks = options.locks === undefined
    ? (browserDefault && typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as unknown as LockManagerLike
        : null)
    : options.locks;
  const write = () => {
    if (scope) migrateLegacyProjectsToScope(scope, storage);
    return writeProject(project, storage, scope, options.expectedUpdatedAt);
  };
  if (detectedLocks) {
    return detectedLocks.request(
      PROJECT_STORE_LOCK_NAME,
      { mode: "exclusive" },
      write,
    );
  }
  return write();
}

function deleteProject(
  projectId: string,
  storage: StorageLike,
  scope: ProjectStoreScope | null,
  expectedUpdatedAt?: string,
): ProjectStoreDeleteResult {
  const projects = readProjectsFromStore(storage, { scope });
  const current = projects.find((project) => project.id === projectId);
  if (!current) return { status: "not-found", projects };
  if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
    return { status: "conflict", projects, current };
  }

  const key = itemKey(projectId, scope);
  const indexKey = scope ? projectStoreIndexKey(scope) : PROJECTS_STORAGE_KEY;
  const previousItem = storage.getItem(key);
  const previousIndex = storage.getItem(indexKey);
  const remaining = projects.filter((project) => project.id !== projectId);
  try {
    storage.removeItem(key);
    storage.setItem(
      indexKey,
      JSON.stringify(remaining.map(compactProjectForCompatibilityIndex)),
    );
  } catch (error) {
    try {
      restoreValue(storage, key, previousItem);
      restoreValue(storage, indexKey, previousIndex);
    } catch {
      throw new Error(
        "Project deletion failed and browser storage could not be fully restored. Reload before continuing.",
        { cause: error },
      );
    }
    throw new Error("Project could not be deleted from browser storage.", {
      cause: error,
    });
  }
  return { status: "deleted", projects: remaining };
}

export async function deleteProjectSafely(
  projectId: string,
  options: {
    storage?: StorageLike;
    locks?: LockManagerLike | null;
    expectedUpdatedAt?: string;
    scope?: ProjectStoreScope | null;
  } = {},
): Promise<ProjectStoreDeleteResult> {
  const browserDefault = options.storage === undefined;
  const storage = options.storage ?? window.localStorage;
  const scope = options.scope === undefined
    ? browserDefault ? browserProjectStoreScope() : null
    : options.scope ? normalizeScope(options.scope) : null;
  if (browserDefault && !scope) {
    throw new Error("Project storage is waiting for a signed actor scope.");
  }
  const detectedLocks = options.locks === undefined
    ? (browserDefault && typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as unknown as LockManagerLike
        : null)
    : options.locks;
  const remove = () => {
    if (scope) migrateLegacyProjectsToScope(scope, storage);
    return deleteProject(
      projectId,
      storage,
      scope,
      options.expectedUpdatedAt,
    );
  };
  if (detectedLocks) {
    return detectedLocks.request(
      PROJECT_STORE_LOCK_NAME,
      { mode: "exclusive" },
      remove,
    );
  }
  return remove();
}
