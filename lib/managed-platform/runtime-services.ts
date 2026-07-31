import { createHmac, randomUUID } from "node:crypto";
import type {
  FunctionRuntimeAdapter,
  ManagedFieldType,
  ManagedFunctionManifest,
  ManagedPlatformLimits,
  ManagedPrincipal,
  ManagedScope,
} from "./contracts.ts";
import { ManagedPlatformError, assertScope, clone, requireApproval, requirePermission, safeEqual, sanitizeLogValue, stableJson } from "./security.ts";
import type { ManagedLogStore } from "./logs.ts";
import type { ManagedSecretVault } from "./secrets.ts";

type FunctionHandler = (input: Record<string, unknown>, context: { scope: ManagedScope; signal: AbortSignal }) => Promise<Record<string, unknown>> | Record<string, unknown>;

export class InMemoryFunctionRuntime implements FunctionRuntimeAdapter {
  readonly mode = "test" as const;
  private readonly handlers: Record<string, FunctionHandler>;
  constructor(handlers: Record<string, FunctionHandler>) { this.handlers = handlers; }
  async invoke(manifest: ManagedFunctionManifest, input: Record<string, unknown>, context: { scope: ManagedScope; signal: AbortSignal }): Promise<Record<string, unknown>> {
    const handler = this.handlers[manifest.name];
    if (!handler) throw new ManagedPlatformError("FUNCTION_HANDLER_MISSING", "Test function handler is not configured.");
    return handler(clone(input), context);
  }
}

export class SetupRequiredFunctionRuntime implements FunctionRuntimeAdapter {
  readonly mode = "setup-required" as const;
  async invoke(): Promise<Record<string, unknown>> {
    throw new ManagedPlatformError("FUNCTION_RUNTIME_REQUIRED", "Function runtime setup is required.");
  }
}

function validateShape(schema: Record<string, ManagedFieldType>, value: Record<string, unknown>, label: string): void {
  for (const [field, type] of Object.entries(schema)) {
    const current = value[field];
    const matches = type === "json"
      ? current !== undefined
      : type === "integer"
        ? Number.isSafeInteger(current)
        : type === "float"
          ? typeof current === "number" && Number.isFinite(current)
          : type === "boolean"
            ? typeof current === "boolean"
            : type === "datetime"
              ? typeof current === "string" && !Number.isNaN(Date.parse(current))
              : typeof current === "string";
    if (!matches) throw new ManagedPlatformError("FUNCTION_SCHEMA_INVALID", `${label} field ${field} must be ${type}.`);
  }
  for (const field of Object.keys(value)) if (!schema[field]) throw new ManagedPlatformError("FUNCTION_SCHEMA_INVALID", `${label} contains unknown field ${field}.`);
}

export class ManagedFunctionService {
  private readonly manifests = new Map<string, ManagedFunctionManifest>();
  private readonly options: { runtime: FunctionRuntimeAdapter; now: () => Date; logs: ManagedLogStore };
  constructor(options: { runtime: FunctionRuntimeAdapter; now: () => Date; logs: ManagedLogStore }) { this.options = options; }

  register(scope: ManagedScope, manifest: ManagedFunctionManifest, principal: ManagedPrincipal): ManagedFunctionManifest {
    assertScope(scope, principal);
    requirePermission(principal, "backend.functions.manage");
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(manifest.name) || !Number.isInteger(manifest.version) || manifest.version < 1 || manifest.timeoutMs < 100 || manifest.timeoutMs > 60_000) throw new ManagedPlatformError("FUNCTION_MANIFEST_INVALID", "Function manifest is invalid.");
    for (const host of manifest.allowedNetworkHosts) {
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) || host === "localhost" || host.endsWith(".local")) throw new ManagedPlatformError("FUNCTION_NETWORK_INVALID", "Function network allowlist contains an invalid host.");
    }
    const key = `${scope.scopeKey}:${manifest.name}`;
    const previous = this.manifests.get(key);
    if (previous && manifest.version <= previous.version) throw new ManagedPlatformError("FUNCTION_VERSION_CONFLICT", "Function version must increase.");
    this.manifests.set(key, clone(manifest));
    return clone(manifest);
  }

  async invoke(scope: ManagedScope, name: string, input: Record<string, unknown>, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.functions.invoke");
    const manifest = this.manifests.get(`${scope.scopeKey}:${name}`);
    if (!manifest) throw new ManagedPlatformError("FUNCTION_NOT_FOUND", "Managed function is not registered.");
    if (this.options.runtime.mode === "setup-required") throw new ManagedPlatformError("FUNCTION_RUNTIME_REQUIRED", "Function runtime setup is required.");
    validateShape(manifest.input, input, "Function input");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ManagedPlatformError("FUNCTION_TIMEOUT", "Managed function timed out.")); }, manifest.timeoutMs);
    });
    const requestId = `function_run_${randomUUID()}`;
    try {
      const output = await Promise.race([this.options.runtime.invoke(manifest, input, { scope, signal: controller.signal }), timeout]);
      validateShape(manifest.output, output, "Function output");
      this.options.logs.append(scope, { category: "function", severity: "info", action: "function.invoke.succeeded", actorId: principal.actorId, requestId, metadata: { function: name, version: manifest.version, output } });
      return { id: requestId, status: "succeeded" as const, output: clone(output), runtimeMode: this.options.runtime.mode, finishedAt: this.options.now().toISOString() };
    } catch (error) {
      this.options.logs.append(scope, { category: "function", severity: "error", action: "function.invoke.failed", actorId: principal.actorId, requestId, metadata: { function: name, code: error instanceof ManagedPlatformError ? error.code : "FUNCTION_FAILED" } });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  exportManifests(scope: ManagedScope): ManagedFunctionManifest[] {
    return clone([...this.manifests.entries()].filter(([key]) => key.startsWith(`${scope.scopeKey}:`)).map(([, manifest]) => manifest));
  }
}

interface WebhookEndpoint {
  id: string;
  scopeKey: string;
  name: string;
  signingSecretId: string;
  eventType: string;
  status: "active" | "disabled";
  createdAt: string;
}
interface WebhookEvent {
  id: string;
  endpointId: string;
  scopeKey: string;
  eventType: string;
  payload: unknown;
  receivedAt: string;
}

export class ManagedWebhookService {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly events = new Map<string, WebhookEvent>();
  private readonly replayKeys = new Map<string, number>();
  private readonly options: { now: () => Date; logs: ManagedLogStore; secrets: ManagedSecretVault };
  constructor(options: { now: () => Date; logs: ManagedLogStore; secrets: ManagedSecretVault }) { this.options = options; }

  register(scope: ManagedScope, input: { name: string; signingSecretId: string; eventType: string }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.webhooks.manage");
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.name) || !/^[a-z][a-z0-9.]{2,95}$/.test(input.eventType)) throw new ManagedPlatformError("WEBHOOK_INVALID", "Webhook metadata is invalid.");
    this.options.secrets.resolveForRuntime(scope, input.signingSecretId, "webhook");
    const endpoint: WebhookEndpoint = { id: `webhook_${randomUUID()}`, scopeKey: scope.scopeKey, name: input.name, signingSecretId: input.signingSecretId, eventType: input.eventType, status: "active", createdAt: this.options.now().toISOString() };
    this.endpoints.set(endpoint.id, endpoint);
    return clone(endpoint);
  }

  receive(scope: ManagedScope, endpointId: string, input: { body: string; timestamp: number; nonce: string; signature: string }) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint || endpoint.scopeKey !== scope.scopeKey || endpoint.status !== "active") throw new ManagedPlatformError("WEBHOOK_NOT_FOUND", "Webhook endpoint does not exist.");
    if (Buffer.byteLength(input.body) > 512_000 || !/^[A-Za-z0-9_-]{6,128}$/.test(input.nonce) || !/^[a-f0-9]{64}$/i.test(input.signature)) throw new ManagedPlatformError("WEBHOOK_REQUEST_INVALID", "Webhook request is invalid.");
    const nowSeconds = Math.floor(this.options.now().getTime() / 1000);
    for (const [key, expiresAt] of this.replayKeys) if (expiresAt <= nowSeconds) this.replayKeys.delete(key);
    if (!Number.isSafeInteger(input.timestamp) || Math.abs(nowSeconds - input.timestamp) > 300) throw new ManagedPlatformError("WEBHOOK_TIMESTAMP_INVALID", "Webhook timestamp is outside the replay window.");
    const replayKey = `${scope.scopeKey}:${endpointId}:${input.timestamp}:${input.nonce}`;
    if (this.replayKeys.has(replayKey)) throw new ManagedPlatformError("WEBHOOK_REPLAY", "Webhook replay was rejected.");
    const secret = this.options.secrets.resolveForRuntime(scope, endpoint.signingSecretId, "webhook");
    const expected = createHmac("sha256", secret).update(`${input.timestamp}.${input.nonce}.${input.body}`).digest("hex");
    if (!safeEqual(input.signature.toLowerCase(), expected)) throw new ManagedPlatformError("WEBHOOK_SIGNATURE_INVALID", "Webhook signature is invalid.");
    let payload: unknown;
    try { payload = JSON.parse(input.body); } catch { throw new ManagedPlatformError("WEBHOOK_JSON_INVALID", "Webhook payload must be valid JSON."); }
    this.replayKeys.set(replayKey, input.timestamp + 300);
    const event: WebhookEvent = { id: `webhook_event_${randomUUID()}`, endpointId, scopeKey: scope.scopeKey, eventType: endpoint.eventType, payload: sanitizeLogValue(payload), receivedAt: this.options.now().toISOString() };
    this.events.set(event.id, event);
    this.options.logs.append(scope, { category: "webhook", severity: "info", action: "webhook.accepted", actorId: "webhook-provider", requestId: event.id, metadata: { endpointId, eventType: event.eventType, payload } });
    return { status: "accepted" as const, eventId: event.id, providerEvidence: { signatureVerified: true, replayProtected: true } };
  }

  replay(scope: ManagedScope, eventId: string, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.webhooks.replay");
    const event = this.events.get(eventId);
    if (!event || event.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("WEBHOOK_EVENT_NOT_FOUND", "Webhook event does not exist.");
    return clone({ ...event, replayedBy: principal.actorId, replayedAt: this.options.now().toISOString() });
  }

  exportConfiguration(scope: ManagedScope) {
    return clone([...this.endpoints.values()].filter((entry) => entry.scopeKey === scope.scopeKey).map(({ signingSecretId, ...entry }) => ({ ...entry, signingSecretReference: signingSecretId })));
  }
}

interface ManagedJob {
  id: string;
  scopeKey: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead-letter" | "cancelled";
  attempts: number;
  maxAttempts: number;
  runAt: string;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export class ManagedJobService {
  private readonly jobs = new Map<string, ManagedJob>();
  private readonly idempotency = new Map<string, string>();
  private readonly options: { now: () => Date; logs: ManagedLogStore; limits: ManagedPlatformLimits };
  constructor(options: { now: () => Date; logs: ManagedLogStore; limits: ManagedPlatformLimits }) { this.options = options; }

  enqueue(scope: ManagedScope, input: { type: string; payload: unknown; idempotencyKey: string; maxAttempts?: number; delayMs?: number }, principal: ManagedPrincipal): ManagedJob {
    assertScope(scope, principal);
    requirePermission(principal, "backend.jobs.manage");
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.type) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new ManagedPlatformError("JOB_INVALID", "Job metadata is invalid.");
    const key = `${scope.scopeKey}:${input.type}:${input.idempotencyKey}`;
    const existingId = this.idempotency.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      if (stableJson(existing.payload) !== stableJson(input.payload)) throw new ManagedPlatformError("JOB_IDEMPOTENCY_CONFLICT", "Job idempotency key was reused with different payload.");
      return clone(existing);
    }
    if ([...this.jobs.values()].filter((job) => job.scopeKey === scope.scopeKey && ["queued", "running"].includes(job.status)).length >= this.options.limits.maxJobsPerEnvironment) throw new ManagedPlatformError("JOB_QUOTA_EXCEEDED", "Job queue quota exceeded.");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new ManagedPlatformError("JOB_RETRY_INVALID", "Job retry policy is invalid.");
    const timestamp = this.options.now().toISOString();
    const job: ManagedJob = { id: `job_${randomUUID()}`, scopeKey: scope.scopeKey, type: input.type, payload: clone(input.payload), idempotencyKey: input.idempotencyKey, status: "queued", attempts: 0, maxAttempts, runAt: new Date(this.options.now().getTime() + (input.delayMs ?? 0)).toISOString(), createdAt: timestamp, updatedAt: timestamp };
    this.jobs.set(job.id, job);
    this.idempotency.set(key, job.id);
    return clone(job);
  }

  async runNext(scope: ManagedScope, handlers: Record<string, (payload: unknown) => Promise<unknown> | unknown>): Promise<ManagedJob> {
    const job = [...this.jobs.values()].filter((entry) => entry.scopeKey === scope.scopeKey && entry.status === "queued" && Date.parse(entry.runAt) <= this.options.now().getTime()).sort((left, right) => left.runAt.localeCompare(right.runAt) || left.id.localeCompare(right.id))[0];
    if (!job) throw new ManagedPlatformError("JOB_NOT_AVAILABLE", "No queued job is ready.");
    const handler = handlers[job.type];
    if (!handler) throw new ManagedPlatformError("JOB_HANDLER_MISSING", "Job handler is not configured.");
    job.status = "running";
    job.attempts += 1;
    job.updatedAt = this.options.now().toISOString();
    try {
      job.result = sanitizeLogValue(await handler(clone(job.payload)));
      job.status = "succeeded";
      this.options.logs.append(scope, { category: "job", severity: "info", action: "job.succeeded", actorId: "job-runner", requestId: job.id, metadata: { jobId: job.id, type: job.type, attempt: job.attempts, result: job.result } });
    } catch (error) {
      job.status = job.attempts >= job.maxAttempts ? "dead-letter" : "queued";
      job.runAt = new Date(this.options.now().getTime() + Math.min(60_000, 1_000 * 2 ** job.attempts)).toISOString();
      this.options.logs.append(scope, { category: "job", severity: "error", action: "job.failed", actorId: "job-runner", requestId: job.id, metadata: { jobId: job.id, type: job.type, attempt: job.attempts, nextState: job.status, error: error instanceof Error ? error.message : "unknown" } });
    }
    job.updatedAt = this.options.now().toISOString();
    return clone(job);
  }

  cancel(scope: ManagedScope, jobId: string, principal: ManagedPrincipal): ManagedJob {
    assertScope(scope, principal);
    requirePermission(principal, "backend.jobs.manage");
    const job = this.jobs.get(jobId);
    if (!job || job.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("JOB_NOT_FOUND", "Job does not exist.");
    if (job.status !== "queued") throw new ManagedPlatformError("JOB_NOT_CANCELLABLE", "Only queued jobs may be cancelled.");
    job.status = "cancelled";
    job.updatedAt = this.options.now().toISOString();
    return clone(job);
  }

  exportMetadata(scope: ManagedScope): ManagedJob[] {
    return clone([...this.jobs.values()].filter((job) => job.scopeKey === scope.scopeKey));
  }
}

function zonedParts(date: Date, timezone: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, minute: "2-digit", hour: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit", weekday: "short" });
  } catch { throw new ManagedPlatformError("CRON_TIMEZONE_INVALID", "Cron timezone is invalid."); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month), weekday: weekdays[parts.weekday] };
}

function parseCronPart(value: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const segment of value.split(",")) {
    if (segment === "*") { for (let index = min; index <= max; index++) result.add(index); continue; }
    const step = segment.match(/^\*\/(\d{1,2})$/);
    if (step) {
      const increment = Number(step[1]);
      if (increment < 1 || increment > max - min + 1) throw new ManagedPlatformError("CRON_INVALID", "Cron step is invalid.");
      for (let index = min; index <= max; index += increment) result.add(index);
      continue;
    }
    const range = segment.match(/^(\d{1,2})-(\d{1,2})$/);
    if (range) {
      const start = Number(range[1]); const end = Number(range[2]);
      if (start < min || end > max || start > end) throw new ManagedPlatformError("CRON_INVALID", "Cron range is invalid.");
      for (let index = start; index <= end; index++) result.add(index);
      continue;
    }
    const number = Number(segment);
    if (!Number.isInteger(number) || number < min || number > max) throw new ManagedPlatformError("CRON_INVALID", "Cron value is invalid.");
    result.add(number);
  }
  return result;
}

export function nextCronOccurrence(expression: string, timezone: string, from: Date): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || expression.length > 100) throw new ManagedPlatformError("CRON_INVALID", "Cron expression must contain five bounded fields.");
  const allowed = [parseCronPart(parts[0], 0, 59), parseCronPart(parts[1], 0, 23), parseCronPart(parts[2], 1, 31), parseCronPart(parts[3], 1, 12), parseCronPart(parts[4], 0, 6)];
  const dayOfMonthWildcard = parts[2] === "*";
  const dayOfWeekWildcard = parts[4] === "*";
  const cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  for (let iteration = 0; iteration < 527_040; iteration++, cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)) {
    const current = zonedParts(cursor, timezone);
    const dayOfMonthMatches = allowed[2].has(current.day);
    const dayOfWeekMatches = allowed[4].has(current.weekday);
    const dayMatches = dayOfMonthWildcard
      ? dayOfWeekMatches
      : dayOfWeekWildcard
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches;
    if (allowed[0].has(current.minute) && allowed[1].has(current.hour) && dayMatches && allowed[3].has(current.month)) return cursor.toISOString();
  }
  throw new ManagedPlatformError("CRON_NEXT_RUN_UNAVAILABLE", "Cron expression has no run within one year.");
}

interface ManagedSchedule {
  id: string;
  scopeKey: string;
  name: string;
  expression: string;
  timezone: string;
  jobType: string;
  enabled: boolean;
  overlapPolicy: "skip" | "queue";
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export class ManagedCronService {
  private readonly schedules = new Map<string, ManagedSchedule>();
  private readonly options: { now: () => Date; logs: ManagedLogStore };
  constructor(options: { now: () => Date; logs: ManagedLogStore }) { this.options = options; }
  create(scope: ManagedScope, input: Omit<ManagedSchedule, "id" | "scopeKey" | "nextRunAt" | "lastRunAt" | "createdAt">, principal: ManagedPrincipal, options: { approvalReceipt?: string } = {}): ManagedSchedule {
    assertScope(scope, principal);
    requirePermission(principal, "backend.cron.manage");
    if (scope.environment === "production" && input.enabled) requireApproval(options.approvalReceipt);
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.name) || !/^[a-z][a-z0-9-]{1,63}$/.test(input.jobType)) throw new ManagedPlatformError("CRON_INVALID", "Cron metadata is invalid.");
    if (!(["skip", "queue"] as const).includes(input.overlapPolicy)) throw new ManagedPlatformError("CRON_INVALID", "Cron overlap policy is invalid.");
    const validatedNextRunAt = nextCronOccurrence(input.expression, input.timezone, this.options.now());
    const nextRunAt = input.enabled ? validatedNextRunAt : null;
    const schedule: ManagedSchedule = { ...clone(input), id: `cron_${randomUUID()}`, scopeKey: scope.scopeKey, nextRunAt, lastRunAt: null, createdAt: this.options.now().toISOString() };
    this.schedules.set(schedule.id, schedule);
    return clone(schedule);
  }
  due(scope: ManagedScope): ManagedSchedule[] {
    return clone([...this.schedules.values()].filter((schedule) => schedule.scopeKey === scope.scopeKey && schedule.enabled && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= this.options.now().getTime()));
  }
}

interface RealtimeEvent {
  sequence: number;
  collection: string;
  operation: "created" | "updated" | "deleted";
  data: unknown;
  createdAt: string;
}
interface RealtimeSubscription {
  id: string;
  scopeKey: string;
  collection: string;
  cursor: number;
  createdAt: string;
}

export class ManagedRealtimeService {
  readonly mode = "in-memory-test" as const;
  private readonly events = new Map<string, RealtimeEvent[]>();
  private readonly subscriptions = new Map<string, RealtimeSubscription>();
  private readonly options: { now: () => Date; limits: ManagedPlatformLimits; logs: ManagedLogStore };
  constructor(options: { now: () => Date; limits: ManagedPlatformLimits; logs: ManagedLogStore }) { this.options = options; }

  subscribe(scope: ManagedScope, input: { collection: string }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.realtime.read");
    if (!/^[a-z][a-zA-Z0-9_]{1,63}$/.test(input.collection)) throw new ManagedPlatformError("REALTIME_COLLECTION_INVALID", "Realtime collection is invalid.");
    if ([...this.subscriptions.values()].filter((entry) => entry.scopeKey === scope.scopeKey).length >= this.options.limits.maxRealtimeSubscriptions) throw new ManagedPlatformError("REALTIME_CONNECTION_LIMIT", "Realtime connection limit exceeded.");
    const id = `subscription_${randomUUID()}`;
    const subscription: RealtimeSubscription = { id, scopeKey: scope.scopeKey, collection: input.collection, cursor: 0, createdAt: this.options.now().toISOString() };
    this.subscriptions.set(id, subscription);
    return clone({ ...subscription, mode: this.mode });
  }

  publish(scope: ManagedScope, collection: string, operation: RealtimeEvent["operation"], data: unknown, principal: ManagedPrincipal): RealtimeEvent {
    assertScope(scope, principal);
    requirePermission(principal, "backend.realtime.publish");
    if (!/^[a-z][a-zA-Z0-9_]{1,63}$/.test(collection) || !(["created", "updated", "deleted"] as const).includes(operation)) throw new ManagedPlatformError("REALTIME_EVENT_INVALID", "Realtime event metadata is invalid.");
    const current = this.events.get(scope.scopeKey) ?? [];
    const event: RealtimeEvent = { sequence: (current.at(-1)?.sequence ?? 0) + 1, collection, operation, data: sanitizeLogValue(data), createdAt: this.options.now().toISOString() };
    current.push(event);
    if (current.length > this.options.limits.maxRealtimeEvents) current.splice(0, current.length - this.options.limits.maxRealtimeEvents);
    this.events.set(scope.scopeKey, current);
    return clone(event);
  }

  poll(scope: ManagedScope, input: { id: string }, principal: ManagedPrincipal) {
    assertScope(scope, principal);
    requirePermission(principal, "backend.realtime.read");
    const subscription = this.subscriptions.get(input.id);
    if (!subscription || subscription.scopeKey !== scope.scopeKey) throw new ManagedPlatformError("REALTIME_SUBSCRIPTION_NOT_FOUND", "Realtime subscription does not exist in this scope.");
    const events = (this.events.get(scope.scopeKey) ?? []).filter((event) => event.collection === subscription.collection && event.sequence > subscription.cursor).slice(0, 100);
    if (events.length) subscription.cursor = events.at(-1)!.sequence;
    return { events: clone(events), nextCursor: subscription.cursor, mode: this.mode };
  }
}
