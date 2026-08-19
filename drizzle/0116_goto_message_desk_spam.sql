ALTER TABLE `goto_inbound_events` ADD `trashed_at` text;
--> statement-breakpoint
ALTER TABLE `goto_inbound_events` ADD `trashed_by` text;
--> statement-breakpoint
ALTER TABLE `goto_inbound_events` ADD `provider_deleted_at` text;
--> statement-breakpoint
CREATE INDEX `goto_inbound_events_org_conversation_idx`
ON `goto_inbound_events` (`organization_id`, `conversation_id`);
