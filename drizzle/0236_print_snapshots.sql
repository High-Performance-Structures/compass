-- Print Preview snapshots: a document assembled in the browser (filtered
-- schedules, selection packets, budget views, portal reports) saved so the
-- server can render the same markup to PDF. Only the creator can open one;
-- rows expire after a week.
CREATE TABLE `print_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text,
  `title` text NOT NULL,
  `document_number` text,
  `html` text NOT NULL,
  `kind` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);
CREATE INDEX `print_snapshots_user_idx` ON `print_snapshots` (`user_id`, `created_at`);
CREATE INDEX `print_snapshots_expires_idx` ON `print_snapshots` (`expires_at`);
