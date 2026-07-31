export const MANAGED_ENVIRONMENTS = ["development", "preview", "production"] as const;
export type ManagedEnvironment = (typeof MANAGED_ENVIRONMENTS)[number];

export interface ManagedScope {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  environment: ManagedEnvironment;
  scopeKey: string;
}

export interface ManagedPrincipal {
  actorId: string;
  actorType: "user" | "service-account" | "system" | "agent";
  scope: ManagedScope;
  roles: string[];
  permissions: string[];
}

export type ManagedFieldType =
  | "string"
  | "text"
  | "integer"
  | "float"
  | "boolean"
  | "datetime"
  | "json"
  | "enum"
  | "reference"
  | "user-reference"
  | "file-reference";

export interface ManagedFieldSchema {
  type: ManagedFieldType;
  required?: boolean;
  default?: unknown;
  enumValues?: string[];
  referenceCollection?: string;
  deprecated?: boolean;
}

export interface ManagedCollectionSchema {
  name: string;
  rowPolicy: "project" | "owner" | "roles";
  allowedRoles?: string[];
  fields: Record<string, ManagedFieldSchema>;
  indexes: Array<{ name: string; fields: string[]; unique?: boolean }>;
}

export interface ManagedSchemaSnapshot {
  version: number;
  collections: Record<string, ManagedCollectionSchema>;
  hash: string;
  updatedAt: string;
}

export type ManagedMigrationOperation =
  | { kind: "create-collection"; collection: ManagedCollectionSchema }
  | { kind: "add-field"; collection: string; field: string; definition: ManagedFieldSchema }
  | { kind: "rename-field"; collection: string; from: string; to: string }
  | { kind: "deprecate-field"; collection: string; field: string }
  | { kind: "add-index"; collection: string; index: ManagedCollectionSchema["indexes"][number] };

export interface ManagedMigrationPlan {
  id: string;
  scopeKey: string;
  fromVersion: number;
  toVersion: number;
  operations: ManagedMigrationOperation[];
  destructive: boolean;
  warnings: string[];
  requiresApproval: boolean;
  checksum: string;
  createdAt: string;
}

export interface ManagedRecord {
  _id: string;
  _revision: number;
  _ownerId: string;
  _createdAt: string;
  _updatedAt: string;
  [field: string]: unknown;
}

export type ManagedFilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";
export interface ManagedQuery {
  filters?: Array<{ field: string; operator: ManagedFilterOperator; value: unknown }>;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  limit?: number;
  cursor?: string;
}

export interface ManagedProviderStatus {
  kind: "d1-drizzle" | "postgres-drizzle";
  status: "working" | "setup-required" | "unavailable";
  reasonCode?: string;
}

export interface ManagedTransaction {
  execute(statement: string, parameters: readonly unknown[]): Promise<{ rows: unknown[]; affectedRows: number }>;
}

/** Binding supplied by a Cloudflare-compatible D1/Drizzle deployment. */
export interface D1ManagedPlatformDriver {
  readonly kind: "d1-drizzle";
  transaction<T>(scope: ManagedScope, operation: (transaction: ManagedTransaction) => Promise<T>): Promise<T>;
  health(): Promise<{ status: "working" | "degraded"; latencyMs: number }>;
}

/** Pool supplied by a configured Postgres/Drizzle deployment. */
export interface PostgresManagedPlatformDriver {
  readonly kind: "postgres-drizzle";
  transaction<T>(scope: ManagedScope, operation: (transaction: ManagedTransaction) => Promise<T>): Promise<T>;
  health(): Promise<{ status: "working" | "degraded"; latencyMs: number }>;
}

export interface ControlPlaneStore {
  readonly provider: ManagedProviderStatus;
  ensureEnvironment(scope: ManagedScope): Promise<void>;
}

export interface ProjectDataStore {
  readonly provider: ManagedProviderStatus;
  schema(scope: ManagedScope): Promise<ManagedSchemaSnapshot>;
}

export interface ManagedEmailAdapter {
  readonly mode: "configured" | "test";
  deliverOneTimeCode(input: { scope: ManagedScope; email: string; code: string; expiresAt: string }): Promise<{ evidenceId: string }>;
}

export interface ObjectStorageAdapter {
  readonly mode: "configured" | "test";
  put(namespace: string, key: string, bytes: Uint8Array, metadata: Record<string, string>): Promise<{ providerObjectId: string }>;
  get(namespace: string, providerObjectId: string): Promise<Uint8Array>;
  delete(namespace: string, providerObjectId: string): Promise<void>;
}

export interface ManagedFunctionManifest {
  name: string;
  version: number;
  timeoutMs: number;
  input: Record<string, ManagedFieldType>;
  output: Record<string, ManagedFieldType>;
  allowedNetworkHosts: string[];
  secretReferences: string[];
}

export interface FunctionRuntimeAdapter {
  readonly mode: "configured" | "test" | "setup-required";
  invoke(manifest: ManagedFunctionManifest, input: Record<string, unknown>, context: { scope: ManagedScope; signal: AbortSignal }): Promise<Record<string, unknown>>;
}

export interface JobQueueAdapter {
  readonly mode: "configured" | "test" | "setup-required";
}
export interface CronAdapter {
  readonly mode: "configured" | "test" | "setup-required";
}
export interface RealtimeAdapter {
  readonly mode: "websocket" | "sse" | "polling" | "in-memory-test" | "setup-required";
}
export interface SecretVaultAdapter {
  readonly mode: "configured" | "in-memory-test" | "setup-required";
}

export interface ManagedLogEntry {
  id: string;
  scopeKey: string;
  category: "auth" | "storage" | "function" | "webhook" | "job" | "cron" | "realtime" | "schema" | "data" | "backup" | "secret";
  severity: "info" | "warning" | "error";
  action: string;
  actorId: string;
  requestId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ManagedPlatformLimits {
  maxRowsPerEnvironment: number;
  maxQueryComplexity: number;
  maxObjectBytes: number;
  maxObjectsPerEnvironment: number;
  maxObjectBytesPerEnvironment: number;
  maxGuestUsersPerEnvironment: number;
  maxRealtimeEvents: number;
  maxRealtimeSubscriptions: number;
  maxJobsPerEnvironment: number;
}
