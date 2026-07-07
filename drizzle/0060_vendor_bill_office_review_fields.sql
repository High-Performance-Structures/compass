ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN ar_check_number TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN payment_reference TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN hold_payment INTEGER NOT NULL DEFAULT 0;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN reimbursement_owed TEXT;

ALTER TABLE project_vendor_bill_submissions
  ADD COLUMN mailed_date TEXT;
