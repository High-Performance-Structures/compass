ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN pay_request_number TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN pay_request_date TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN is_change_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN change_order_number TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN stamped_file_id TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN stamped_file_url TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN stamped_at TEXT;
