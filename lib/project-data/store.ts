import {
  ProjectDataError,
  type ProjectDataBackend,
  type ProjectDataDocument,
  type ProjectDataProjectSnapshot,
  type ProjectDataQuotas,
} from "./types.ts";
import {
  projectDataByteLength,
  resolvedProjectDataQuotas,
  sanitizeProjectDataDocument,
  validateExpectedRevision,
  validateProjectDataDocumentId,
  validateProjectDataNamespace,
  validateProjectDataProjectId,
} from "./validation.ts";

function documentKey(namespace: string, id: string): string {
  return `${namespace}\u0000${id}`;
}

function emptySnapshot(projectId: string): ProjectDataProjectSnapshot {
  return { schemaVersion: 1, projectId, storeRevision: 0, documents: {} };
}

function cloneDocument(document: ProjectDataDocument): ProjectDataDocument {
  return structuredClone(document);
}

export class ProjectDataStore {
  readonly backend: ProjectDataBackend;
  readonly quotas: ProjectDataQuotas;
  private readonly now: () => string;

  constructor(
    backend: ProjectDataBackend,
    options: {
      quotas?: Partial<ProjectDataQuotas>;
      now?: () => string;
    } = {},
  ) {
    this.backend = backend;
    this.quotas = resolvedProjectDataQuotas(options.quotas);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async snapshot(projectId: string): Promise<ProjectDataProjectSnapshot> {
    return await this.backend.read(projectId) ?? emptySnapshot(projectId);
  }

  private validateSnapshotQuota(snapshot: ProjectDataProjectSnapshot): void {
    if (projectDataByteLength(snapshot) > this.quotas.maxProjectBytes) {
      throw new ProjectDataError("quota_exceeded", "Project data exceeds the per-project byte quota.");
    }
  }

  async get(projectIdInput: unknown, namespaceInput: unknown, idInput: unknown): Promise<ProjectDataDocument | null> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    const namespace = validateProjectDataNamespace(namespaceInput);
    const id = validateProjectDataDocumentId(idInput);
    const snapshot = await this.snapshot(projectId);
    const document = snapshot.documents[documentKey(namespace, id)];
    return document ? cloneDocument(document) : null;
  }

  async list(projectIdInput: unknown, namespaceInput: unknown): Promise<ProjectDataDocument[]> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    const namespace = validateProjectDataNamespace(namespaceInput);
    const snapshot = await this.snapshot(projectId);
    return Object.values(snapshot.documents)
      .filter((document) => document.namespace === namespace)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map(cloneDocument);
  }

  async create(input: {
    projectId: unknown;
    namespace: unknown;
    id: unknown;
    data: unknown;
  }): Promise<ProjectDataDocument> {
    const projectId = validateProjectDataProjectId(input.projectId);
    const namespace = validateProjectDataNamespace(input.namespace);
    const id = validateProjectDataDocumentId(input.id);
    const data = sanitizeProjectDataDocument(input.data, this.quotas);
    const snapshot = await this.snapshot(projectId);
    const key = documentKey(namespace, id);
    if (snapshot.documents[key]) {
      throw new ProjectDataError("conflict", "Project data document already exists.", {
        currentRevision: snapshot.documents[key].revision,
      });
    }
    const namespaceDocuments = Object.values(snapshot.documents).filter((document) => document.namespace === namespace);
    if (namespaceDocuments.length >= this.quotas.maxDocumentsPerNamespace) {
      throw new ProjectDataError("quota_exceeded", "Project data namespace reached its document quota.");
    }
    const namespaces = new Set(Object.values(snapshot.documents).map((document) => document.namespace));
    if (!namespaces.has(namespace) && namespaces.size >= this.quotas.maxNamespacesPerProject) {
      throw new ProjectDataError("quota_exceeded", "Project data reached its namespace quota.");
    }
    const timestamp = this.now();
    const document: ProjectDataDocument = {
      projectId,
      namespace,
      id,
      revision: 1,
      data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next: ProjectDataProjectSnapshot = {
      ...snapshot,
      storeRevision: snapshot.storeRevision + 1,
      documents: { ...snapshot.documents, [key]: document },
    };
    this.validateSnapshotQuota(next);
    await this.backend.compareAndSwap(projectId, snapshot.storeRevision, next);
    return cloneDocument(document);
  }

  async update(input: {
    projectId: unknown;
    namespace: unknown;
    id: unknown;
    expectedRevision: unknown;
    data: unknown;
  }): Promise<ProjectDataDocument> {
    const projectId = validateProjectDataProjectId(input.projectId);
    const namespace = validateProjectDataNamespace(input.namespace);
    const id = validateProjectDataDocumentId(input.id);
    const expectedRevision = validateExpectedRevision(input.expectedRevision);
    const data = sanitizeProjectDataDocument(input.data, this.quotas);
    const snapshot = await this.snapshot(projectId);
    const key = documentKey(namespace, id);
    const current = snapshot.documents[key];
    if (!current) throw new ProjectDataError("not_found", "Project data document was not found.");
    if (current.revision !== expectedRevision) {
      throw new ProjectDataError("conflict", "Project data document changed concurrently. Refresh and retry.", {
        currentRevision: current.revision,
      });
    }
    const document: ProjectDataDocument = {
      ...current,
      revision: current.revision + 1,
      data,
      updatedAt: this.now(),
    };
    const next: ProjectDataProjectSnapshot = {
      ...snapshot,
      storeRevision: snapshot.storeRevision + 1,
      documents: { ...snapshot.documents, [key]: document },
    };
    this.validateSnapshotQuota(next);
    await this.backend.compareAndSwap(projectId, snapshot.storeRevision, next);
    return cloneDocument(document);
  }

  async delete(
    projectIdInput: unknown,
    namespaceInput: unknown,
    idInput: unknown,
    expectedRevisionInput: unknown,
  ): Promise<void> {
    const projectId = validateProjectDataProjectId(projectIdInput);
    const namespace = validateProjectDataNamespace(namespaceInput);
    const id = validateProjectDataDocumentId(idInput);
    const expectedRevision = validateExpectedRevision(expectedRevisionInput);
    const snapshot = await this.snapshot(projectId);
    const key = documentKey(namespace, id);
    const current = snapshot.documents[key];
    if (!current) throw new ProjectDataError("not_found", "Project data document was not found.");
    if (current.revision !== expectedRevision) {
      throw new ProjectDataError("conflict", "Project data document changed concurrently. Refresh and retry.", {
        currentRevision: current.revision,
      });
    }
    const documents = { ...snapshot.documents };
    delete documents[key];
    const next: ProjectDataProjectSnapshot = {
      ...snapshot,
      storeRevision: snapshot.storeRevision + 1,
      documents,
    };
    await this.backend.compareAndSwap(projectId, snapshot.storeRevision, next);
  }
}
