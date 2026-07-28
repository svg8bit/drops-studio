import type { PublishedProjectRecord } from "@/lib/project-types";
import { presets } from "@/lib/presets";

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
}

const schema = `CREATE TABLE IF NOT EXISTS published_projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0
)`;
const presetIds = new Set<string>(presets.map((preset) => preset.id));

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function blobAvailable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
}

function blobPath(slug: string): string {
  return `drops-studio/projects/${slug}.json`;
}

function isPublishedProjectRecord(value: unknown): value is PublishedProjectRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PublishedProjectRecord>;
  return typeof record.id === "string" && typeof record.slug === "string" && typeof record.title === "string"
    && typeof record.html === "string" && typeof record.createdAt === "string" && typeof record.presetId === "string"
    && presetIds.has(record.presetId) && Boolean(record.spec);
}

export async function ensureProjectsTable(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(schema).run();
  return db;
}

export async function insertPublishedProject(project: PublishedProjectRecord): Promise<void> {
  const db = await ensureProjectsTable();
  if (db) {
    await db.prepare(
      "INSERT INTO published_projects (id, slug, title, preset_id, spec_json, html, created_at, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    ).bind(project.id, project.slug, project.title, project.presetId, JSON.stringify(project.spec), project.html, project.createdAt).run();
    return;
  }
  if (blobAvailable()) {
    const { put } = await import("@vercel/blob");
    await put(blobPath(project.slug), JSON.stringify(project), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
    });
    return;
  }
  throw new Error("Drops Studio Cloud storage is not available in this environment.");
}

export async function getPublishedProject(slug: string): Promise<PublishedProjectRecord | null> {
  const db = await ensureProjectsTable();
  if (db) {
    const row = await db.prepare(
      "SELECT id, slug, title, preset_id, spec_json, html, created_at FROM published_projects WHERE slug = ? LIMIT 1",
    ).bind(slug).first<{
      id: string;
      slug: string;
      title: string;
      preset_id: string;
      spec_json: string;
      html: string;
      created_at: string;
    }>();
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      presetId: row.preset_id as PublishedProjectRecord["presetId"],
      spec: JSON.parse(row.spec_json) as PublishedProjectRecord["spec"],
      html: row.html,
      createdAt: row.created_at,
    };
  }
  if (blobAvailable()) {
    const { get } = await import("@vercel/blob");
    const result = await get(blobPath(slug), { access: "public", useCache: true });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
    return isPublishedProjectRecord(parsed) ? parsed : null;
  }
  throw new Error("Drops Studio Cloud storage is not available in this environment.");
}
