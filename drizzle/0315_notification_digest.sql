-- Notification digest: a person can opt out and get every change right away.
-- Company digest times live in feature settings ("notification-digest").
ALTER TABLE notification_preferences ADD COLUMN changes_right_away integer NOT NULL DEFAULT 0;
