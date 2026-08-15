ALTER TABLE `goto_inbound_events` ADD `conversation_id` text;
--> statement-breakpoint
ALTER TABLE `goto_inbound_events` ADD `message_body` text;
--> statement-breakpoint
ALTER TABLE `goto_inbound_events` ADD `attachment_metadata` text;
--> statement-breakpoint
ALTER TABLE `goto_inbound_events` ADD `review_reason` text;
--> statement-breakpoint
UPDATE `goto_inbound_events`
SET `review_reason` = 'legacy_project_unmatched'
WHERE `status` = 'needs_review' AND `review_reason` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `activity_events` (
  `id`, `organization_id`, `project_id`, `actor_user_id`, `actor_name`,
  `actor_role`, `category`, `action`, `entity_type`, `entity_id`, `summary`,
  `metadata`, `created_at`
)
SELECT
  'project-sms-review-' || `message_id`,
  `organization_id`,
  `project_id`,
  NULL,
  'Text sender ending ' || substr(replace(replace(replace(`sender_phone`, '+', ''), '-', ''), ' ', ''), -4),
  'project_sms',
  'conversation',
  'project_goto_sms.needs_review',
  'project_goto_sms',
  `message_id`,
  'Incoming text message is awaiting project and destination review.',
  '{"reason":"legacy_project_unmatched","bodyRetained":false}',
  `received_at`
FROM `goto_inbound_events`
WHERE `status` = 'needs_review';
