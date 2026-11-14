-- Email sender verification (approved 2026-11-13). Additive only.
-- sender_authentication: Gmail's verdict on the From domain when the email
-- arrived ('pass', 'fail' or 'none'); NULL for emails stored before this.
ALTER TABLE `inbound_emails` ADD `sender_authentication` text;
