DROP TRIGGER IF EXISTS `projects_project_job_status_namespace_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `projects_project_job_status_namespace_update`;
--> statement-breakpoint
CREATE TRIGGER `projects_project_job_status_namespace_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`job_status_id` IS NULL
  OR (
    NEW.`job_status_id` NOT IN (
      'intake', 'new_client_info_sent', 'budget_estimating', 'budget_estimate_sent',
      'estimating', 'estimate_sent', 'design_proposal', 'design_proposal_sent',
      'design_proposal_signed', 'engineering', 'contract_docs', 'contract_docs_sent',
      'contract_docs_signed', 'contract', 'awarded', 'awaiting_funding',
      'awaiting_groundbreaking', 'permitting', 'in_design', 'value_engineering',
      'takeoff', 'bracing_out', 'under_construction', 'ordered', 'partial_order',
      'price_sheet_sent', 'shipping_tbd', 'awaiting_payment', 'current', 'punchlist',
      'under_warranty', 'complete', 'closed', 'bid_refused', 'inactive'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM `project_job_statuses`
      WHERE `id` = NEW.`job_status_id`
        AND NEW.`organization_id` IS NOT NULL
        AND `organization_id` = NEW.`organization_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Project job status must be an approved built-in or organization-owned custom status.');
END;
--> statement-breakpoint
CREATE TRIGGER `projects_project_job_status_namespace_update`
BEFORE UPDATE OF `job_status_id`, `organization_id` ON `projects`
WHEN NEW.`job_status_id` IS NULL
  OR (
    NEW.`job_status_id` NOT IN (
      'intake', 'new_client_info_sent', 'budget_estimating', 'budget_estimate_sent',
      'estimating', 'estimate_sent', 'design_proposal', 'design_proposal_sent',
      'design_proposal_signed', 'engineering', 'contract_docs', 'contract_docs_sent',
      'contract_docs_signed', 'contract', 'awarded', 'awaiting_funding',
      'awaiting_groundbreaking', 'permitting', 'in_design', 'value_engineering',
      'takeoff', 'bracing_out', 'under_construction', 'ordered', 'partial_order',
      'price_sheet_sent', 'shipping_tbd', 'awaiting_payment', 'current', 'punchlist',
      'under_warranty', 'complete', 'closed', 'bid_refused', 'inactive'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM `project_job_statuses`
      WHERE `id` = NEW.`job_status_id`
        AND NEW.`organization_id` IS NOT NULL
        AND `organization_id` = NEW.`organization_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Project job status must be an approved built-in or organization-owned custom status.');
END;
