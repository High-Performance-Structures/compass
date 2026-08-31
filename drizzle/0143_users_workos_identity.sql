ALTER TABLE `users` ADD COLUMN `workos_user_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_workos_user_id_unique` ON `users` (`workos_user_id`);
