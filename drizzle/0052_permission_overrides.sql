CREATE TABLE `role_permission_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `role` text NOT NULL,
  `feature_id` text NOT NULL,
  `access_level` text NOT NULL,
  `created_by` text,
  `updated_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_overrides_unique` ON `role_permission_overrides` (`organization_id`,`role`,`feature_id`);
--> statement-breakpoint
CREATE INDEX `role_permission_overrides_org_idx` ON `role_permission_overrides` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `team_permission_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `team_id` text NOT NULL,
  `feature_id` text NOT NULL,
  `access_level` text NOT NULL,
  `created_by` text,
  `updated_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_permission_overrides_unique` ON `team_permission_overrides` (`organization_id`,`team_id`,`feature_id`);
--> statement-breakpoint
CREATE INDEX `team_permission_overrides_org_idx` ON `team_permission_overrides` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `permission_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `scope` text NOT NULL,
  `role` text,
  `team_id` text,
  `feature_id` text NOT NULL,
  `previous_access_level` text,
  `next_access_level` text,
  `changed_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `permission_audit_events_org_idx` ON `permission_audit_events` (`organization_id`,`created_at`);
