export type ProjectDataJsonPrimitive = boolean | number | string | null;
export type ProjectDataJsonValue =
  | ProjectDataJsonPrimitive
  | ProjectDataJsonValue[]
  | ProjectDataJsonObject;

export interface ProjectDataJsonObject {
  [key: string]: ProjectDataJsonValue;
}

export interface ProjectDataDocument {
  projectId: string;
  namespace: string;
  id: string;
  revision: number;
  data: ProjectDataJsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDataQuotas {
  maxNamespacesPerProject: number;
  maxDocumentsPerNamespace: number;
  maxDocumentBytes: number;
  maxProjectBytes: number;
  maxJsonDepth: number;
  maxJsonNodes: number;
}

export const DEFAULT_PROJECT_DATA_QUOTAS: ProjectDataQuotas = Object.freeze({
  maxNamespacesPerProject: 16,
  maxDocumentsPerNamespace: 500,
  maxDocumentBytes: 64 * 1_024,
  maxProjectBytes: 2 * 1_024 * 1_024,
  maxJsonDepth: 20,
  maxJsonNodes: 4_096,
});

export type ProjectDataErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "secret_rejected"
  | "storage_unavailable";

export class ProjectDataError extends Error {
  readonly code: ProjectDataErrorCode;
  readonly status: number;
  readonly currentRevision?: number;

  constructor(
    code: ProjectDataErrorCode,
    message: string,
    options: { status?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = "ProjectDataError";
    this.code = code;
    this.status = options.status ?? ({
      invalid_request: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      rate_limited: 429,
      quota_exceeded: 413,
      secret_rejected: 400,
      storage_unavailable: 503,
    } satisfies Record<ProjectDataErrorCode, number>)[code];
    this.currentRevision = options.currentRevision;
  }
}

export interface ProjectDataProjectSnapshot {
  schemaVersion: 1;
  projectId: string;
  storeRevision: number;
  documents: Record<string, ProjectDataDocument>;
}

export interface ProjectDataBackend {
  readonly kind:
    | "memory-local-fallback"
    | "browser-local-fallback"
    | "vercel-blob-private"
    | "neon-postgres";
  read(projectId: string): Promise<ProjectDataProjectSnapshot | null>;
  compareAndSwap(
    projectId: string,
    expectedStoreRevision: number,
    next: ProjectDataProjectSnapshot,
  ): Promise<void>;
  deleteProject(projectId: string, expectedStoreRevision: number): Promise<void>;
}

export type ProjectDataPermission = "read" | "write" | "delete";

export interface ProjectDataCapabilityPayload {
  version: 1;
  projectId: string;
  subject: string;
  namespaces: string[];
  permissions: ProjectDataPermission[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}
