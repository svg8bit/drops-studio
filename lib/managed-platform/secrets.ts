import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { ManagedPrincipal, ManagedScope } from "./contracts.ts";
import { ManagedPlatformError, assertScope, clone, requirePermission } from "./security.ts";
import type { ManagedLogStore } from "./logs.ts";

type SecretPurpose = "function" | "webhook" | "job" | "cron";
interface SecretVersion {
  version: number;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
  revokedAt: string | null;
}
interface StoredSecret {
  id: string;
  scopeKey: string;
  name: string;
  allowedPurposes: SecretPurpose[];
  status: "active" | "revoked" | "rotation-required";
  versions: SecretVersion[];
  createdAt: string;
}

function metadata(secret: StoredSecret) {
  return {
    id: secret.id,
    name: secret.name,
    masked: "••••••••",
    allowedPurposes: [...secret.allowedPurposes],
    status: secret.status,
    currentVersion: secret.versions.length,
    versions: secret.versions.map(({ version, createdAt, revokedAt }) => ({ version, createdAt, revokedAt })),
    createdAt: secret.createdAt,
  };
}

export class ManagedSecretVault {
  readonly mode = "in-memory-test" as const;
  private readonly secrets = new Map<string, StoredSecret>();
  private readonly options: { key: Uint8Array; now: () => Date; logs: ManagedLogStore };
  constructor(options: { key: Uint8Array; now: () => Date; logs: ManagedLogStore }) {
    this.options = options;
    if (options.key.byteLength !== 32) throw new ManagedPlatformError("VAULT_KEY_INVALID", "Secret vault encryption key must be 32 bytes.");
  }

  private encrypt(value: string, scopeKey: string, version: number): SecretVersion {
    if (!value || Buffer.byteLength(value) > 16_384 || /[\0]/.test(value)) throw new ManagedPlatformError("SECRET_INVALID", "Secret value is invalid.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.options.key, iv);
    cipher.setAAD(Buffer.from(`${scopeKey}:${version}`));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { version, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"), createdAt: this.options.now().toISOString(), revokedAt: null };
  }

  create(scope: ManagedScope, input: { name: string; value: string; allowedPurposes: SecretPurpose[] }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.secrets.manage");
    if (!/^[A-Z][A-Z0-9_]{1,95}$/.test(input.name) || !input.allowedPurposes.length) throw new ManagedPlatformError("SECRET_METADATA_INVALID", "Secret metadata is invalid.");
    if ([...this.secrets.values()].some((secret) => secret.scopeKey === scope.scopeKey && secret.name === input.name && secret.status !== "revoked")) throw new ManagedPlatformError("SECRET_EXISTS", "Secret name already exists.");
    const id = `secret_${randomUUID()}`;
    const stored: StoredSecret = { id, scopeKey: scope.scopeKey, name: input.name, allowedPurposes: [...new Set(input.allowedPurposes)], status: "active", versions: [this.encrypt(input.value, scope.scopeKey, 1)], createdAt: this.options.now().toISOString() };
    this.secrets.set(id, stored);
    this.options.logs.append(scope, { category: "secret", severity: "info", action: "secret.create", actorId: principal.actorId, requestId: `req_${randomUUID()}`, metadata: { secretId: id, name: input.name } });
    return metadata(stored);
  }

  list(scope: ManagedScope, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.secrets.manage");
    return clone([...this.secrets.values()].filter((secret) => secret.scopeKey === scope.scopeKey).map(metadata));
  }

  resolveForRuntime(scope: ManagedScope, secretId: string, purpose: string): string {
    const secret = this.secrets.get(secretId);
    if (!secret || secret.scopeKey !== scope.scopeKey || secret.status !== "active") throw new ManagedPlatformError("SECRET_UNAVAILABLE", "Secret reference is unavailable.");
    if (!secret.allowedPurposes.includes(purpose as SecretPurpose)) throw new ManagedPlatformError("SECRET_PURPOSE_DENIED", "Secret purpose is not authorized.");
    const current = secret.versions.at(-1);
    if (!current) throw new ManagedPlatformError("SECRET_UNAVAILABLE", "Secret value requires rotation before runtime use.");
    const decipher = createDecipheriv("aes-256-gcm", this.options.key, Buffer.from(current.iv, "base64url"));
    decipher.setAAD(Buffer.from(`${scope.scopeKey}:${current.version}`));
    decipher.setAuthTag(Buffer.from(current.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(current.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }

  rotate(scope: ManagedScope, secretId: string, value: string, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.secrets.manage");
    const secret = this.secrets.get(secretId);
    if (!secret || secret.scopeKey !== scope.scopeKey || secret.status === "revoked") throw new ManagedPlatformError("SECRET_UNAVAILABLE", "Secret reference is unavailable.");
    const current = secret.versions.at(-1);
    const nextVersion = (current?.version ?? 0) + 1;
    const replacement = this.encrypt(value, scope.scopeKey, nextVersion);
    if (current) current.revokedAt = this.options.now().toISOString();
    secret.versions.push(replacement);
    secret.status = "active";
    return metadata(secret);
  }

  revoke(scope: ManagedScope, secretId: string, principal: ManagedPrincipal): void {
    assertScope(scope, principal);
    requirePermission(principal, "backend.secrets.manage");
    const secret = this.secrets.get(secretId);
    if (!secret || secret.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("SECRET_UNAVAILABLE", "Secret reference is unavailable.");
    secret.status = "revoked";
    const current = secret.versions.at(-1);
    if (current) current.revokedAt = this.options.now().toISOString();
  }

  exportReferences(scope: ManagedScope) {
    return clone([...this.secrets.values()].filter((secret) => secret.scopeKey === scope.scopeKey).map((secret) => ({ id: secret.id, name: secret.name, allowedPurposes: [...secret.allowedPurposes], createdAt: secret.createdAt })));
  }

  importReferences(scope: ManagedScope, references: Array<{ id: string; name: string; allowedPurposes: SecretPurpose[]; createdAt: string }>): void {
    for (const reference of references) this.secrets.set(reference.id, { ...clone(reference), scopeKey: scope.scopeKey, status: "rotation-required", versions: [] });
  }
}
