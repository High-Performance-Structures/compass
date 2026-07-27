CREATE TABLE `voice_realtimekit_meetings` (
  `id` text PRIMARY KEY NOT NULL,
  `channel_id` text NOT NULL,
  `meeting_id` text NOT NULL,
  `meeting_title` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `voice_realtimekit_meetings_channel_idx`
  ON `voice_realtimekit_meetings` (`channel_id`);

CREATE UNIQUE INDEX `voice_realtimekit_meetings_meeting_idx`
  ON `voice_realtimekit_meetings` (`meeting_id`);
