ALTER TABLE `account_deletion_requests` ADD `processing_started_by` text REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `account_deletion_requests` ADD `completed_by` text REFERENCES users(id) ON DELETE set null;
