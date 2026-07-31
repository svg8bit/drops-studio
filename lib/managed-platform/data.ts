import { randomUUID } from "node:crypto";
import type {
  ManagedCollectionSchema,
  ManagedFieldSchema,
  ManagedMigrationOperation,
  ManagedMigrationPlan,
  ManagedPlatformLimits,
  ManagedPrincipal,
  ManagedQuery,
  ManagedRecord,
  ManagedSchemaSnapshot,
  ManagedScope,
} from "./contracts.ts";
import {
  ManagedPlatformError,
  assertScope,
  clone,
  requireApproval,
  requirePermission,
  sha256,
  stableJson,
} from "./security.ts";

interface EnvironmentState {
  schema: ManagedSchemaSnapshot;
  rows: Map<string, Map<string, ManagedRecord>>;
  idempotency: Map<string, { fingerprint: string; value: ManagedRecord }>;
  migrations: Array<{ plan: ManagedMigrationPlan; before: ManagedSchemaSnapshot; after: ManagedSchemaSnapshot }>;
}

const NAME = /^[a-z][a-zA-Z0-9_]{1,63}$/;
const INDEX_NAME = /^[a-z][a-z0-9_]{2,95}$/;
const INTERNAL_FIELDS = new Set(["_id", "_revision", "_ownerId", "_createdAt", "_updatedAt"]);

function emptySchema(now: Date): ManagedSchemaSnapshot {
  const collections = {};
  return { version: 0, collections, hash: sha256(stableJson(collections)), updatedAt: now.toISOString() };
}

function validateFieldValue(field: string, definition: ManagedFieldSchema, value: unknown): void {
  if (value === undefined || value === null) {
    if (definition.required && definition.default === undefined) throw new ManagedPlatformError("FIELD_REQUIRED", `Field ${field} is required.`);
    return;
  }
  const invalid = () => { throw new ManagedPlatformError("FIELD_TYPE_INVALID", `Field ${field} must be ${definition.type}.`); };
  switch (definition.type) {
    case "string":
    case "text":
    case "reference":
    case "user-reference":
    case "file-reference":
      if (typeof value !== "string" || value.length > (definition.type === "text" ? 100_000 : 4_096)) invalid();
      break;
    case "integer": if (!Number.isSafeInteger(value)) invalid(); break;
    case "float": if (typeof value !== "number" || !Number.isFinite(value)) invalid(); break;
    case "boolean": if (typeof value !== "boolean") invalid(); break;
    case "datetime": if (typeof value !== "string" || Number.isNaN(Date.parse(value))) invalid(); break;
    case "json":
      try {
        const serialized = JSON.stringify(value);
        if (!serialized || Buffer.byteLength(serialized) > 256_000) invalid();
      } catch { invalid(); }
      break;
    case "enum":
      if (typeof value !== "string" || !definition.enumValues?.includes(value)) invalid();
      break;
  }
}

function validateCollection(collection: ManagedCollectionSchema): ManagedCollectionSchema {
  if (!NAME.test(collection.name)) throw new ManagedPlatformError("COLLECTION_INVALID", "Collection name is invalid.");
  if (collection.rowPolicy === "roles" && !collection.allowedRoles?.length) throw new ManagedPlatformError("ROW_POLICY_INVALID", "Role-scoped collection requires allowed roles.");
  if (!Object.keys(collection.fields).length || Object.keys(collection.fields).length > 100) throw new ManagedPlatformError("SCHEMA_LIMIT", "Collection field count is invalid.");
  for (const [field, definition] of Object.entries(collection.fields)) {
    if (!NAME.test(field) || INTERNAL_FIELDS.has(field)) throw new ManagedPlatformError("FIELD_INVALID", `Field ${field} is invalid.`);
    if (definition.enumValues && (definition.type !== "enum" || !definition.enumValues.length || new Set(definition.enumValues).size !== definition.enumValues.length)) {
      throw new ManagedPlatformError("FIELD_INVALID", `Enum field ${field} is invalid.`);
    }
    if (definition.default !== undefined) validateFieldValue(field, definition, definition.default);
  }
  const indexNames = new Set<string>();
  for (const index of collection.indexes) {
    if (!INDEX_NAME.test(index.name) || indexNames.has(index.name) || !index.fields.length || index.fields.length > 8) throw new ManagedPlatformError("INDEX_INVALID", "Index is invalid.");
    indexNames.add(index.name);
    for (const field of index.fields) if (!collection.fields[field] && !INTERNAL_FIELDS.has(field)) throw new ManagedPlatformError("INDEX_INVALID", `Index field ${field} does not exist.`);
  }
  return clone(collection);
}

function applyOperation(snapshot: ManagedSchemaSnapshot, operation: ManagedMigrationOperation): void {
  if (operation.kind === "create-collection") {
    const collection = validateCollection(operation.collection);
    if (snapshot.collections[collection.name]) throw new ManagedPlatformError("COLLECTION_EXISTS", `Collection ${collection.name} already exists.`);
    snapshot.collections[collection.name] = collection;
    return;
  }
  const collection = snapshot.collections[operation.collection];
  if (!collection) throw new ManagedPlatformError("COLLECTION_NOT_FOUND", `Collection ${operation.collection} does not exist.`);
  if (operation.kind === "add-field") {
    if (!NAME.test(operation.field) || collection.fields[operation.field]) throw new ManagedPlatformError("FIELD_EXISTS", `Field ${operation.field} already exists or is invalid.`);
    validateFieldValue(operation.field, operation.definition, operation.definition.default);
    collection.fields[operation.field] = clone(operation.definition);
  } else if (operation.kind === "rename-field") {
    if (!collection.fields[operation.from] || collection.fields[operation.to] || !NAME.test(operation.to)) throw new ManagedPlatformError("FIELD_RENAME_INVALID", "Field rename is invalid.");
    collection.fields[operation.to] = collection.fields[operation.from];
    delete collection.fields[operation.from];
    for (const index of collection.indexes) index.fields = index.fields.map((field) => field === operation.from ? operation.to : field);
  } else if (operation.kind === "deprecate-field") {
    if (!collection.fields[operation.field]) throw new ManagedPlatformError("FIELD_NOT_FOUND", `Field ${operation.field} does not exist.`);
    collection.fields[operation.field].deprecated = true;
  } else {
    if (collection.indexes.some((index) => index.name === operation.index.name)) throw new ManagedPlatformError("INDEX_EXISTS", "Index already exists.");
    collection.indexes.push(validateCollection({ ...collection, indexes: [...collection.indexes, operation.index] }).indexes.at(-1)!);
  }
}

export class InMemoryManagedData {
  private readonly states = new Map<string, EnvironmentState>();
  private readonly options: { now: () => Date; limits: ManagedPlatformLimits };
  constructor(options: { now: () => Date; limits: ManagedPlatformLimits }) { this.options = options; }

  ensureEnvironment(scope: ManagedScope, principal: ManagedPrincipal): ManagedSchemaSnapshot {
    assertScope(scope, principal);
    if (!principal.roles.includes("owner") && !principal.permissions.some((permission) => permission.startsWith("backend."))) {
      throw new ManagedPlatformError("PERMISSION_DENIED", "Backend access is required to create an environment.");
    }
    if (!this.states.has(scope.scopeKey)) {
      this.states.set(scope.scopeKey, { schema: emptySchema(this.options.now()), rows: new Map(), idempotency: new Map(), migrations: [] });
    }
    return this.snapshot(scope, principal);
  }

  hasEnvironment(scope: ManagedScope): boolean { return this.states.has(scope.scopeKey); }

  private state(scope: ManagedScope): EnvironmentState {
    const state = this.states.get(scope.scopeKey);
    if (!state) throw new ManagedPlatformError("ENVIRONMENT_NOT_FOUND", "Managed environment does not exist.");
    return state;
  }

  snapshot(scope: ManagedScope, principal: ManagedPrincipal): ManagedSchemaSnapshot {
    assertScope(scope, principal);
    requirePermission(principal, "backend.schema.manage");
    return clone(this.state(scope).schema);
  }

  plan(scope: ManagedScope, input: { baseVersion: number; operations: ManagedMigrationOperation[] }, principal: ManagedPrincipal): ManagedMigrationPlan {
    assertScope(scope, principal);
    requirePermission(principal, "backend.schema.manage");
    const state = this.state(scope);
    if (input.baseVersion !== state.schema.version) throw new ManagedPlatformError("SCHEMA_REVISION_CONFLICT", "Schema migration base version is stale.");
    if (!input.operations.length || input.operations.length > 50) throw new ManagedPlatformError("MIGRATION_INVALID", "Migration operation count is invalid.");
    const proposed = clone(state.schema);
    for (const operation of input.operations) applyOperation(proposed, operation);
    const destructive = input.operations.some((operation) => operation.kind === "rename-field" || operation.kind === "deprecate-field");
    const createdAt = this.options.now().toISOString();
    const base = {
      scopeKey: scope.scopeKey,
      fromVersion: state.schema.version,
      toVersion: state.schema.version + 1,
      operations: clone(input.operations),
      destructive,
      warnings: destructive ? ["Migration changes existing fields; create a verified backup before production promotion."] : [],
      requiresApproval: scope.environment === "production" || destructive,
      createdAt,
    };
    const checksum = sha256(stableJson(base));
    return { id: `migration_${checksum.slice(0, 24)}`, ...base, checksum };
  }

  apply(scope: ManagedScope, plan: ManagedMigrationPlan, principal: ManagedPrincipal, options: { approvalReceipt?: string } = {}): ManagedSchemaSnapshot {
    assertScope(scope, principal);
    requirePermission(principal, "backend.schema.manage");
    const state = this.state(scope);
    if (plan.scopeKey !== scope.scopeKey || plan.fromVersion !== state.schema.version) throw new ManagedPlatformError("SCHEMA_REVISION_CONFLICT", "Schema migration plan is stale or belongs to another environment.");
    const base = {
      scopeKey: plan.scopeKey,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      operations: plan.operations,
      destructive: plan.destructive,
      warnings: plan.warnings,
      requiresApproval: plan.requiresApproval,
      createdAt: plan.createdAt,
    };
    if (sha256(stableJson(base)) !== plan.checksum) throw new ManagedPlatformError("MIGRATION_TAMPERED", "Schema migration checksum is invalid.");
    if (plan.requiresApproval) requireApproval(options.approvalReceipt);
    const before = clone(state.schema);
    const after = clone(state.schema);
    for (const operation of plan.operations) applyOperation(after, operation);
    after.version = plan.toVersion;
    after.updatedAt = this.options.now().toISOString();
    after.hash = sha256(stableJson(after.collections));
    state.schema = after;
    for (const name of Object.keys(after.collections)) if (!state.rows.has(name)) state.rows.set(name, new Map());
    state.migrations.push({ plan: clone(plan), before, after: clone(after) });
    return clone(after);
  }

  private collection(scope: ManagedScope, name: string): { state: EnvironmentState; schema: ManagedCollectionSchema; rows: Map<string, ManagedRecord> } {
    const state = this.state(scope);
    const schema = state.schema.collections[name];
    const rows = state.rows.get(name);
    if (!schema || !rows) throw new ManagedPlatformError("COLLECTION_NOT_FOUND", `Collection ${name} does not exist in this environment.`);
    return { state, schema, rows };
  }

  private authorizeRow(schema: ManagedCollectionSchema, record: ManagedRecord, principal: ManagedPrincipal): boolean {
    if (principal.permissions.includes("backend.data.admin") || principal.roles.includes("owner")) return true;
    if (schema.rowPolicy === "project") return true;
    if (schema.rowPolicy === "owner") return record._ownerId === principal.actorId;
    return schema.allowedRoles?.some((role) => principal.roles.includes(role)) ?? false;
  }

  private validateData(schema: ManagedCollectionSchema, input: Record<string, unknown>, partial: boolean): Record<string, unknown> {
    for (const key of Object.keys(input)) if (!schema.fields[key]) throw new ManagedPlatformError("FIELD_UNKNOWN", `Unknown field ${key}.`);
    const result: Record<string, unknown> = {};
    for (const [field, definition] of Object.entries(schema.fields)) {
      const supplied = Object.hasOwn(input, field);
      const value = supplied ? input[field] : partial ? undefined : definition.default;
      if (!partial || supplied) {
        validateFieldValue(field, definition, value);
        if (value !== undefined) result[field] = clone(value);
      }
    }
    return result;
  }

  private enforceUnique(schema: ManagedCollectionSchema, rows: Map<string, ManagedRecord>, candidate: ManagedRecord, excludingId?: string): void {
    for (const index of schema.indexes.filter((entry) => entry.unique)) {
      if (index.fields.some((field) => candidate[field] === undefined || candidate[field] === null)) continue;
      const collision = [...rows.values()].some((record) => record._id !== excludingId
        && index.fields.every((field) => record[field] !== undefined && record[field] !== null && stableJson(record[field]) === stableJson(candidate[field])));
      if (collision) throw new ManagedPlatformError("UNIQUE_CONSTRAINT", `Unique constraint ${index.name} was violated.`);
    }
  }

  create(scope: ManagedScope, collectionName: string, input: Record<string, unknown>, principal: ManagedPrincipal, options: { idempotencyKey?: string } = {}): ManagedRecord {
    assertScope(scope, principal);
    requirePermission(principal, "backend.data.write");
    const { state, schema, rows } = this.collection(scope, collectionName);
    const data = this.validateData(schema, input, false);
    const fingerprint = sha256(stableJson({ action: "create", collectionName, data, actorId: principal.actorId }));
    if (options.idempotencyKey) {
      const key = `${principal.actorId}:create:${options.idempotencyKey}`;
      const previous = state.idempotency.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ManagedPlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different input.");
        return clone(previous.value);
      }
    }
    const totalRows = [...state.rows.values()].reduce((sum, collection) => sum + collection.size, 0);
    if (totalRows >= this.options.limits.maxRowsPerEnvironment) throw new ManagedPlatformError("ROW_QUOTA_EXCEEDED", "Managed data row quota exceeded.");
    const timestamp = this.options.now().toISOString();
    const record: ManagedRecord = { ...data, _id: `row_${randomUUID()}`, _revision: 1, _ownerId: principal.actorId, _createdAt: timestamp, _updatedAt: timestamp };
    if (!this.authorizeRow(schema, record, principal)) throw new ManagedPlatformError("ROW_SCOPE_DENIED", "Managed row scope denied creation.");
    this.enforceUnique(schema, rows, record);
    rows.set(record._id, record);
    if (options.idempotencyKey) state.idempotency.set(`${principal.actorId}:create:${options.idempotencyKey}`, { fingerprint, value: clone(record) });
    return clone(record);
  }

  read(scope: ManagedScope, collectionName: string, id: string, principal: ManagedPrincipal): ManagedRecord {
    assertScope(scope, principal);
    requirePermission(principal, "backend.data.read");
    const { schema, rows } = this.collection(scope, collectionName);
    const record = rows.get(id);
    if (!record) throw new ManagedPlatformError("ROW_NOT_FOUND", "Managed row does not exist.");
    if (!this.authorizeRow(schema, record, principal)) throw new ManagedPlatformError("ROW_SCOPE_DENIED", "Managed row scope denied access.");
    return clone(record);
  }

  query(scope: ManagedScope, collectionName: string, query: ManagedQuery, principal: ManagedPrincipal): { rows: ManagedRecord[]; nextCursor: string | null } {
    assertScope(scope, principal);
    requirePermission(principal, "backend.data.read");
    const { schema, rows } = this.collection(scope, collectionName);
    const filters = query.filters ?? [];
    const sort = query.sort ?? [];
    const complexity = filters.length + sort.length * 2;
    if (complexity > this.options.limits.maxQueryComplexity || filters.some((filter) => filter.operator === "in" && (!Array.isArray(filter.value) || filter.value.length > 20))) {
      throw new ManagedPlatformError("QUERY_COMPLEXITY", "Managed query complexity exceeds the bounded limit.");
    }
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ManagedPlatformError("QUERY_LIMIT", "Managed query limit is invalid.");
    for (const entry of [...filters, ...sort]) if (!schema.fields[entry.field] && !INTERNAL_FIELDS.has(entry.field)) throw new ManagedPlatformError("QUERY_FIELD", `Query field ${entry.field} is invalid.`);
    const compare = (left: unknown, operator: string, right: unknown) => {
      if (operator === "eq") return stableJson(left) === stableJson(right);
      if (operator === "ne") return stableJson(left) !== stableJson(right);
      if (operator === "in") return (right as unknown[]).some((entry) => stableJson(left) === stableJson(entry));
      if (operator === "gt") return (left as never) > (right as never);
      if (operator === "gte") return (left as never) >= (right as never);
      if (operator === "lt") return (left as never) < (right as never);
      return (left as never) <= (right as never);
    };
    const selected = [...rows.values()].filter((record) => this.authorizeRow(schema, record, principal) && filters.every((filter) => compare(record[filter.field], filter.operator, filter.value)));
    const compareSortValues = (left: unknown, right: unknown): number => {
      if (Object.is(left, right)) return 0;
      if (left === undefined || left === null) return -1;
      if (right === undefined || right === null) return 1;
      if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
      if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
      if (typeof left === "boolean" && typeof right === "boolean") return left === false ? -1 : 1;
      return stableJson(left).localeCompare(stableJson(right));
    };
    selected.sort((left, right) => {
      for (const entry of sort) {
        const order = compareSortValues(left[entry.field], right[entry.field]);
        if (order) return entry.direction === "asc" ? order : -order;
      }
      return left._id.localeCompare(right._id);
    });
    const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString("utf8")) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ManagedPlatformError("CURSOR_INVALID", "Query cursor is invalid.");
    const page = selected.slice(offset, offset + limit);
    const next = offset + limit < selected.length ? Buffer.from(String(offset + limit)).toString("base64url") : null;
    return { rows: clone(page), nextCursor: next };
  }

  update(scope: ManagedScope, collectionName: string, id: string, patch: Record<string, unknown>, principal: ManagedPrincipal, options: { expectedRevision: number; idempotencyKey?: string }): ManagedRecord {
    assertScope(scope, principal);
    requirePermission(principal, "backend.data.write");
    const { state, schema, rows } = this.collection(scope, collectionName);
    const record = rows.get(id);
    if (!record) throw new ManagedPlatformError("ROW_NOT_FOUND", "Managed row does not exist.");
    if (!this.authorizeRow(schema, record, principal)) throw new ManagedPlatformError("ROW_SCOPE_DENIED", "Managed row scope denied access.");
    const data = this.validateData(schema, patch, true);
    const fingerprint = sha256(stableJson({ action: "update", id, options: { expectedRevision: options.expectedRevision }, data }));
    if (options.idempotencyKey) {
      const previous = state.idempotency.get(`${principal.actorId}:update:${options.idempotencyKey}`);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ManagedPlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different input.");
        return clone(previous.value);
      }
    }
    if (record._revision !== options.expectedRevision) throw new ManagedPlatformError("REVISION_CONFLICT", "Managed row revision conflict.");
    const updated: ManagedRecord = { ...record, ...data, _revision: record._revision + 1, _updatedAt: this.options.now().toISOString() };
    this.enforceUnique(schema, rows, updated, id);
    rows.set(id, updated);
    if (options.idempotencyKey) state.idempotency.set(`${principal.actorId}:update:${options.idempotencyKey}`, { fingerprint, value: clone(updated) });
    return clone(updated);
  }

  delete(scope: ManagedScope, collectionName: string, id: string, principal: ManagedPrincipal, options: { expectedRevision: number }): void {
    const record = this.read(scope, collectionName, id, principal);
    requirePermission(principal, "backend.data.write");
    if (record._revision !== options.expectedRevision) throw new ManagedPlatformError("REVISION_CONFLICT", "Managed row revision conflict.");
    this.collection(scope, collectionName).rows.delete(id);
  }

  exportState(scope: ManagedScope): { schema: ManagedSchemaSnapshot; rows: Record<string, ManagedRecord[]> } {
    const state = this.state(scope);
    return {
      schema: clone(state.schema),
      rows: Object.fromEntries([...state.rows.entries()].map(([name, rows]) => [name, clone([...rows.values()])])),
    };
  }

  importState(scope: ManagedScope, snapshot: { schema: ManagedSchemaSnapshot; rows: Record<string, ManagedRecord[]> }): void {
    const rows = new Map<string, Map<string, ManagedRecord>>();
    for (const name of Object.keys(snapshot.schema.collections)) rows.set(name, new Map((snapshot.rows[name] ?? []).map((record) => [record._id, clone(record)])));
    this.states.set(scope.scopeKey, { schema: clone(snapshot.schema), rows, idempotency: new Map(), migrations: [] });
  }
}
