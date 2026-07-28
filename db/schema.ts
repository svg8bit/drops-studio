import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const publishedProjects = sqliteTable("published_projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  presetId: text("preset_id").notNull(),
  specJson: text("spec_json").notNull(),
  html: text("html").notNull(),
  createdAt: text("created_at").notNull(),
  viewCount: integer("view_count").notNull().default(0),
});
