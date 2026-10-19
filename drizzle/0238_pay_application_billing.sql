-- Approving a Compass pay application for billing: when and by whom, and the
-- Sage invoice number once staff enter it in Sage.
ALTER TABLE `project_budget_applications` ADD `billed_at` text;
ALTER TABLE `project_budget_applications` ADD `billed_by` text;
ALTER TABLE `project_budget_applications` ADD `sage_invoice_number` text;
-- A deposit request's message to the client, printed on the request. Notes
-- stay internal.
ALTER TABLE `project_contract_deposits` ADD `request_message` text;
