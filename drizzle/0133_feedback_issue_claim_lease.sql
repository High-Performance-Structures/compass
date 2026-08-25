ALTER TABLE `feedback_desk_items` ADD `github_issue_creation_claim_expires_at` text;
--> statement-breakpoint
CREATE INDEX `feedback_desk_github_claim_expiry_idx` ON `feedback_desk_items` (`organization_id`,`github_issue_url`,`github_issue_creation_claim_expires_at`);
