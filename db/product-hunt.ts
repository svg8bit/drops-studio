import { BlobPreconditionFailedError } from "@vercel/blob";

import {
  productUrlKey,
  publicProductHuntLaunch,
  type ProductHuntLaunch,
  type ProductHuntSort,
  type ProductHuntSourceEvidence,
  type ProductHuntStorageEvidence,
  type ProductHuntSubmission,
  type StoredProductHuntLaunch,
} from "../lib/product-hunt-community.ts";

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
  var __DROPS_STUDIO_LOCAL_PRODUCT_HUNT__: ProductHuntBlobState | undefined;
}

const launchSchema = `CREATE TABLE IF NOT EXISTS product_hunt_launches (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  maker_name TEXT,
  drops_studio_slug TEXT,
  source_evidence TEXT NOT NULL,
  submitter_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0
)`;
const voteSchema = `CREATE TABLE IF NOT EXISTS product_hunt_votes (
  launch_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (launch_id, voter_hash)
)`;
const voteTrigger = `CREATE TRIGGER IF NOT EXISTS product_hunt_vote_count_after_insert
AFTER INSERT ON product_hunt_votes
BEGIN
  UPDATE product_hunt_launches SET vote_count = vote_count + 1 WHERE id = NEW.launch_id;
END`;
const topIndex = "CREATE INDEX IF NOT EXISTS product_hunt_launches_top_idx ON product_hunt_launches (vote_count DESC, created_at DESC)";
const newIndex = "CREATE INDEX IF NOT EXISTS product_hunt_launches_new_idx ON product_hunt_launches (created_at DESC)";
const BLOB_PATH = "drops-studio/product-hunt/community-state-v1.json";
const MAX_BLOB_LAUNCHES = 500;
const MAX_BLOB_VOTE_RECEIPTS = 50_000;

interface ProductHuntBlobState {
  version: 1;
  launches: StoredProductHuntLaunch[];
  votes: Record<string, string[]>;
}

interface BlobSnapshot {
  state: ProductHuntBlobState;
  etag: string | null;
}

export class ProductHuntStorageUnavailableError extends Error {
  constructor(message = "The community launch store is temporarily unavailable.") {
    super(message);
    this.name = "ProductHuntStorageUnavailableError";
  }
}

export class DuplicateProductHuntLaunchError extends Error {
  constructor() {
    super("This public URL already has a community launch.");
    this.name = "DuplicateProductHuntLaunchError";
  }
}

export class ProductHuntLaunchNotFoundError extends Error {
  constructor() {
    super("Community launch not found.");
    this.name = "ProductHuntLaunchNotFoundError";
  }
}

export class ProductHuntCapacityError extends Error {
  constructor() {
    super("The fallback community store reached its safe capacity. Connect Cloudflare D1 before accepting more activity.");
    this.name = "ProductHuntCapacityError";
  }
}

function emptyState(): ProductHuntBlobState {
  return { version: 1, launches: [], votes: {} };
}

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function blobAvailable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
}

function localState(): ProductHuntBlobState | null {
  if (process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE !== "1" || process.env.VERCEL) return null;
  return globalThis.__DROPS_STUDIO_LOCAL_PRODUCT_HUNT__ ??= emptyState();
}

function isStoredLaunch(value: unknown): value is StoredProductHuntLaunch {
  if (!value || typeof value !== "object") return false;
  const launch = value as Partial<StoredProductHuntLaunch>;
  return typeof launch.id === "string"
    && typeof launch.slug === "string"
    && typeof launch.name === "string"
    && typeof launch.tagline === "string"
    && typeof launch.description === "string"
    && typeof launch.url === "string"
    && typeof launch.urlKey === "string"
    && typeof launch.category === "string"
    && typeof launch.submitterHash === "string"
    && typeof launch.createdAt === "string"
    && typeof launch.voteCount === "number"
    && launch.evidence?.listing === "community-submitted"
    && launch.evidence?.votes === "browser-session-deduplicated"
    && launch.evidence?.moderation === "unreviewed";
}

function isBlobState(value: unknown): value is ProductHuntBlobState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ProductHuntBlobState>;
  return state.version === 1
    && Array.isArray(state.launches)
    && state.launches.every(isStoredLaunch)
    && Boolean(state.votes)
    && typeof state.votes === "object"
    && Object.values(state.votes).every((votes) => Array.isArray(votes) && votes.every((vote) => typeof vote === "string"));
}

async function ensureProductHuntTables(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(launchSchema).run();
  await db.prepare(voteSchema).run();
  await db.prepare(voteTrigger).run();
  await db.prepare(topIndex).run();
  await db.prepare(newIndex).run();
  return db;
}

async function loadBlobState(): Promise<BlobSnapshot> {
  const { get } = await import("@vercel/blob");
  const current = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!current) return { state: emptyState(), etag: null };
  if (current.statusCode !== 200) throw new ProductHuntStorageUnavailableError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await new Response(current.stream).text()) as unknown;
  } catch {
    throw new ProductHuntStorageUnavailableError("The community store returned unreadable data.");
  }
  if (!isBlobState(parsed)) throw new ProductHuntStorageUnavailableError("The community store failed its integrity check.");
  return { state: parsed, etag: current.blob.etag };
}

async function putBlobState(state: ProductHuntBlobState, etag: string | null): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(BLOB_PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export function shouldRetryProductHuntBlobMutation(error: unknown): boolean {
  return error instanceof BlobPreconditionFailedError;
}

async function waitForBlobRetry(attempt: number): Promise<void> {
  const baseDelayMs = Math.min(160, 10 * (2 ** attempt));
  const jitterMs = Math.floor(Math.random() * Math.max(1, baseDelayMs));
  await new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
}

async function mutateBlobState<T>(mutator: (state: ProductHuntBlobState) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshot = await loadBlobState();
    const next = structuredClone(snapshot.state);
    const result = mutator(next);
    try {
      await putBlobState(next, snapshot.etag);
      return result;
    } catch (error) {
      if (!shouldRetryProductHuntBlobMutation(error)) throw error;
      if (attempt < 7) await waitForBlobRetry(attempt);
    }
  }
  throw new ProductHuntStorageUnavailableError("The community store was busy. Retry the request.");
}

function storedLaunch(options: {
  id: string;
  slug: string;
  submission: ProductHuntSubmission;
  submitterHash: string;
  createdAt: string;
  sourceEvidence: ProductHuntSourceEvidence;
}): StoredProductHuntLaunch {
  return {
    id: options.id,
    slug: options.slug,
    name: options.submission.name,
    tagline: options.submission.tagline,
    description: options.submission.description,
    url: options.submission.url,
    urlKey: productUrlKey(options.submission.url),
    category: options.submission.category,
    makerName: options.submission.makerName,
    dropsStudioSlug: options.submission.dropsStudioSlug,
    submitterHash: options.submitterHash,
    createdAt: options.createdAt,
    voteCount: 0,
    evidence: {
      listing: "community-submitted",
      destination: options.sourceEvidence,
      votes: "browser-session-deduplicated",
      moderation: "unreviewed",
    },
  };
}

function fromD1Row(row: Record<string, unknown>): StoredProductHuntLaunch {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    tagline: String(row.tagline),
    description: String(row.description),
    url: String(row.url),
    urlKey: String(row.url_key),
    category: String(row.category) as StoredProductHuntLaunch["category"],
    makerName: row.maker_name == null ? null : String(row.maker_name),
    dropsStudioSlug: row.drops_studio_slug == null ? null : String(row.drops_studio_slug),
    submitterHash: String(row.submitter_hash),
    createdAt: String(row.created_at),
    voteCount: Math.max(0, Number(row.vote_count) || 0),
    evidence: {
      listing: "community-submitted",
      destination: String(row.source_evidence) as ProductHuntSourceEvidence,
      votes: "browser-session-deduplicated",
      moderation: "unreviewed",
    },
  };
}

export async function insertProductHuntLaunch(options: {
  id: string;
  slug: string;
  submission: ProductHuntSubmission;
  submitterHash: string;
  createdAt: string;
  sourceEvidence: ProductHuntSourceEvidence;
}): Promise<{ launch: ProductHuntLaunch; storage: ProductHuntStorageEvidence }> {
  const launch = storedLaunch(options);
  const local = localState();
  if (local) {
    if (local.launches.some((item) => item.urlKey === launch.urlKey)) throw new DuplicateProductHuntLaunchError();
    local.launches.push(structuredClone(launch));
    return { launch: publicProductHuntLaunch(launch, false), storage: "local-memory" };
  }

  const db = await ensureProductHuntTables();
  if (db) {
    const duplicate = await db.prepare("SELECT id FROM product_hunt_launches WHERE url_key = ? LIMIT 1").bind(launch.urlKey).first();
    if (duplicate) throw new DuplicateProductHuntLaunchError();
    try {
      await db.prepare(
        `INSERT INTO product_hunt_launches
        (id, slug, name, tagline, description, url, url_key, category, maker_name, drops_studio_slug, source_evidence, submitter_hash, created_at, vote_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).bind(
        launch.id,
        launch.slug,
        launch.name,
        launch.tagline,
        launch.description,
        launch.url,
        launch.urlKey,
        launch.category,
        launch.makerName,
        launch.dropsStudioSlug,
        launch.evidence.destination,
        launch.submitterHash,
        launch.createdAt,
      ).run();
    } catch (error) {
      if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) throw new DuplicateProductHuntLaunchError();
      throw error;
    }
    return { launch: publicProductHuntLaunch(launch, false), storage: "cloudflare-d1" };
  }

  if (blobAvailable()) {
    const result = await mutateBlobState((state) => {
      if (state.launches.some((item) => item.urlKey === launch.urlKey)) throw new DuplicateProductHuntLaunchError();
      if (state.launches.length >= MAX_BLOB_LAUNCHES) throw new ProductHuntCapacityError();
      state.launches.push(launch);
      return publicProductHuntLaunch(launch, false);
    });
    return { launch: result, storage: "vercel-blob" };
  }

  throw new ProductHuntStorageUnavailableError();
}

export async function listProductHuntLaunches(options: {
  sort: ProductHuntSort;
  limit: number;
  viewerHash: string;
}): Promise<{ launches: ProductHuntLaunch[]; total: number; storage: ProductHuntStorageEvidence }> {
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit)));
  const local = localState();
  if (local) {
    const launches = structuredClone(local.launches)
      .sort(options.sort === "top"
        ? (left, right) => right.voteCount - left.voteCount || right.createdAt.localeCompare(left.createdAt)
        : (left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((launch) => publicProductHuntLaunch(launch, (local.votes[launch.id] ?? []).includes(options.viewerHash)));
    return { launches, total: local.launches.length, storage: "local-memory" };
  }

  const db = await ensureProductHuntTables();
  if (db) {
    const orderBy = options.sort === "top" ? "l.vote_count DESC, l.created_at DESC" : "l.created_at DESC";
    const [rows, count] = await Promise.all([
      db.prepare(
        `SELECT l.*, EXISTS(
          SELECT 1 FROM product_hunt_votes v WHERE v.launch_id = l.id AND v.voter_hash = ?
        ) AS viewer_voted
        FROM product_hunt_launches l
        ORDER BY ${orderBy}
        LIMIT ?`,
      ).bind(options.viewerHash, limit).all<Record<string, unknown>>(),
      db.prepare("SELECT COUNT(*) AS count FROM product_hunt_launches").first<{ count: number }>(),
    ]);
    return {
      launches: (rows.results ?? []).map((row) => publicProductHuntLaunch(fromD1Row(row), Boolean(row.viewer_voted))),
      total: Math.max(0, Number(count?.count) || 0),
      storage: "cloudflare-d1",
    };
  }

  if (blobAvailable()) {
    const snapshot = await loadBlobState();
    const launches = structuredClone(snapshot.state.launches)
      .sort(options.sort === "top"
        ? (left, right) => right.voteCount - left.voteCount || right.createdAt.localeCompare(left.createdAt)
        : (left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((launch) => publicProductHuntLaunch(launch, (snapshot.state.votes[launch.id] ?? []).includes(options.viewerHash)));
    return { launches, total: snapshot.state.launches.length, storage: "vercel-blob" };
  }

  throw new ProductHuntStorageUnavailableError();
}

export async function voteForProductHuntLaunch(options: {
  launchId: string;
  voterHash: string;
  createdAt: string;
}): Promise<{
  accepted: boolean;
  votes: number;
  storage: ProductHuntStorageEvidence;
}> {
  const local = localState();
  if (local) {
    const launch = local.launches.find((item) => item.id === options.launchId);
    if (!launch) throw new ProductHuntLaunchNotFoundError();
    const voters = local.votes[launch.id] ??= [];
    const accepted = !voters.includes(options.voterHash);
    if (accepted) {
      voters.push(options.voterHash);
      launch.voteCount += 1;
    }
    return { accepted, votes: launch.voteCount, storage: "local-memory" };
  }

  const db = await ensureProductHuntTables();
  if (db) {
    const launch = await db.prepare("SELECT id FROM product_hunt_launches WHERE id = ? LIMIT 1").bind(options.launchId).first();
    if (!launch) throw new ProductHuntLaunchNotFoundError();
    const insert = await db.prepare(
      "INSERT OR IGNORE INTO product_hunt_votes (launch_id, voter_hash, created_at) VALUES (?, ?, ?)",
    ).bind(options.launchId, options.voterHash, options.createdAt).run();
    const row = await db.prepare("SELECT vote_count FROM product_hunt_launches WHERE id = ? LIMIT 1")
      .bind(options.launchId).first<{ vote_count: number }>();
    return {
      accepted: Number(insert.meta?.changes ?? 0) > 0,
      votes: Math.max(0, Number(row?.vote_count) || 0),
      storage: "cloudflare-d1",
    };
  }

  if (blobAvailable()) {
    const result = await mutateBlobState((state) => {
      const launch = state.launches.find((item) => item.id === options.launchId);
      if (!launch) throw new ProductHuntLaunchNotFoundError();
      const voters = state.votes[launch.id] ??= [];
      if (voters.includes(options.voterHash)) return { accepted: false, votes: launch.voteCount };
      const receiptCount = Object.values(state.votes).reduce((sum, list) => sum + list.length, 0);
      if (receiptCount >= MAX_BLOB_VOTE_RECEIPTS) throw new ProductHuntCapacityError();
      voters.push(options.voterHash);
      launch.voteCount += 1;
      return { accepted: true, votes: launch.voteCount };
    });
    return { ...result, storage: "vercel-blob" };
  }

  throw new ProductHuntStorageUnavailableError();
}
