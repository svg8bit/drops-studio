import type { GeneratedProject } from "./project-types.ts";
import { PROJECTS_STORAGE_KEY } from "./project-types.ts";

export const PROJECT_STORE_LOCK_NAME = "drops-studio-project-store";
export const PROJECT_STORE_ITEM_PREFIX = `${PROJECTS_STORAGE_KEY}:item:`;
export const PROJECT_STORE_LIMIT = 50;

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

function itemKey(projectId: string): string {
  return `${PROJECT_STORE_ITEM_PREFIX}${encodeURIComponent(projectId)}`;
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

function storedItems(storage: StorageLike): StoredProjectItem[] {
  const items: StoredProjectItem[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PROJECT_STORE_ITEM_PREFIX)) continue;
    const item = parseItem(storage.getItem(key));
    if (item) items.push(item);
  }
  return items;
}

function storedItemKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PROJECT_STORE_ITEM_PREFIX)) keys.push(key);
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
  storage: StorageLike = window.localStorage,
): GeneratedProject[] {
  const projects = new Map<string, GeneratedProject>();
  for (const project of parseLegacyProjects(storage.getItem(PROJECTS_STORAGE_KEY))) {
    projects.set(project.id, project);
  }
  for (const item of storedItems(storage)) {
    const current = projects.get(item.project.id);
    if (!current || timestamp(item.project) >= timestamp(current)) {
      projects.set(item.project.id, item.project);
    }
  }
  return [...projects.values()]
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, PROJECT_STORE_LIMIT);
}

function restoreValue(storage: StorageLike, key: string, value: string | null): void {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
}

function writeProject(
  project: GeneratedProject,
  storage: StorageLike,
  expectedUpdatedAt: string | null | undefined,
): ProjectStoreWriteResult {
  const projects = readProjectsFromStore(storage);
  const current = projects.find((item) => item.id === project.id);
  if (
    (expectedUpdatedAt === null && current)
    || (typeof expectedUpdatedAt === "string" && current?.updatedAt !== expectedUpdatedAt)
  ) {
    return { status: "conflict", projects, ...(current ? { current } : {}) };
  }

  const key = itemKey(project.id);
  const currentItem = parseItem(storage.getItem(key));
  const version = (currentItem?.version ?? 0) + 1;
  const retainedExisting = projects
    .filter((item) => item.id !== project.id)
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, PROJECT_STORE_LIMIT - 1);
  const merged = [project, ...retainedExisting]
    .sort((left, right) => timestamp(right) - timestamp(left));
  const compatibilityIndex = merged.map(compactProjectForCompatibilityIndex);
  const retainedKeys = new Set(merged.map((item) => itemKey(item.id)));
  const evictedItems = storedItemKeys(storage)
    .filter((storedKey) => !retainedKeys.has(storedKey))
    .map((storedKey) => ({ key: storedKey, value: storage.getItem(storedKey) }));
  const previousItem = storage.getItem(key);
  const previousIndex = storage.getItem(PROJECTS_STORAGE_KEY);
  let itemWritten = false;
  let indexWritten = false;
  const removedItems: Array<{ key: string; value: string | null }> = [];

  try {
    // Compact the compatibility index first so an existing full Project V2
    // snapshot cannot consume the quota needed by the canonical item record.
    storage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(compatibilityIndex));
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
      if (indexWritten) restoreValue(storage, PROJECTS_STORAGE_KEY, previousIndex);
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
  } = {},
): Promise<ProjectStoreWriteResult> {
  const storage = options.storage ?? window.localStorage;
  const detectedLocks = options.locks === undefined
    ? (typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as unknown as LockManagerLike
        : null)
    : options.locks;
  const write = () => writeProject(project, storage, options.expectedUpdatedAt);
  if (detectedLocks) {
    return detectedLocks.request(PROJECT_STORE_LOCK_NAME, { mode: "exclusive" }, write);
  }
  return write();
}

function deleteProject(
  projectId: string,
  storage: StorageLike,
  expectedUpdatedAt?: string,
): ProjectStoreDeleteResult {
  const projects = readProjectsFromStore(storage);
  const current = projects.find((project) => project.id === projectId);
  if (!current) return { status: "not-found", projects };
  if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
    return { status: "conflict", projects, current };
  }

  const key = itemKey(projectId);
  const previousItem = storage.getItem(key);
  const previousIndex = storage.getItem(PROJECTS_STORAGE_KEY);
  const remaining = projects.filter((project) => project.id !== projectId);
  try {
    storage.removeItem(key);
    storage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify(remaining.map(compactProjectForCompatibilityIndex)),
    );
  } catch (error) {
    try {
      restoreValue(storage, key, previousItem);
      restoreValue(storage, PROJECTS_STORAGE_KEY, previousIndex);
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
  } = {},
): Promise<ProjectStoreDeleteResult> {
  const storage = options.storage ?? window.localStorage;
  const detectedLocks = options.locks === undefined
    ? (typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as unknown as LockManagerLike
        : null)
    : options.locks;
  const remove = () => deleteProject(
    projectId,
    storage,
    options.expectedUpdatedAt,
  );
  if (detectedLocks) {
    return detectedLocks.request(
      PROJECT_STORE_LOCK_NAME,
      { mode: "exclusive" },
      remove,
    );
  }
  return remove();
}
