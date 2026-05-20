CREATE TABLE `cherish_pulse_responses` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `submitted_by` text,
  `submitted_by_name` text,
  `submitted_by_email` text,
  `week_start` text NOT NULL,
  `cherish_value` text NOT NULL,
  `response_type` text NOT NULL,
  `message` text NOT NULL,
  `source` text NOT NULL DEFAULT 'compass_dashboard',
  `visibility` text NOT NULL DEFAULT 'team',
  `review_status` text NOT NULL DEFAULT 'needs_review',
  `reviewed_by` text,
  `reviewed_at` text,
  `published_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_cherish_pulse_org_week` ON `cherish_pulse_responses` (`organization_id`, `week_start`);
CREATE INDEX `idx_cherish_pulse_org_status` ON `cherish_pulse_responses` (`organization_id`, `review_status`);
CREATE INDEX `idx_cherish_pulse_org_visibility` ON `cherish_pulse_responses` (`organization_id`, `visibility`);
CREATE INDEX `idx_cherish_pulse_submitted_by` ON `cherish_pulse_responses` (`submitted_by`);
