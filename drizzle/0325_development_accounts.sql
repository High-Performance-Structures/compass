-- Development accounts (approved 2026-11-13). Additive only.
-- is_development_account: 1 for a company member who builds Compass itself
-- (an automation's service account, an outside developer) rather than an
-- employee. Their role and access stay as they are; they are left out of
-- staff people pickers, staff counts and Sage employee linking, and shown in
-- a Development group in Settings → Team. Set per company by an admin there.
ALTER TABLE `organization_members` ADD `is_development_account` integer DEFAULT 0 NOT NULL;
