import { createHmac, timingSafeEqual } from "node:crypto";

import { enterpriseError } from "./errors.ts";
import type { EnterprisePermission, SecretRuntime } from "./types.ts";
import { ENTERPRISE_PERMISSIONS } from "./types.ts";
import { assertSafeId, boundedText, clone, iso, sha256 } from "./utils.ts";

export interface ServiceAccountRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  permissions: EnterprisePermission[];
  projectIds: string[];
  environments: string[];
  allowedIpHashes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ApiTokenRecord {
  id: string;
  serviceAccountId: string;
  prefix: string;
  permissions: EnterprisePermission[];
  expiresAt: string;
  revokedAt: string | null;
  rotatedFromTokenId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface StoredApiToken extends ApiTokenRecord {
  digest: string;
}

export class EnterpriseCredentialStore {
  readonly #runtime: SecretRuntime;
  readonly #pepper: string;
  readonly #accounts = new Map<string, ServiceAccountRecord>();
  readonly #tokens = new Map<string, StoredApiToken>();

  constructor(input: { runtime: SecretRuntime; tokenPepper: string }) {
    if (input.tokenPepper.length < 32) enterpriseError("INVALID_INPUT", "API token pepper must contain at least 32 characters.");
    this.#runtime = input.runtime;
    this.#pepper = input.tokenPepper;
  }

  createServiceAccount(input: {
    organizationId: string;
    name: string;
    description?: string;
    permissions: EnterprisePermission[];
    projectIds?: string[];
    environments?: string[];
    allowedIpAddresses?: string[];
    expiresAt?: string;
  }): ServiceAccountRecord {
    const permissions = this.#permissions(input.permissions);
    const expiresAt = input.expiresAt ? iso(new Date(input.expiresAt)) : null;
    if (expiresAt && Date.parse(expiresAt) <= this.#runtime.now().getTime()) enterpriseError("INVALID_INPUT", "Service account expiry must be in the future.");
    const account: ServiceAccountRecord = {
      id: assertSafeId(this.#runtime.id("service-account"), "Service account id"),
      organizationId: assertSafeId(input.organizationId, "Organization id"),
      name: boundedText(input.name, "Service account name", 120),
      ...(input.description ? { description: boundedText(input.description, "Service account description", 500) } : {}),
      permissions,
      projectIds: [...new Set((input.projectIds ?? []).map((id) => assertSafeId(id, "Project id")))].sort(),
      environments: [...new Set((input.environments ?? []).map((environment) => boundedText(environment, "Environment", 80)))].sort(),
      allowedIpHashes: [...new Set((input.allowedIpAddresses ?? []).map((address) => this.#digest(`ip:${address.trim()}`)))].sort(),
      expiresAt,
      revokedAt: null,
      createdAt: iso(this.#runtime.now()),
    };
    this.#accounts.set(account.id, account);
    return clone(account);
  }

  issueToken(input: { serviceAccountId: string; permissions: EnterprisePermission[]; expiresInMs: number }): {
    token: string;
    tokenRecord: ApiTokenRecord;
  } {
    const account = this.#account(input.serviceAccountId);
    this.#assertAccountActive(account);
    const permissions = this.#permissions(input.permissions);
    if (permissions.some((permission) => !account.permissions.includes(permission))) enterpriseError("TOKEN_SCOPE_DENIED", "Token cannot exceed service-account permissions.");
    if (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs < 1_000 || input.expiresInMs > 365 * 86_400_000) enterpriseError("INVALID_INPUT", "API token expiry is invalid.");
    const entropy = this.#runtime.entropy("service_account_token");
    if (entropy.length < 32) enterpriseError("INVALID_INPUT", "API token entropy is insufficient.");
    const token = `dst_sa_${entropy}`;
    const record: StoredApiToken = {
      id: assertSafeId(this.#runtime.id("api-token"), "API token id"),
      serviceAccountId: account.id,
      prefix: "dst_sa_",
      permissions,
      expiresAt: iso(new Date(this.#runtime.now().getTime() + input.expiresInMs)),
      revokedAt: null,
      rotatedFromTokenId: null,
      lastUsedAt: null,
      createdAt: iso(this.#runtime.now()),
      digest: this.#digest(token),
    };
    this.#tokens.set(record.id, record);
    return { token, tokenRecord: this.#publicToken(record) };
  }

  rotateToken(input: { tokenId: string; expiresInMs: number }): { token: string; tokenRecord: ApiTokenRecord } {
    const prior = this.#token(input.tokenId);
    if (prior.revokedAt) enterpriseError("TOKEN_REVOKED", "API token is already revoked.");
    const replacement = this.issueToken({ serviceAccountId: prior.serviceAccountId, permissions: prior.permissions, expiresInMs: input.expiresInMs });
    prior.revokedAt = iso(this.#runtime.now());
    const stored = this.#token(replacement.tokenRecord.id);
    stored.rotatedFromTokenId = prior.id;
    return { token: replacement.token, tokenRecord: this.#publicToken(stored) };
  }

  revokeToken(tokenId: string): ApiTokenRecord {
    const token = this.#token(tokenId);
    token.revokedAt = token.revokedAt ?? iso(this.#runtime.now());
    return this.#publicToken(token);
  }

  revokeServiceAccount(serviceAccountId: string): ServiceAccountRecord {
    const account = this.#account(serviceAccountId);
    account.revokedAt = account.revokedAt ?? iso(this.#runtime.now());
    for (const token of this.#tokens.values()) if (token.serviceAccountId === account.id && !token.revokedAt) token.revokedAt = account.revokedAt;
    return clone(account);
  }

  authenticate(input: {
    token: string;
    permission: EnterprisePermission;
    projectId?: string;
    environment?: string;
    ipAddress?: string;
  }): { serviceAccountId: string; tokenId: string; organizationId: string; permission: EnterprisePermission } {
    const digest = this.#digest(input.token);
    const candidate = [...this.#tokens.values()].find((entry) => {
      const left = Buffer.from(entry.digest, "hex");
      const right = Buffer.from(digest, "hex");
      return left.length === right.length && timingSafeEqual(left, right);
    });
    if (!candidate) enterpriseError("TOKEN_INVALID", "API token is invalid.");
    if (candidate.revokedAt) enterpriseError("TOKEN_REVOKED", "API token is revoked.");
    if (this.#runtime.now().getTime() > Date.parse(candidate.expiresAt)) enterpriseError("TOKEN_EXPIRED", "API token is expired.");
    const account = this.#account(candidate.serviceAccountId);
    this.#assertAccountActive(account);
    if (!candidate.permissions.includes(input.permission)) enterpriseError("TOKEN_SCOPE_DENIED", "API token permission is out of scope.");
    if (account.projectIds.length && (!input.projectId || !account.projectIds.includes(input.projectId))) enterpriseError("TOKEN_PROJECT_DENIED", "API token project is out of scope.");
    if (account.environments.length && (!input.environment || !account.environments.includes(input.environment))) enterpriseError("TOKEN_ENVIRONMENT_DENIED", "API token environment is out of scope.");
    if (account.allowedIpHashes.length && (!input.ipAddress || !account.allowedIpHashes.includes(this.#digest(`ip:${input.ipAddress.trim()}`)))) enterpriseError("TOKEN_IP_DENIED", "API token IP is out of scope.");
    candidate.lastUsedAt = iso(this.#runtime.now());
    return { serviceAccountId: account.id, tokenId: candidate.id, organizationId: account.organizationId, permission: input.permission };
  }

  snapshot(): { serviceAccounts: ServiceAccountRecord[]; tokens: ApiTokenRecord[]; storageIntegrityHash: string } {
    const serviceAccounts = [...this.#accounts.values()].map(clone);
    const tokens = [...this.#tokens.values()].map((entry) => this.#publicToken(entry));
    const storageIntegrityHash = sha256(JSON.stringify([...this.#tokens.values()].map((entry) => ({ id: entry.id, digest: entry.digest })).sort((left, right) => left.id.localeCompare(right.id))));
    return { serviceAccounts, tokens, storageIntegrityHash };
  }

  #assertAccountActive(account: ServiceAccountRecord): void {
    if (account.revokedAt) enterpriseError("TOKEN_REVOKED", "Service account is revoked.");
    if (account.expiresAt && this.#runtime.now().getTime() > Date.parse(account.expiresAt)) enterpriseError("TOKEN_EXPIRED", "Service account is expired.");
  }

  #permissions(input: EnterprisePermission[]): EnterprisePermission[] {
    const permissions = [...new Set(input)].sort();
    if (!permissions.length || permissions.some((permission) => !ENTERPRISE_PERMISSIONS.includes(permission))) enterpriseError("INVALID_INPUT", "Credential permissions are invalid.");
    return permissions;
  }

  #digest(value: string): string {
    return createHmac("sha256", this.#pepper).update(value, "utf8").digest("hex");
  }

  #account(id: string): ServiceAccountRecord {
    const account = this.#accounts.get(id);
    if (!account) enterpriseError("NOT_FOUND", "Service account was not found.");
    return account;
  }

  #token(id: string): StoredApiToken {
    const token = this.#tokens.get(id);
    if (!token) enterpriseError("NOT_FOUND", "API token was not found.");
    return token;
  }

  #publicToken(stored: StoredApiToken): ApiTokenRecord {
    const record = clone(stored) as Partial<StoredApiToken>;
    delete record.digest;
    return record as ApiTokenRecord;
  }
}
