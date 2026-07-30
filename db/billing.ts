import { BlobPreconditionFailedError } from "@vercel/blob";

import type {
  BillingAccountRecord,
  BillingSubscriptionStatus,
  BillingWebhookEvent,
} from "../lib/billing.ts";

const BLOB_PATH = "drops-studio/billing/state-v1.json";
const MAX_ACCOUNTS = 10_000;
const MAX_EVENTS = 20_000;
const MAX_STATE_BYTES = 8 * 1_024 * 1_024;
const BILLING_PLACEHOLDER_UPDATED_AT = "1970-01-01T00:00:00.000Z";

const ACCOUNT_SCHEMA = `CREATE TABLE IF NOT EXISTS billing_accounts (
  account_identity TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  price_id TEXT,
  status TEXT NOT NULL,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`;
const EVENT_SCHEMA = `CREATE TABLE IF NOT EXISTS billing_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
)`;

interface BillingState {
  schemaVersion: 1;
  accounts: BillingAccountRecord[];
  events: { id: string; type: string; processedAt: string }[];
}

type BlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put">;

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
  var __DROPS_STUDIO_LOCAL_BILLING__: BillingState | undefined;
}

export class BillingStorageUnavailableError extends Error {
  constructor(message = "Billing storage is temporarily unavailable.") {
    super(message);
    this.name = "BillingStorageUnavailableError";
  }
}

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function localEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

export function billingStorageConfigured(): boolean {
  return localEnabled() || Boolean(database()) || blobConfigured();
}

function emptyState(): BillingState {
  return { schemaVersion: 1, accounts: [], events: [] };
}

function localState(): BillingState {
  return globalThis.__DROPS_STUDIO_LOCAL_BILLING__ ??= emptyState();
}

export function resetLocalBillingStateForTests(): void {
  globalThis.__DROPS_STUDIO_LOCAL_BILLING__ = emptyState();
}

function validIdentity(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validStripeId(value: string | null, prefix: string): boolean {
  return value === null || new RegExp(`^${prefix}_[A-Za-z0-9_]{6,255}$`).test(value);
}

function validStatus(value: unknown): value is BillingSubscriptionStatus {
  return [
    "none",
    "active",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "paused",
    "trialing",
    "unpaid",
  ].includes(String(value));
}

function sanitizedAccount(value: unknown): BillingAccountRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BillingStorageUnavailableError();
  }
  const input = value as Partial<BillingAccountRecord>;
  if (
    typeof input.accountIdentity !== "string"
    || !validIdentity(input.accountIdentity)
    || typeof input.stripeCustomerId !== "string"
    || !validStripeId(input.stripeCustomerId, "cus")
    || !validStripeId(input.stripeSubscriptionId ?? null, "sub")
    || !validStripeId(input.priceId ?? null, "price")
    || !validStatus(input.status)
    || (input.currentPeriodEnd !== null
      && (typeof input.currentPeriodEnd !== "string"
        || !Number.isFinite(Date.parse(input.currentPeriodEnd))))
    || typeof input.cancelAtPeriodEnd !== "boolean"
    || typeof input.updatedAt !== "string"
    || !Number.isFinite(Date.parse(input.updatedAt))
  ) {
    throw new BillingStorageUnavailableError("Billing storage returned invalid account data.");
  }
  return {
    accountIdentity: input.accountIdentity,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    priceId: input.priceId ?? null,
    status: input.status,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    updatedAt: input.updatedAt,
  };
}

function parseState(value: unknown): BillingState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BillingStorageUnavailableError();
  }
  const input = value as Partial<BillingState>;
  if (
    input.schemaVersion !== 1
    || !Array.isArray(input.accounts)
    || input.accounts.length > MAX_ACCOUNTS
    || !Array.isArray(input.events)
    || input.events.length > MAX_EVENTS
  ) {
    throw new BillingStorageUnavailableError("Billing storage returned invalid state.");
  }
  const accounts = input.accounts.map(sanitizedAccount);
  const events = input.events.map((event) => {
    if (
      !event || typeof event !== "object"
      || typeof event.id !== "string"
      || !/^evt_[A-Za-z0-9_]{6,255}$/.test(event.id)
      || typeof event.type !== "string"
      || event.type.length > 100
      || typeof event.processedAt !== "string"
      || !Number.isFinite(Date.parse(event.processedAt))
    ) {
      throw new BillingStorageUnavailableError("Billing storage returned invalid event data.");
    }
    return { id: event.id, type: event.type, processedAt: event.processedAt };
  });
  if (
    new Set(accounts.map((account) => account.accountIdentity)).size !== accounts.length
    || new Set(accounts.map((account) => account.stripeCustomerId)).size !== accounts.length
    || new Set(accounts
      .map((account) => account.stripeSubscriptionId)
      .filter((subscriptionId): subscriptionId is string => subscriptionId !== null)).size
      !== accounts.filter((account) => account.stripeSubscriptionId !== null).length
    || new Set(events.map((event) => event.id)).size !== events.length
  ) {
    throw new BillingStorageUnavailableError("Billing storage returned duplicate mappings.");
  }
  return { schemaVersion: 1, accounts, events };
}

function serialized(state: BillingState): string {
  const value = JSON.stringify(state);
  if (new TextEncoder().encode(value).byteLength > MAX_STATE_BYTES) {
    throw new BillingStorageUnavailableError("Billing storage reached its safe capacity.");
  }
  return value;
}

async function ensureTables(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(ACCOUNT_SCHEMA).run();
  await db.prepare(EVENT_SCHEMA).run();
  return db;
}

function rowAccount(row: Record<string, unknown>): BillingAccountRecord {
  return sanitizedAccount({
    accountIdentity: row.account_identity,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    priceId: row.price_id ?? null,
    status: row.status,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: Number(row.cancel_at_period_end) === 1,
    updatedAt: row.updated_at,
  });
}

async function blobStorage(override?: BlobStorage): Promise<BlobStorage> {
  return override ?? import("@vercel/blob");
}

async function readBlob(storage: BlobStorage): Promise<{ state: BillingState; etag: string | null }> {
  const current = await storage.get(BLOB_PATH, { access: "private", useCache: false });
  if (!current) return { state: emptyState(), etag: null };
  if (current.statusCode !== 200 || !current.blob.etag) throw new BillingStorageUnavailableError();
  try {
    return {
      state: parseState(JSON.parse(await new Response(current.stream).text()) as unknown),
      etag: current.blob.etag,
    };
  } catch (error) {
    if (error instanceof BillingStorageUnavailableError) throw error;
    throw new BillingStorageUnavailableError("Billing storage returned unreadable data.");
  }
}

async function mutateBlob<T>(
  storage: BlobStorage,
  mutate: (state: BillingState) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshot = await readBlob(storage);
    const next = structuredClone(snapshot.state);
    const result = mutate(next);
    try {
      await storage.put(BLOB_PATH, serialized(next), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(snapshot.etag),
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
        ...(snapshot.etag ? { ifMatch: snapshot.etag } : {}),
      });
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt === 7) {
        throw new BillingStorageUnavailableError();
      }
    }
  }
  throw new BillingStorageUnavailableError();
}

export async function readBillingAccount(
  identity: string,
  storageOverride?: BlobStorage,
): Promise<BillingAccountRecord | null> {
  if (!validIdentity(identity)) throw new Error("Billing requires a signed account identity.");
  if (!storageOverride && localEnabled()) {
    return structuredClone(localState().accounts.find((item) => item.accountIdentity === identity) ?? null);
  }
  const db = !storageOverride ? await ensureTables() : null;
  if (db) {
    const row = await db.prepare(
      "SELECT * FROM billing_accounts WHERE account_identity = ? LIMIT 1",
    ).bind(identity).first<Record<string, unknown>>();
    return row ? rowAccount(row) : null;
  }
  if (!storageOverride && !blobConfigured()) throw new BillingStorageUnavailableError();
  const storage = await blobStorage(storageOverride);
  const state = (await readBlob(storage)).state;
  return structuredClone(state.accounts.find((item) => item.accountIdentity === identity) ?? null);
}

function newCustomer(identity: string, customerId: string): BillingAccountRecord {
  return sanitizedAccount({
    accountIdentity: identity,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    priceId: null,
    status: "none",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    updatedAt: BILLING_PLACEHOLDER_UPDATED_AT,
  });
}

export async function saveBillingCustomer(
  identity: string,
  customerId: string,
  storageOverride?: BlobStorage,
): Promise<BillingAccountRecord> {
  const candidate = newCustomer(identity, customerId);
  if (!storageOverride && localEnabled()) {
    const state = localState();
    const current = state.accounts.find((item) => item.accountIdentity === identity);
    if (current) return structuredClone(current);
    if (state.accounts.some((item) => item.stripeCustomerId === customerId)) {
      throw new BillingStorageUnavailableError(
        "Billing customer mapping is already linked to another account.",
      );
    }
    state.accounts.push(candidate);
    return structuredClone(candidate);
  }
  const db = !storageOverride ? await ensureTables() : null;
  if (db) {
    const current = await readD1BillingAccount(db, "account_identity", identity);
    if (current) return current;
    const customerOwner = await readD1BillingAccount(db, "stripe_customer_id", customerId);
    if (customerOwner) {
      throw new BillingStorageUnavailableError(
        "Billing customer mapping is already linked to another account.",
      );
    }
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO billing_accounts
         (account_identity, stripe_customer_id, status, cancel_at_period_end, updated_at)
         VALUES (?, ?, 'none', 0, ?)`,
      ).bind(identity, customerId, candidate.updatedAt).run();
    } catch {
      throw new BillingStorageUnavailableError();
    }
    const saved = await readD1BillingAccount(db, "account_identity", identity);
    if (saved) return saved;
    const reconciledOwner = await readD1BillingAccount(db, "stripe_customer_id", customerId);
    if (reconciledOwner && reconciledOwner.accountIdentity !== identity) {
      throw new BillingStorageUnavailableError(
        "Billing customer mapping is already linked to another account.",
      );
    }
    throw new BillingStorageUnavailableError();
  }
  if (!storageOverride && !blobConfigured()) throw new BillingStorageUnavailableError();
  return mutateBlob(await blobStorage(storageOverride), (state) => {
    const current = state.accounts.find((item) => item.accountIdentity === identity);
    if (current) return structuredClone(current);
    if (state.accounts.some((item) => item.stripeCustomerId === customerId)) {
      throw new BillingStorageUnavailableError(
        "Billing customer mapping is already linked to another account.",
      );
    }
    if (state.accounts.length >= MAX_ACCOUNTS) throw new BillingStorageUnavailableError();
    state.accounts.push(candidate);
    return structuredClone(candidate);
  });
}

type BillingAccountColumn =
  | "account_identity"
  | "stripe_customer_id"
  | "stripe_subscription_id";

function reportBillingMappingConflict(): void {
  console.warn(
    "Drops Studio billing integrity event.",
    { code: "BILLING_MAPPING_CONFLICT", source: "stripe-webhook" },
  );
}

async function readD1BillingAccount(
  db: D1Database,
  column: BillingAccountColumn,
  value: string,
): Promise<BillingAccountRecord | null> {
  try {
    const row = await db.prepare(
      `SELECT * FROM billing_accounts WHERE ${column} = ? LIMIT 1`,
    ).bind(value).first<Record<string, unknown>>();
    return row ? rowAccount(row) : null;
  } catch (error) {
    if (error instanceof BillingStorageUnavailableError) throw error;
    throw new BillingStorageUnavailableError();
  }
}

function resolveEventMapping(
  event: BillingWebhookEvent,
  accounts: {
    identity: BillingAccountRecord | null;
    customer: BillingAccountRecord | null;
    subscription: BillingAccountRecord | null;
  },
): {
  conflict: boolean;
  identity: string | null;
  current: BillingAccountRecord | null;
} {
  const mappedIdentities = new Set([
    event.accountIdentity,
    accounts.customer?.accountIdentity ?? null,
    accounts.subscription?.accountIdentity ?? null,
  ].filter((identity): identity is string => identity !== null));
  const identity = event.accountIdentity
    ?? accounts.customer?.accountIdentity
    ?? accounts.subscription?.accountIdentity
    ?? null;
  const current = accounts.identity ?? accounts.customer ?? accounts.subscription;
  const identityCustomerConflict = Boolean(
    current
    && event.stripeCustomerId
    && current.stripeCustomerId !== event.stripeCustomerId,
  );
  return {
    conflict: mappedIdentities.size > 1 || identityCustomerConflict,
    identity,
    current,
  };
}

function resolveStateEventMapping(
  state: BillingState,
  event: BillingWebhookEvent,
): ReturnType<typeof resolveEventMapping> {
  return resolveEventMapping(event, {
    identity: event.accountIdentity
      ? state.accounts.find((item) => item.accountIdentity === event.accountIdentity) ?? null
      : null,
    customer: event.stripeCustomerId
      ? state.accounts.find((item) => item.stripeCustomerId === event.stripeCustomerId) ?? null
      : null,
    subscription: event.stripeSubscriptionId
      ? state.accounts.find((item) => item.stripeSubscriptionId === event.stripeSubscriptionId) ?? null
      : null,
  });
}

async function resolveD1EventMapping(
  db: D1Database,
  event: BillingWebhookEvent,
): Promise<ReturnType<typeof resolveEventMapping>> {
  const [identity, customer, subscription] = await Promise.all([
    event.accountIdentity
      ? readD1BillingAccount(db, "account_identity", event.accountIdentity)
      : null,
    event.stripeCustomerId
      ? readD1BillingAccount(db, "stripe_customer_id", event.stripeCustomerId)
      : null,
    event.stripeSubscriptionId
      ? readD1BillingAccount(db, "stripe_subscription_id", event.stripeSubscriptionId)
      : null,
  ]);
  return resolveEventMapping(event, { identity, customer, subscription });
}

async function d1EventReceiptExists(db: D1Database, eventId: string): Promise<boolean> {
  try {
    return Boolean(await db.prepare(
      "SELECT event_id FROM billing_events WHERE event_id = ? LIMIT 1",
    ).bind(eventId).first());
  } catch {
    throw new BillingStorageUnavailableError();
  }
}

async function recordD1EventReceipt(
  db: D1Database,
  event: BillingWebhookEvent,
  status: "ignored" | "stale",
): Promise<{ status: "duplicate" | "ignored" | "stale" }> {
  try {
    await db.prepare(
      "INSERT INTO billing_events (event_id, event_type, processed_at) VALUES (?, ?, ?)",
    ).bind(event.id, event.type, new Date().toISOString()).run();
    return { status };
  } catch {
    if (await d1EventReceiptExists(db, event.id)) return { status: "duplicate" };
    throw new BillingStorageUnavailableError();
  }
}

function validEvent(event: BillingWebhookEvent): void {
  if (
    !/^evt_[A-Za-z0-9_]{6,255}$/.test(event.id)
    || !event.type
    || event.type.length > 100
    || (event.mutation !== "subscription" && event.mutation !== "ignored")
    || !Number.isFinite(Date.parse(event.createdAt))
    || event.createdAt !== new Date(event.createdAt).toISOString()
    || (event.accountIdentity !== null && !validIdentity(event.accountIdentity))
    || !validStripeId(event.stripeCustomerId, "cus")
    || !validStripeId(event.stripeSubscriptionId, "sub")
    || !validStripeId(event.priceId, "price")
    || (event.status !== null && !validStatus(event.status))
    || (event.mutation === "subscription" && event.status === null)
  ) {
    throw new Error("Stripe webhook event is invalid.");
  }
}

function billingStatusPrecedence(status: BillingSubscriptionStatus): number {
  switch (status) {
    case "active":
    case "trialing":
      return 0;
    case "incomplete":
      return 1;
    case "past_due":
      return 2;
    case "paused":
      return 3;
    case "unpaid":
      return 4;
    case "canceled":
    case "incomplete_expired":
      return 5;
    case "none":
      return 6;
  }
}

function staleSubscriptionEvent(
  current: Pick<BillingAccountRecord, "status" | "updatedAt">,
  event: BillingWebhookEvent,
): boolean {
  const eventTime = Date.parse(event.createdAt);
  const currentTime = Date.parse(current.updatedAt);
  if (eventTime !== currentTime) return eventTime < currentTime;
  const eventStatus = event.status ?? "none";
  // Stripe timestamps have one-second resolution and delivery is unordered.
  // At the same timestamp only a strictly more restrictive status may win;
  // equal/lower-precedence arrivals are receipted without reviving access.
  return billingStatusPrecedence(eventStatus) <= billingStatusPrecedence(current.status);
}

function applyEventToState(
  state: BillingState,
  event: BillingWebhookEvent,
): { status: "processed" | "duplicate" | "ignored" | "stale" } {
  if (state.events.some((item) => item.id === event.id)) return { status: "duplicate" };
  const processedAt = new Date().toISOString();
  state.events.push({ id: event.id, type: event.type, processedAt });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  if (event.mutation === "ignored") return { status: "ignored" };
  if (!event.stripeCustomerId) return { status: "ignored" };
  const mapping = resolveStateEventMapping(state, event);
  if (mapping.conflict) {
    reportBillingMappingConflict();
    return { status: "ignored" };
  }
  if (!mapping.identity) return { status: "ignored" };
  const { current, identity } = mapping;
  if (current && staleSubscriptionEvent(current, event)) {
    return { status: "stale" };
  }
  const next = sanitizedAccount({
    accountIdentity: identity,
    stripeCustomerId: event.stripeCustomerId,
    stripeSubscriptionId: event.stripeSubscriptionId ?? current?.stripeSubscriptionId ?? null,
    priceId: event.priceId ?? current?.priceId ?? null,
    status: event.status ?? current?.status ?? "none",
    currentPeriodEnd: event.currentPeriodEnd ?? current?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: event.cancelAtPeriodEnd,
    updatedAt: event.createdAt,
  });
  if (current) Object.assign(current, next);
  else {
    if (state.accounts.length >= MAX_ACCOUNTS) throw new BillingStorageUnavailableError();
    state.accounts.push(next);
  }
  return { status: "processed" };
}

export async function applyBillingWebhookEvent(
  event: BillingWebhookEvent,
  storageOverride?: BlobStorage,
): Promise<{ status: "processed" | "duplicate" | "ignored" | "stale" }> {
  const createdAt = Date.parse(event.createdAt);
  event = {
    ...event,
    createdAt: Number.isFinite(createdAt)
      ? new Date(createdAt).toISOString()
      : event.createdAt,
  };
  validEvent(event);
  if (!storageOverride && localEnabled()) {
    return applyEventToState(localState(), event);
  }
  const db = !storageOverride ? await ensureTables() : null;
  if (db) {
    if (await d1EventReceiptExists(db, event.id)) return { status: "duplicate" };
    if (event.mutation === "ignored") {
      return recordD1EventReceipt(db, event, "ignored");
    }
    const mapping = await resolveD1EventMapping(db, event);
    if (mapping.conflict) {
      reportBillingMappingConflict();
      return recordD1EventReceipt(db, event, "ignored");
    }
    if (!mapping.identity || !event.stripeCustomerId) {
      return recordD1EventReceipt(db, event, "ignored");
    }
    const { current, identity } = mapping;
    const stale = current && staleSubscriptionEvent(current, event);
    if (stale) return recordD1EventReceipt(db, event, "stale");
    const statements = [
      db.prepare(
        "INSERT INTO billing_events (event_id, event_type, processed_at) VALUES (?, ?, ?)",
      ).bind(event.id, event.type, new Date().toISOString()),
    ];
    if (identity && event.stripeCustomerId && !stale) {
      statements.push(db.prepare(
        `INSERT INTO billing_accounts
         (account_identity, stripe_customer_id, stripe_subscription_id, price_id, status,
          current_period_end, cancel_at_period_end, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_identity) DO UPDATE SET
          stripe_customer_id = excluded.stripe_customer_id,
          stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, billing_accounts.stripe_subscription_id),
          price_id = COALESCE(excluded.price_id, billing_accounts.price_id),
          status = CASE WHEN excluded.status = 'none' THEN billing_accounts.status ELSE excluded.status END,
          current_period_end = COALESCE(excluded.current_period_end, billing_accounts.current_period_end),
         cancel_at_period_end = excluded.cancel_at_period_end,
          updated_at = excluded.updated_at
         WHERE billing_accounts.stripe_customer_id = excluded.stripe_customer_id
          AND (
            excluded.updated_at > billing_accounts.updated_at
            OR (
              excluded.updated_at = billing_accounts.updated_at
              AND CASE excluded.status
                WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
                WHEN 'incomplete' THEN 1 WHEN 'past_due' THEN 2
                WHEN 'paused' THEN 3 WHEN 'unpaid' THEN 4
                WHEN 'canceled' THEN 5 WHEN 'incomplete_expired' THEN 5
                ELSE 6 END
              > CASE billing_accounts.status
                WHEN 'active' THEN 0 WHEN 'trialing' THEN 0
                WHEN 'incomplete' THEN 1 WHEN 'past_due' THEN 2
                WHEN 'paused' THEN 3 WHEN 'unpaid' THEN 4
                WHEN 'canceled' THEN 5 WHEN 'incomplete_expired' THEN 5
                ELSE 6 END
            )
          )`,
      ).bind(
        identity,
        event.stripeCustomerId,
        event.stripeSubscriptionId,
        event.priceId,
        event.status ?? "none",
        event.currentPeriodEnd,
        event.cancelAtPeriodEnd ? 1 : 0,
        event.createdAt,
      ));
    }
    try {
      const results = await db.batch(statements);
      if (results[1]?.meta?.changes === 0) return { status: "stale" };
    } catch {
      if (await d1EventReceiptExists(db, event.id)) return { status: "duplicate" };
      const reconciled = await resolveD1EventMapping(db, event);
      if (reconciled.conflict) {
        reportBillingMappingConflict();
        return recordD1EventReceipt(db, event, "ignored");
      }
      throw new BillingStorageUnavailableError();
    }
    return { status: "processed" };
  }
  if (!storageOverride && !blobConfigured()) throw new BillingStorageUnavailableError();
  return mutateBlob(await blobStorage(storageOverride), (state) =>
    applyEventToState(state, event));
}

export const billingRepository = {
  readAccount: readBillingAccount,
  saveCustomer: saveBillingCustomer,
};
