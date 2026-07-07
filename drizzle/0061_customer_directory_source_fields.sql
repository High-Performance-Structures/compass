ALTER TABLE customers
  ADD COLUMN source_system TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE customers
  ADD COLUMN source_record_id TEXT;

ALTER TABLE customers
  ADD COLUMN source_record_number TEXT;

ALTER TABLE customers
  ADD COLUMN source_metadata TEXT;

ALTER TABLE customers
  ADD COLUMN directory_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE customers
  ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE customers
  ADD COLUMN last_synced_at TEXT;
