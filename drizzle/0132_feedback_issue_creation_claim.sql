ALTER TABLE `feedback_desk_items` ADD `github_issue_creation_claim_token` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `github_issue_creation_claimed_at` text;
--> statement-breakpoint
CREATE INDEX `feedback_desk_github_claim_idx` ON `feedback_desk_items` (`organization_id`,`github_issue_url`,`github_issue_creation_claim_token`);
