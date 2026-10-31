-- Paper trail: the ten-minute sweep (src/lib/paper-trail/sweep.ts) computes,
-- for every record in the company, the latest change time of its child rows
-- with correlated max(updated_at) subqueries. SQLite evaluates that expression
-- once per reference, and the existing child indexes lead on the parent id
-- only, so each evaluation read every child row of the record. These
-- (parent id, timestamp) indexes turn each max() into one index seek.
-- Additive only: no table or row changes.
CREATE INDEX IF NOT EXISTS project_estimate_lines_estimate_updated_idx ON project_estimate_lines (estimate_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_po_lines_operation_updated ON project_purchase_order_lines (operation_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_rfi_attachments_rfi_updated ON project_rfi_attachments (rfi_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_change_order_lines_order_updated_idx ON project_change_order_lines (change_order_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_change_order_documents_order_created_idx ON project_change_order_documents (change_order_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_ticket_lines_ticket_updated_idx ON shop_ticket_lines (ticket_id, updated_at);
