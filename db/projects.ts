import type { PublishedProjectRecord } from "@/lib/project-types";

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

function database(): D1Database {
  const db = globalThis.__DROPS_STUDIO_ENV__?.DB;
  if (!db) throw new Error("Drops Studio Cloud storage is not available in this environment.");
  return db;
}

export async function ensureProjectsTable(): Promise<D1Database> {
  const db = database();
  await db.prepare(schema).run();
  return db;
}

export async function insertPublishedProject(project: PublishedProjectRecord): Promise<void> {
  const db = await ensureProjectsTable();
  await db.prepare(
    "INSERT INTO published_projects (id, slug, title, preset_id, spec_json, html, created_at, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  ).bind(project.id, project.slug, project.title, project.presetId, JSON.stringify(project.spec), project.html, project.createdAt).run();
}

export async function getPublishedProject(slug: string): Promise<PublishedProjectRecord | null> {
  const db = await ensureProjectsTable();
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
  db.prepare("UPDATE published_projects SET view_count = view_count + 1 WHERE slug = ?").bind(slug).run().catch(() => undefined);
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
