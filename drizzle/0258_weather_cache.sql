-- Weather and Fire & smoke map layers: a shared cache of public National
-- Weather Service and wildfire data. Nothing here is company data; every
-- company's map reads the same rows, refreshed in the background.

-- A rounded map point (job site or area sample) and the NWS forecast grid
-- cell that covers it. Grid cells never move, so a point is resolved once.
CREATE TABLE `weather_points` (
	`point_key` text PRIMARY KEY NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`cell_key` text,
	`status` text NOT NULL DEFAULT 'pending',
	`resolved_at` text,
	`requested_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_weather_points_pending` ON `weather_points` (`status`, `requested_at`);
--> statement-breakpoint
-- One NWS forecast grid cell (about 2.5 km across, at its own elevation) and
-- its next days in 3-hour steps. Refreshed while someone is looking at it.
CREATE TABLE `weather_cells` (
	`cell_key` text PRIMARY KEY NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`elevation_m` real,
	`series` text,
	`fetched_at` text,
	`requested_at` text NOT NULL,
	`failure_count` integer NOT NULL DEFAULT 0,
	`next_attempt_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_weather_cells_refresh` ON `weather_cells` (`requested_at`, `fetched_at`);
--> statement-breakpoint
-- The latest warnings or fires for a map area (kind = alerts | fires).
CREATE TABLE `weather_area_snapshots` (
	`area_key` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	`failure_count` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`area_key`, `kind`)
);
--> statement-breakpoint
-- Simplified outlines of NWS forecast zones, for warnings issued by zone.
CREATE TABLE `weather_zone_shapes` (
	`zone_id` text PRIMARY KEY NOT NULL,
	`rings` text NOT NULL,
	`fetched_at` text NOT NULL
);
