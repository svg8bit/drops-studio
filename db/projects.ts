import type { PublishedProjectRecord } from "../lib/project-types.ts";
import { projectPresets } from "../lib/presets.ts";

declare global {
  var __DROPS_STUDIO_ENV__: { DB?: D1Database } | undefined;
  var __DROPS_STUDIO_LOCAL_PROJECTS__: Map<string, PublishedProjectRecord> | undefined;
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
const presetIds = new Set<string>(projectPresets.map((preset) => preset.id));

function database(): D1Database | null {
  return globalThis.__DROPS_STUDIO_ENV__?.DB ?? null;
}

function blobAvailable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN));
}

function localProjectStore(): Map<string, PublishedProjectRecord> | null {
  if (process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE !== "1" || process.env.VERCEL) return null;
  return globalThis.__DROPS_STUDIO_LOCAL_PROJECTS__ ??= new Map();
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

function publicProjectRecord(project: PublishedProjectRecord): PublishedProjectRecord {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    presetId: project.presetId,
    spec: project.spec,
    html: project.html,
    createdAt: project.createdAt,
  };
}

export async function ensureProjectsTable(): Promise<D1Database | null> {
  const db = database();
  if (!db) return null;
  await db.prepare(schema).run();
  return db;
}

export async function insertPublishedProject(project: PublishedProjectRecord): Promise<boolean> {
  const publicProject = publicProjectRecord(project);
  const local = localProjectStore();
  if (local) {
    if (local.has(publicProject.slug)) return false;
    local.set(publicProject.slug, structuredClone(publicProject));
    return true;
  }
  const db = await ensureProjectsTable();
  if (db) {
    const inserted = await db.prepare(
      "INSERT OR IGNORE INTO published_projects (id, slug, title, preset_id, spec_json, html, created_at, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    ).bind(
      publicProject.id,
      publicProject.slug,
      publicProject.title,
      publicProject.presetId,
      JSON.stringify(publicProject.spec),
      publicProject.html,
      publicProject.createdAt,
    ).run();
    return Number(inserted.meta?.changes ?? 0) > 0;
  }
  if (blobAvailable()) {
    const { BlobPreconditionFailedError, put } = await import("@vercel/blob");
    try {
      await put(blobPath(publicProject.slug), JSON.stringify(publicProject), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      throw error;
    }
  }
  throw new Error("Drops Studio Cloud storage is not available in this environment.");
}

export async function updatePublishedProject(project: PublishedProjectRecord): Promise<boolean> {
  const publicProject = publicProjectRecord(project);
  const local = localProjectStore();
  if (local) {
    const current = local.get(publicProject.slug);
    if (!current) return false;
    local.set(
      publicProject.slug,
      structuredClone({
        ...publicProject,
        id: current.id,
        createdAt: current.createdAt,
      }),
    );
    return true;
  }
  const db = await ensureProjectsTable();
  if (db) {
    const updated = await db.prepare(
      "UPDATE published_projects SET title = ?, preset_id = ?, spec_json = ?, html = ? WHERE slug = ?",
    ).bind(
      publicProject.title,
      publicProject.presetId,
      JSON.stringify(publicProject.spec),
      publicProject.html,
      publicProject.slug,
    ).run();
    return Number(updated.meta?.changes ?? 0) > 0;
  }
  if (blobAvailable()) {
    const {
      BlobNotFoundError,
      BlobPreconditionFailedError,
      head,
      put,
    } = await import("@vercel/blob");
    try {
      const currentHead = await head(blobPath(publicProject.slug));
      const current = await getPublishedProject(publicProject.slug);
      if (!current) return false;
      await put(
        blobPath(publicProject.slug),
        JSON.stringify({
          ...publicProject,
          id: current.id,
          createdAt: current.createdAt,
        }),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ifMatch: currentHead.etag,
        },
      );
      return true;
    } catch (error) {
      if (
        error instanceof BlobNotFoundError ||
        error instanceof BlobPreconditionFailedError
      ) {
        return false;
      }
      throw error;
    }
  }
  throw new Error("Drops Studio Cloud storage is not available in this environment.");
}

export async function deletePublishedProject(slug: string): Promise<boolean> {
  const local = localProjectStore();
  if (local) return local.delete(slug);
  const db = await ensureProjectsTable();
  if (db) {
    const deleted = await db
      .prepare("DELETE FROM published_projects WHERE slug = ?")
      .bind(slug)
      .run();
    return Number(deleted.meta?.changes ?? 0) > 0;
  }
  if (blobAvailable()) {
    const {
      BlobNotFoundError,
      BlobPreconditionFailedError,
      del,
      head,
    } = await import("@vercel/blob");
    try {
      const currentHead = await head(blobPath(slug));
      await del(blobPath(slug), { ifMatch: currentHead.etag });
      return true;
    } catch (error) {
      if (
        error instanceof BlobNotFoundError ||
        error instanceof BlobPreconditionFailedError
      ) {
        return false;
      }
      throw error;
    }
  }
  throw new Error("Drops Studio Cloud storage is not available in this environment.");
}

export async function getPublishedProject(slug: string): Promise<PublishedProjectRecord | null> {
  const local = localProjectStore();
  if (local) return structuredClone(local.get(slug) ?? null);
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
    const result = await get(blobPath(slug), { access: "public", useCache: false });
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
