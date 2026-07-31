import { enterpriseError } from "./errors.ts";
import type { EnterprisePermission, EnterpriseRuntime } from "./types.ts";
import { assertSafeId, boundedText, clone, containsSecretLikeValue, iso, sha256, stableJson } from "./utils.ts";

export interface AuditEvent {
  id: string;
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  environment?: string;
  actorType: "user" | "service-account" | "system" | "agent";
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string;
  outcome: "success" | "failure" | "blocked";
  reasonCode?: string;
  requestId: string;
  ipHash?: string;
  userAgentSummary?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  previousIntegrityHash: string;
  integrityHash: string;
}

export type AuditEventInput = Omit<AuditEvent, "id" | "createdAt" | "previousIntegrityHash" | "integrityHash">;

export class ImmutableAuditLog {
  readonly #runtime: EnterpriseRuntime;
  readonly #events: AuditEvent[] = [];

  constructor(runtime: EnterpriseRuntime) {
    this.#runtime = runtime;
  }

  append(input: AuditEventInput): AuditEvent {
    if (containsSecretLikeValue(input.metadata)) enterpriseError("AUDIT_SECRET_REJECTED", "Audit metadata contains a secret-like key or value.");
    if (Buffer.byteLength(stableJson(input.metadata), "utf8") > 32_000) enterpriseError("INVALID_INPUT", "Audit metadata exceeds its bound.");
    const payload = {
      id: assertSafeId(this.#runtime.id("audit-event"), "Audit event id"),
      organizationId: assertSafeId(input.organizationId, "Audit organization id"),
      ...(input.workspaceId ? { workspaceId: assertSafeId(input.workspaceId, "Audit workspace id") } : {}),
      ...(input.projectId ? { projectId: assertSafeId(input.projectId, "Audit project id") } : {}),
      ...(input.environment ? { environment: boundedText(input.environment, "Audit environment", 80) } : {}),
      actorType: input.actorType,
      actorId: assertSafeId(input.actorId, "Audit actor id"),
      action: boundedText(input.action, "Audit action", 160),
      targetType: boundedText(input.targetType, "Audit target type", 120),
      ...(input.targetId ? { targetId: assertSafeId(input.targetId, "Audit target id") } : {}),
      outcome: input.outcome,
      ...(input.reasonCode ? { reasonCode: boundedText(input.reasonCode, "Audit reason code", 120) } : {}),
      requestId: assertSafeId(input.requestId, "Audit request id"),
      ...(input.ipHash ? { ipHash: this.#hash(input.ipHash, "IP hash") } : {}),
      ...(input.userAgentSummary ? { userAgentSummary: boundedText(input.userAgentSummary, "User agent summary", 240) } : {}),
      metadata: clone(input.metadata),
      createdAt: iso(this.#runtime.now()),
    };
    const previousIntegrityHash = this.#events.at(-1)?.integrityHash ?? "0".repeat(64);
    const event: AuditEvent = {
      ...payload,
      previousIntegrityHash,
      integrityHash: sha256(`${previousIntegrityHash}\0${stableJson(payload)}`),
    };
    this.#events.push(event);
    return clone(event);
  }

  list(input: {
    organizationId: string;
    permissions: EnterprisePermission[];
    workspaceId?: string;
    projectId?: string;
    action?: string;
    outcome?: AuditEvent["outcome"];
    cursor?: number;
    limit: number;
  }): { items: AuditEvent[]; nextCursor: number | null } {
    if (!input.permissions.includes("audit.read")) enterpriseError("PERMISSION_DENIED", "Permission audit.read is required.");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) enterpriseError("INVALID_INPUT", "Audit page limit is invalid.");
    const cursor = input.cursor ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) enterpriseError("INVALID_INPUT", "Audit cursor is invalid.");
    const filtered = this.#events.filter((event) =>
      event.organizationId === input.organizationId
      && (!input.workspaceId || event.workspaceId === input.workspaceId)
      && (!input.projectId || event.projectId === input.projectId)
      && (!input.action || event.action === input.action)
      && (!input.outcome || event.outcome === input.outcome));
    const items = filtered.slice(cursor, cursor + input.limit).map(clone);
    return { items, nextCursor: cursor + items.length < filtered.length ? cursor + items.length : null };
  }

  export(input: { organizationId: string; permissions: EnterprisePermission[] }): {
    events: AuditEvent[];
    eventCount: number;
    chainRoot: string;
    checksum: string;
  } {
    const events: AuditEvent[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page = this.list({ organizationId: input.organizationId, permissions: input.permissions, cursor, limit: 500 });
      events.push(...page.items);
      cursor = page.nextCursor;
    }
    const serialized = stableJson(events);
    return { events, eventCount: events.length, chainRoot: events.at(-1)?.integrityHash ?? "0".repeat(64), checksum: sha256(serialized) };
  }

  verifyIntegrity(): boolean {
    let previousIntegrityHash = "0".repeat(64);
    for (const event of this.#events) {
      const { previousIntegrityHash: storedPrevious, integrityHash, ...payload } = event;
      if (storedPrevious !== previousIntegrityHash) return false;
      const expected = sha256(`${previousIntegrityHash}\0${stableJson(payload)}`);
      if (expected !== integrityHash) return false;
      previousIntegrityHash = integrityHash;
    }
    return true;
  }

  #hash(value: string, label: string): string {
    if (!/^[a-f0-9]{64}$/i.test(value)) enterpriseError("INVALID_INPUT", `${label} must be a SHA-256 digest.`);
    return value.toLowerCase();
  }
}
