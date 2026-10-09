-- Sites placed from a nearby house number or the street itself (when the
-- geocoders don't know the address yet) keep a note saying so. Sites that
-- were not found are cleared so they are looked up again with the new
-- fallback; this only resets the cached lookup, not project data.
ALTER TABLE `projects` ADD COLUMN `site_location_note` text;
--> statement-breakpoint
UPDATE `projects` SET `site_location_status` = NULL, `site_located_at` = NULL
  WHERE `site_location_status` = 'not_found';
