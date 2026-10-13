-- Square receipts: when Compass last checked Sage for the posted receipt, and
-- the reminder cadence for receipts not yet entered in Sage.
ALTER TABLE sage_square_payment_operations ADD COLUMN sage_receipt_checked_at TEXT;
ALTER TABLE sage_square_payment_operations ADD COLUMN receipt_reminded_at TEXT;
ALTER TABLE sage_square_payment_operations ADD COLUMN receipt_reminder_count INTEGER NOT NULL DEFAULT 0;
