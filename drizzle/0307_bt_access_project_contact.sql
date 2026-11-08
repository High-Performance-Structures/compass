-- Buildertrend job access lists: link each access row to the Compass project
-- contact it was matched to, so one invite can open every project the person
-- or vendor could see in Buildertrend. Additive only.
ALTER TABLE `buildertrend_staging_access_candidates` ADD COLUMN `project_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `buildertrend_staging_access_project_contact_idx` ON `buildertrend_staging_access_candidates` (`project_contact_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `buildertrend_staging_access_entity_idx` ON `buildertrend_staging_access_candidates` (`organization_id`, `buildertrend_contact_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `buildertrend_staging_access_email_idx` ON `buildertrend_staging_access_candidates` (`organization_id`, `email`);
