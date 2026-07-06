ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN duplicate_status TEXT NOT NULL DEFAULT 'not_checked';

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN duplicate_source TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN duplicate_message TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN duplicate_checked_at TEXT;

CREATE INDEX idx_project_vendor_bill_submissions_duplicate
  ON project_vendor_bill_submissions (project_id, duplicate_status);
