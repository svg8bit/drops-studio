import { randomUUID } from "node:crypto";
import type { ManagedPlatformLimits, ManagedPrincipal, ManagedScope } from "./contracts.ts";
import { ManagedPlatformError, assertScope, clone, requirePermission, sha256, signPayload, verifySignedPayload } from "./security.ts";
import type { ManagedLogStore } from "./logs.ts";

interface StoredObject {
  id: string;
  scopeKey: string;
  key: string;
  contentType: string;
  visibility: "private" | "public";
  size: number;
  checksum: string;
  bytes: Uint8Array;
  status: "active" | "deleted";
  createdAt: string;
}

const CONTENT_TYPES = new Set(["application/json", "application/pdf", "text/plain", "image/png", "image/jpeg", "image/webp"]);

function publicMetadata(object: StoredObject) {
  return clone({
    id: object.id,
    key: object.key,
    contentType: object.contentType,
    visibility: object.visibility,
    size: object.size,
    checksum: object.checksum,
    status: object.status,
    createdAt: object.createdAt,
  });
}

export class ManagedObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private readonly options: { signingKey: Uint8Array; now: () => Date; limits: ManagedPlatformLimits; logs: ManagedLogStore; scan?: (bytes: Uint8Array) => "clean" | "rejected" };
  constructor(options: { signingKey: Uint8Array; now: () => Date; limits: ManagedPlatformLimits; logs: ManagedLogStore; scan?: (bytes: Uint8Array) => "clean" | "rejected" }) { this.options = options; }

  put(scope: ManagedScope, input: { key: string; contentType: string; visibility: "private" | "public"; bytes: Uint8Array }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.storage.manage");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,254}$/.test(input.key) || input.key.startsWith("/") || input.key.split("/").includes("..") || input.key.includes("//")) throw new ManagedPlatformError("OBJECT_KEY_INVALID", "Object key is invalid.");
    if (!CONTENT_TYPES.has(input.contentType)) throw new ManagedPlatformError("OBJECT_MIME_INVALID", "Object content type is not allowed.");
    if (!input.bytes.byteLength || input.bytes.byteLength > this.options.limits.maxObjectBytes) throw new ManagedPlatformError("OBJECT_SIZE_INVALID", "Object size exceeds the bounded limit.");
    const active = [...this.objects.values()].filter((object) => object.scopeKey === scope.scopeKey && object.status === "active");
    if (active.length >= this.options.limits.maxObjectsPerEnvironment) throw new ManagedPlatformError("OBJECT_QUOTA_EXCEEDED", "Object count quota exceeded for this environment.");
    if (active.reduce((total, object) => total + object.size, 0) + input.bytes.byteLength > this.options.limits.maxObjectBytesPerEnvironment) {
      throw new ManagedPlatformError("OBJECT_QUOTA_EXCEEDED", "Aggregate object byte quota exceeded for this environment.");
    }
    if (this.options.scan?.(input.bytes) === "rejected") throw new ManagedPlatformError("OBJECT_SCAN_REJECTED", "Object was rejected by the configured scanning hook.");
    const object: StoredObject = { id: `object_${randomUUID()}`, scopeKey: scope.scopeKey, key: input.key, contentType: input.contentType, visibility: input.visibility, size: input.bytes.byteLength, checksum: sha256(input.bytes), bytes: Uint8Array.from(input.bytes), status: "active", createdAt: this.options.now().toISOString() };
    this.objects.set(object.id, object);
    this.options.logs.append(scope, { category: "storage", severity: "info", action: "storage.put", actorId: principal.actorId, requestId: `req_${randomUUID()}`, metadata: { objectId: object.id, key: object.key, size: object.size, checksum: object.checksum } });
    return publicMetadata(object);
  }

  signCapability(scope: ManagedScope, objectId: string, operation: "read" | "delete", principal: ManagedPrincipal, options: { ttlSeconds?: number } = {}): string {
    assertScope(scope, principal);
    requirePermission(principal, "backend.storage.manage");
    const object = this.objects.get(objectId);
    if (!object || object.scopeKey !== scope.scopeKey || object.status !== "active") throw new ManagedPlatformError("OBJECT_NOT_FOUND", "Stored object does not exist.");
    const ttl = options.ttlSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 3_600) throw new ManagedPlatformError("CAPABILITY_TTL_INVALID", "Object capability lifetime is invalid.");
    return signPayload({ version: 1, scopeKey: scope.scopeKey, objectId, operation, exp: Math.floor(this.options.now().getTime() / 1000) + ttl, nonce: randomUUID() }, this.options.signingKey);
  }

  read(scope: ManagedScope, capability: string, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.storage.manage");
    const payload = verifySignedPayload(capability, this.options.signingKey);
    if (payload.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("CAPABILITY_SCOPE_MISMATCH", "Object capability scope or environment does not match.");
    if (payload.operation !== "read") throw new ManagedPlatformError("CAPABILITY_OPERATION_DENIED", "Object capability does not allow reading.");
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(this.options.now().getTime() / 1000)) throw new ManagedPlatformError("CAPABILITY_EXPIRED", "Object capability expired.");
    const object = this.objects.get(String(payload.objectId));
    if (!object || object.scopeKey !== scope.scopeKey || object.status !== "active") throw new ManagedPlatformError("OBJECT_NOT_FOUND", "Stored object does not exist.");
    return { metadata: publicMetadata(object), bytes: Buffer.from(object.bytes) };
  }

  exportMetadata(scope: ManagedScope) {
    return clone([...this.objects.values()].filter((object) => object.scopeKey === scope.scopeKey && object.status === "active").map(publicMetadata));
  }
}
