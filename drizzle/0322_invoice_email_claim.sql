-- Invoice email send claim (2026-11-12). Additive only; no table rebuild.
-- A request emailing a simple invoice claims the send here (compare-and-set)
-- before it renders or sends, so a double click or two staff send it once.
-- The claim is a lease: cleared when the send finishes or definitely fails,
-- and claimable again after a hard maximum if the request died. emailed_at
-- keeps meaning "delivered". email_unconfirmed_at marks a send whose outcome
-- is unknown (it may have gone out): reopen and delete stay blocked until
-- staff confirm it didn't go out, or a later send is delivered.
ALTER TABLE `invoices` ADD COLUMN `email_claimed_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `email_claimed_by` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `email_unconfirmed_at` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_email_claimed_by_idx` ON `invoices` (`email_claimed_by`);
