ALTER TABLE `owner_project_updates`
  ADD `recalled_at` text;
--> statement-breakpoint
ALTER TABLE `owner_project_updates`
  ADD `recalled_by` text REFERENCES `users`(`id`) ON DELETE set null;
