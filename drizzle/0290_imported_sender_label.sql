-- Imported (Buildertrend) messages whose sender could not be matched to a
-- person exactly are imported staff-only (owner decision 2026-11-02). They are
-- stored under the importing staff account, so the sender exactly as the
-- source showed it is kept here and shown instead. Additive only: one nullable
-- column, no data changes.
ALTER TABLE `messages` ADD COLUMN `source_sender_label_snapshot` text;
