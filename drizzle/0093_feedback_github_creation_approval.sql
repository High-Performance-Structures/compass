ALTER TABLE `feedback_desk_items` ADD `github_issue_creation_approved_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `github_issue_creation_approved_by` text;
--> statement-breakpoint
CREATE INDEX `feedback_desk_github_review_idx` ON `feedback_desk_items` (`organization_id`,`github_issue_url`,`github_issue_creation_approved_at`);
