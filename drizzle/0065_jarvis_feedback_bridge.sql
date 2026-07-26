CREATE TABLE `feedback_desk_items` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `source` text NOT NULL,
  `source_id` text NOT NULL,
  `kind` text NOT NULL,
  `status` text DEFAULT 'new' NOT NULL,
  `priority` text DEFAULT 'normal' NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `reporter_name` text,
  `reporter_email` text,
  `channel_id` text,
  `message_id` text,
  `thread_id` text,
  `github_issue_url` text,
  `metadata` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `feedback_desk_source_id_unique`
  ON `feedback_desk_items` (`source`, `source_id`);
CREATE INDEX `feedback_desk_status_idx`
  ON `feedback_desk_items` (`organization_id`, `status`, `created_at`);

CREATE TABLE `jarvis_bridge_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `direction` text NOT NULL,
  `source` text NOT NULL,
  `event_type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `idempotency_key` text NOT NULL,
  `feedback_desk_item_id` text,
  `payload` text NOT NULL,
  `result` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `available_at` text NOT NULL,
  `claim_token` text,
  `claimed_at` text,
  `completed_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `jarvis_bridge_idempotency_unique`
  ON `jarvis_bridge_events` (`idempotency_key`);
CREATE INDEX `jarvis_bridge_delivery_idx`
  ON `jarvis_bridge_events` (
    `direction`,
    `status`,
    `available_at`
  );
CREATE INDEX `jarvis_bridge_claim_idx`
  ON `jarvis_bridge_events` (`claim_token`);
