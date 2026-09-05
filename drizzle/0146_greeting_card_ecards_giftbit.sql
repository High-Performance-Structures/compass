ALTER TABLE `greeting_card_requests` ADD `recipient_email` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_provider` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_amount_cents` integer;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_region` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_campaign_uuid` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_reward_uuid` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_claim_url` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `gift_status` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `public_token` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `email_provider` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `email_provider_message_id` text;
--> statement-breakpoint
ALTER TABLE `greeting_card_requests` ADD `opened_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `greeting_card_requests_public_token_idx` ON `greeting_card_requests` (`public_token`);
