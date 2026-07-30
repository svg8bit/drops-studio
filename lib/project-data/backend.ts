import {
  ProjectDataError,
  type ProjectDataBackend,
  type ProjectDataProjectSnapshot,
} from "./types.ts";
import { validateProjectDataProjectId } from "./validation.ts";

export interface ProjectDataWebStorage {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function cloneSnapshot(snapshot: ProjectDataProjectSnapshot): ProjectDataProjectSnapshot {
  return structuredClone(snapshot);
}

function emptyRevision(snapshot: ProjectDataProjectSnapshot | null): number {
  return snapshot?.storeRevision ?? 0;
}

export class MemoryProjectDataBackend implements ProjectDataBackend {
  readonly kind = "memory-local-fallback" as const;
  private readonly snapshots = new Map<string, ProjectDataProjectSnapshot>();

  async read(projectId: string): Promise<ProjectDataProjectSnapshot | null> {
    const snapshot = this.snapshots.get(projectId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async compareAndSwap(
    projectId: string,
    expectedStoreRevision: number,
    next: ProjectDataProjectSnapshot,
  ): Promise<void> {
    const current = this.snapshots.get(projectId) ?? null;
    if (emptyRevision(current) !== expectedStoreRevision) {
      throw new ProjectDataError("conflict", "Project data changed concurrently. Refresh and retry.", {
        currentRevision: emptyRevision(current),
      });
    }
    this.snapshots.set(projectId, cloneSnapshot(next));
  }

  async deleteProject(projectId: string, expectedStoreRevision: number): Promise<void> {
    const current = this.snapshots.get(projectId) ?? null;
    if (emptyRevision(current) !== expectedStoreRevision) {
      throw new ProjectDataError("conflict", "Project data changed concurrently. Refresh and retry.", {
        currentRevision: emptyRevision(current),
      });
    }
    this.snapshots.delete(projectId);
  }
}

const WEB_STORAGE_PREFIX = "drops-studio-project-data-v2:";

export class WebStorageProjectDataBackend implements ProjectDataBackend {
  readonly kind = "browser-local-fallback" as const;
  private readonly storage: ProjectDataWebStorage;

  constructor(storage: ProjectDataWebStorage) {
    this.storage = storage;
  }

  private storageKey(projectId: string): string {
    return `${WEB_STORAGE_PREFIX}${encodeURIComponent(projectId)}`;
  }

  async read(projectId: string): Promise<ProjectDataProjectSnapshot | null> {
    validateProjectDataProjectId(projectId);
    const raw = this.storage.getItem(this.storageKey(projectId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ProjectDataProjectSnapshot;
      if (
        parsed.schemaVersion !== 1
        || parsed.projectId !== projectId
        || !Number.isSafeInteger(parsed.storeRevision)
        || parsed.storeRevision < 1
        || !parsed.documents
        || typeof parsed.documents !== "object"
        || Array.isArray(parsed.documents)
      ) {
        throw new Error("invalid snapshot");
      }
      return cloneSnapshot(parsed);
    } catch {
      throw new ProjectDataError("storage_unavailable", "Browser project data fallback is corrupt or unavailable.");
    }
  }

  async compareAndSwap(
    projectId: string,
    expectedStoreRevision: number,
    next: ProjectDataProjectSnapshot,
  ): Promise<void> {
    const current = await this.read(projectId);
    if (emptyRevision(current) !== expectedStoreRevision) {
      throw new ProjectDataError("conflict", "Project data changed in another browser context. Refresh and retry.", {
        currentRevision: emptyRevision(current),
      });
    }
    try {
      this.storage.setItem(this.storageKey(projectId), JSON.stringify(next));
    } catch {
      throw new ProjectDataError("storage_unavailable", "Browser project data fallback could not persist this change.");
    }
  }

  async deleteProject(projectId: string, expectedStoreRevision: number): Promise<void> {
    const current = await this.read(projectId);
    if (emptyRevision(current) !== expectedStoreRevision) {
      throw new ProjectDataError("conflict", "Project data changed in another browser context. Refresh and retry.", {
        currentRevision: emptyRevision(current),
      });
    }
    this.storage.removeItem(this.storageKey(projectId));
  }
}

declare global {
  // A durable adapter may be injected by the hosting layer. The route creates a
  // memory fallback only when its explicit local/demo flag is enabled.
  var __DROPS_STUDIO_PROJECT_DATA_BACKEND_V2__: ProjectDataBackend | undefined;
}
