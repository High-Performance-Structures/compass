ALTER TABLE `user_presence`
ADD COLUMN `last_active_at` text;

UPDATE `user_presence`
SET `last_active_at` = `updated_at`
WHERE `last_active_at` IS NULL;
