CREATE TABLE `published_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`preset_id` text NOT NULL,
	`spec_json` text NOT NULL,
	`html` text NOT NULL,
	`created_at` text NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_projects_slug_unique` ON `published_projects` (`slug`);