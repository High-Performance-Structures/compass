CREATE TABLE `local_sync_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`vector_clock` text NOT NULL,
	`last_modified_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending_sync' NOT NULL,
	`conflict_data` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_sync_metadata_table_record_idx` ON `local_sync_metadata` (`table_name`,`record_id`);--> statement-breakpoint
CREATE TABLE `mutation_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`payload` text,
	`vector_clock` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`process_after` text
);
--> statement-breakpoint
CREATE INDEX `mutation_queue_status_created_idx` ON `mutation_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sync_checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`last_sync_cursor` text,
	`local_vector_clock` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_checkpoint_table_name_unique` ON `sync_checkpoint` (`table_name`);--> statement-breakpoint
CREATE INDEX `sync_checkpoint_table_name_idx` ON `sync_checkpoint` (`table_name`);--> statement-breakpoint
CREATE TABLE `sync_tombstone` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`vector_clock` text NOT NULL,
	`deleted_at` text NOT NULL,
	`synced` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_tombstone_table_record_idx` ON `sync_tombstone` (`table_name`,`record_id`);--> statement-breakpoint
CREATE INDEX `sync_tombstone_synced_idx` ON `sync_tombstone` (`synced`);