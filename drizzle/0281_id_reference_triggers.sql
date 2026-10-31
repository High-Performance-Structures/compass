-- 0281: validation triggers for internal *_id columns that have no FOREIGN KEY.
-- D1 cannot add a foreign key to an existing column without rebuilding the
-- table (which wipes children), so each column gets a BEFORE INSERT and a
-- BEFORE UPDATE OF trigger that aborts when the id is set but no parent row
-- exists, following 0108 and 0144. Existing rows are not checked: run
-- scripts/orphan-id-report.mjs first, because an UPDATE that sets an
-- orphaned column again will abort. Additive only.
-- The column list and reasons live in src/db/id-integrity.ts; the
-- schema-integrity standard test checks this file against it.
CREATE INDEX IF NOT EXISTS `project_change_order_lines_contract_assembly_id_idx` ON `project_change_order_lines` (`contract_assembly_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_change_orders_baseline_estimate_id_idx` ON `project_change_orders` (`baseline_estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_contract_budget_adjustments_change_order_id_idx` ON `project_contract_budget_adjustments` (`change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_contract_budget_adjustments_change_order_line_id_idx` ON `project_contract_budget_adjustments` (`change_order_line_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_contract_budget_adjustments_contract_assembly_id_idx` ON `project_contract_budget_adjustments` (`contract_assembly_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_estimate_assemblies_contract_assembly_id_idx` ON `project_estimate_assemblies` (`contract_assembly_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_estimate_assembly_copies_source_assembly_id_idx` ON `project_estimate_assembly_copies` (`source_assembly_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_estimate_assembly_copies_target_estimate_id_idx` ON `project_estimate_assembly_copies` (`target_estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_estimates_change_order_id_idx` ON `project_estimates` (`change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_estimates_phase_proposal_id_idx` ON `project_estimates` (`phase_proposal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_phase_proposals_deduct_change_order_id_idx` ON `project_phase_proposals` (`deduct_change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_phase_proposals_source_estimate_id_idx` ON `project_phase_proposals` (`source_estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_budget_applications_budget_revision_id_idx` ON `project_budget_applications` (`budget_revision_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_budget_lines_budget_revision_line_id_idx` ON `project_budget_lines` (`budget_revision_line_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_decisions_change_order_id_idx` ON `project_selection_decisions` (`change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_decision_events_selection_id_idx` ON `project_selection_decision_events` (`selection_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `shop_ticket_lines_rate_book_entry_id_idx` ON `shop_ticket_lines` (`rate_book_entry_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `trade_letters_estimate_id_idx` ON `trade_letters` (`estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `trade_letters_rfq_operation_id_idx` ON `trade_letters` (`rfq_operation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `customer_contacts_merged_into_person_id_idx` ON `customer_contacts` (`merged_into_person_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `customers_merged_into_customer_id_idx` ON `customers` (`merged_into_customer_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `nutech_order_workflows_tax_entity_id_idx` ON `nutech_order_workflows` (`tax_entity_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `print_snapshots_project_id_idx` ON `print_snapshots` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_documents_supersedes_document_id_idx` ON `project_documents` (`supersedes_document_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_duplicate_decisions_kept_project_id_idx` ON `project_duplicate_decisions` (`kept_project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_duplicate_decisions_project_a_id_idx` ON `project_duplicate_decisions` (`project_a_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_duplicate_decisions_project_b_id_idx` ON `project_duplicate_decisions` (`project_b_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_plan_set_document_id_idx` ON `projects` (`plan_set_document_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_pay_application_sync_runs_snapshot_id_idx` ON `sage_pay_application_sync_runs` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `vendor_contacts_merged_into_person_id_idx` ON `vendor_contacts` (`merged_into_person_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `vendors_merged_into_vendor_id_idx` ON `vendors` (`merged_into_vendor_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_read_state_last_read_message_id_idx` ON `channel_read_state` (`last_read_message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `email_reply_threads_channel_id_idx` ON `email_reply_threads` (`channel_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_desk_items_channel_id_idx` ON `feedback_desk_items` (`channel_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_desk_items_message_id_idx` ON `feedback_desk_items` (`message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_desk_items_thread_id_idx` ON `feedback_desk_items` (`thread_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jarvis_bridge_events_feedback_desk_item_id_idx` ON `jarvis_bridge_events` (`feedback_desk_item_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `social_post_media_photo_id_idx` ON `social_post_media` (`photo_id`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `agent_action_confirmations_organization_id_ref_insert`
BEFORE INSERT ON `agent_action_confirmations`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'agent_action_confirmations.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `agent_action_confirmations_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `agent_action_confirmations`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'agent_action_confirmations.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_attachments_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_attachments`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_attachments.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_attachments_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_attachments`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_attachments.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_composition_drafts_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_composition_drafts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_composition_drafts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_composition_drafts_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_composition_drafts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_composition_drafts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_deliveries_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_email_deliveries`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_deliveries.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_deliveries_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_email_deliveries`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_deliveries.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_events_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_email_events`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_events.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_events_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_email_events`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_events.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_threads_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_email_threads`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_threads.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_email_threads_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_email_threads`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_email_threads.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_saved_drafts_organization_id_ref_insert`
BEFORE INSERT ON `correspondence_saved_drafts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_saved_drafts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_saved_drafts_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `correspondence_saved_drafts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_saved_drafts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_correspondence_organization_id_ref_insert`
BEFORE INSERT ON `project_correspondence`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_correspondence.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_correspondence_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `project_correspondence`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_correspondence.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_email_campaigns_organization_id_ref_insert`
BEFORE INSERT ON `project_email_campaigns`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_email_campaigns.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_email_campaigns_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `project_email_campaigns`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_email_campaigns.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_organization_id_ref_insert`
BEFORE INSERT ON `project_estimate_assembly_copies`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `project_estimate_assembly_copies`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_status_label_conflicts_organization_id_ref_insert`
BEFORE INSERT ON `project_job_status_label_conflicts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_job_status_label_conflicts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_status_label_conflicts_organization_id_ref_update`
BEFORE UPDATE OF `organization_id` ON `project_job_status_label_conflicts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `organizations` WHERE `id` = NEW.`organization_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_job_status_label_conflicts.organization_id must reference an existing organizations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_changed_by_user_id_ref_insert`
BEFORE INSERT ON `contact_account_link_events`
WHEN NEW.`changed_by_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`changed_by_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.changed_by_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_changed_by_user_id_ref_update`
BEFORE UPDATE OF `changed_by_user_id` ON `contact_account_link_events`
WHEN NEW.`changed_by_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`changed_by_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.changed_by_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_next_user_id_ref_insert`
BEFORE INSERT ON `contact_account_link_events`
WHEN NEW.`next_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`next_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.next_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_next_user_id_ref_update`
BEFORE UPDATE OF `next_user_id` ON `contact_account_link_events`
WHEN NEW.`next_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`next_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.next_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_previous_user_id_ref_insert`
BEFORE INSERT ON `contact_account_link_events`
WHEN NEW.`previous_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`previous_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.previous_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `contact_account_link_events_previous_user_id_ref_update`
BEFORE UPDATE OF `previous_user_id` ON `contact_account_link_events`
WHEN NEW.`previous_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`previous_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'contact_account_link_events.previous_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_outbox_recipient_user_id_ref_insert`
BEFORE INSERT ON `correspondence_outbox`
WHEN NEW.`recipient_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`recipient_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_outbox.recipient_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_outbox_recipient_user_id_ref_update`
BEFORE UPDATE OF `recipient_user_id` ON `correspondence_outbox`
WHEN NEW.`recipient_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`recipient_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_outbox.recipient_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_revisions_actor_user_id_ref_insert`
BEFORE INSERT ON `correspondence_revisions`
WHEN NEW.`actor_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`actor_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_revisions.actor_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `correspondence_revisions_actor_user_id_ref_update`
BEFORE UPDATE OF `actor_user_id` ON `correspondence_revisions`
WHEN NEW.`actor_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`actor_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'correspondence_revisions.actor_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_assigned_to_user_id_ref_insert`
BEFORE INSERT ON `feedback_desk_items`
WHEN NEW.`assigned_to_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`assigned_to_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.assigned_to_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_assigned_to_user_id_ref_update`
BEFORE UPDATE OF `assigned_to_user_id` ON `feedback_desk_items`
WHEN NEW.`assigned_to_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`assigned_to_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.assigned_to_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_feature_priority_approved_by_ref_insert`
BEFORE INSERT ON `feedback_desk_items`
WHEN NEW.`feature_priority_approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`feature_priority_approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.feature_priority_approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_feature_priority_approved_by_ref_update`
BEFORE UPDATE OF `feature_priority_approved_by` ON `feedback_desk_items`
WHEN NEW.`feature_priority_approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`feature_priority_approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.feature_priority_approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `goto_inbound_events_trashed_by_ref_insert`
BEFORE INSERT ON `goto_inbound_events`
WHEN NEW.`trashed_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`trashed_by`)
BEGIN
  SELECT RAISE(ABORT, 'goto_inbound_events.trashed_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `goto_inbound_events_trashed_by_ref_update`
BEFORE UPDATE OF `trashed_by` ON `goto_inbound_events`
WHEN NEW.`trashed_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`trashed_by`)
BEGIN
  SELECT RAISE(ABORT, 'goto_inbound_events.trashed_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `print_snapshots_user_id_ref_insert`
BEFORE INSERT ON `print_snapshots`
WHEN NEW.`user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'print_snapshots.user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `print_snapshots_user_id_ref_update`
BEFORE UPDATE OF `user_id` ON `print_snapshots`
WHEN NEW.`user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'print_snapshots.user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_applications_billed_by_ref_insert`
BEFORE INSERT ON `project_budget_applications`
WHEN NEW.`billed_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`billed_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_applications.billed_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_applications_billed_by_ref_update`
BEFORE UPDATE OF `billed_by` ON `project_budget_applications`
WHEN NEW.`billed_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`billed_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_applications.billed_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_finish_selections_approved_by_ref_insert`
BEFORE INSERT ON `project_finish_selections`
WHEN NEW.`approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_finish_selections.approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_finish_selections_approved_by_ref_update`
BEFORE UPDATE OF `approved_by` ON `project_finish_selections`
WHEN NEW.`approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_finish_selections.approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decision_events_actor_id_ref_insert`
BEFORE INSERT ON `project_selection_decision_events`
WHEN NEW.`actor_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`actor_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decision_events.actor_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decision_events_actor_id_ref_update`
BEFORE UPDATE OF `actor_id` ON `project_selection_decision_events`
WHEN NEW.`actor_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`actor_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decision_events.actor_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decisions_approved_by_ref_insert`
BEFORE INSERT ON `project_selection_decisions`
WHEN NEW.`approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decisions.approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decisions_approved_by_ref_update`
BEFORE UPDATE OF `approved_by` ON `project_selection_decisions`
WHEN NEW.`approved_by` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`approved_by`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decisions.approved_by must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_requests_requester_id_ref_insert`
BEFORE INSERT ON `project_selection_requests`
WHEN NEW.`requester_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`requester_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_requests.requester_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_requests_requester_id_ref_update`
BEFORE UPDATE OF `requester_id` ON `project_selection_requests`
WHEN NEW.`requester_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`requester_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_requests.requester_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_message_events_from_assignee_user_id_ref_insert`
BEFORE INSERT ON `staff_message_events`
WHEN NEW.`from_assignee_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`from_assignee_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'staff_message_events.from_assignee_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_message_events_from_assignee_user_id_ref_update`
BEFORE UPDATE OF `from_assignee_user_id` ON `staff_message_events`
WHEN NEW.`from_assignee_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`from_assignee_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'staff_message_events.from_assignee_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_message_events_to_assignee_user_id_ref_insert`
BEFORE INSERT ON `staff_message_events`
WHEN NEW.`to_assignee_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`to_assignee_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'staff_message_events.to_assignee_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `staff_message_events_to_assignee_user_id_ref_update`
BEFORE UPDATE OF `to_assignee_user_id` ON `staff_message_events`
WHEN NEW.`to_assignee_user_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`to_assignee_user_id`)
BEGIN
  SELECT RAISE(ABORT, 'staff_message_events.to_assignee_user_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cherish_pulse_responses_audience_reference_id_ref_insert`
BEFORE INSERT ON `cherish_pulse_responses`
WHEN NEW.`audience_scope` = 'user'
  AND NEW.`audience_reference_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`audience_reference_id`)
BEGIN
  SELECT RAISE(ABORT, 'cherish_pulse_responses.audience_reference_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cherish_pulse_responses_audience_reference_id_ref_update`
BEFORE UPDATE OF `audience_reference_id` ON `cherish_pulse_responses`
WHEN NEW.`audience_scope` = 'user'
  AND NEW.`audience_reference_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.`audience_reference_id`)
BEGIN
  SELECT RAISE(ABORT, 'cherish_pulse_responses.audience_reference_id must reference an existing users');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_order_lines_contract_assembly_id_ref_insert`
BEFORE INSERT ON `project_change_order_lines`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_order_lines.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_order_lines_contract_assembly_id_ref_update`
BEFORE UPDATE OF `contract_assembly_id` ON `project_change_order_lines`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_order_lines.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_orders_baseline_estimate_id_ref_insert`
BEFORE INSERT ON `project_change_orders`
WHEN NEW.`baseline_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`baseline_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_orders.baseline_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_orders_baseline_estimate_id_ref_update`
BEFORE UPDATE OF `baseline_estimate_id` ON `project_change_orders`
WHEN NEW.`baseline_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`baseline_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_orders.baseline_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_orders_replacement_estimate_id_ref_insert`
BEFORE INSERT ON `project_change_orders`
WHEN NEW.`replacement_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`replacement_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_orders.replacement_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_change_orders_replacement_estimate_id_ref_update`
BEFORE UPDATE OF `replacement_estimate_id` ON `project_change_orders`
WHEN NEW.`replacement_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`replacement_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_change_orders.replacement_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_change_order_id_ref_insert`
BEFORE INSERT ON `project_contract_budget_adjustments`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_change_order_id_ref_update`
BEFORE UPDATE OF `change_order_id` ON `project_contract_budget_adjustments`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_change_order_line_id_ref_insert`
BEFORE INSERT ON `project_contract_budget_adjustments`
WHEN NEW.`change_order_line_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_order_lines` WHERE `id` = NEW.`change_order_line_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.change_order_line_id must reference an existing project_change_order_lines');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_change_order_line_id_ref_update`
BEFORE UPDATE OF `change_order_line_id` ON `project_contract_budget_adjustments`
WHEN NEW.`change_order_line_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_order_lines` WHERE `id` = NEW.`change_order_line_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.change_order_line_id must reference an existing project_change_order_lines');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_contract_assembly_id_ref_insert`
BEFORE INSERT ON `project_contract_budget_adjustments`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_contract_budget_adjustments_contract_assembly_id_ref_update`
BEFORE UPDATE OF `contract_assembly_id` ON `project_contract_budget_adjustments`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_contract_budget_adjustments.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assemblies_contract_assembly_id_ref_insert`
BEFORE INSERT ON `project_estimate_assemblies`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assemblies.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assemblies_contract_assembly_id_ref_update`
BEFORE UPDATE OF `contract_assembly_id` ON `project_estimate_assemblies`
WHEN NEW.`contract_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`contract_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assemblies.contract_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_source_assembly_id_ref_insert`
BEFORE INSERT ON `project_estimate_assembly_copies`
WHEN NEW.`source_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`source_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.source_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_source_assembly_id_ref_update`
BEFORE UPDATE OF `source_assembly_id` ON `project_estimate_assembly_copies`
WHEN NEW.`source_assembly_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimate_assemblies` WHERE `id` = NEW.`source_assembly_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.source_assembly_id must reference an existing project_estimate_assemblies');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_source_estimate_id_ref_insert`
BEFORE INSERT ON `project_estimate_assembly_copies`
WHEN NEW.`source_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`source_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.source_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_source_estimate_id_ref_update`
BEFORE UPDATE OF `source_estimate_id` ON `project_estimate_assembly_copies`
WHEN NEW.`source_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`source_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.source_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_target_estimate_id_ref_insert`
BEFORE INSERT ON `project_estimate_assembly_copies`
WHEN NEW.`target_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`target_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.target_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_assembly_copies_target_estimate_id_ref_update`
BEFORE UPDATE OF `target_estimate_id` ON `project_estimate_assembly_copies`
WHEN NEW.`target_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`target_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_assembly_copies.target_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_line_cost_items_rate_book_entry_id_ref_insert`
BEFORE INSERT ON `project_estimate_line_cost_items`
WHEN NEW.`rate_book_entry_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `rate_book_entries` WHERE `id` = NEW.`rate_book_entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_line_cost_items.rate_book_entry_id must reference an existing rate_book_entries');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimate_line_cost_items_rate_book_entry_id_ref_update`
BEFORE UPDATE OF `rate_book_entry_id` ON `project_estimate_line_cost_items`
WHEN NEW.`rate_book_entry_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `rate_book_entries` WHERE `id` = NEW.`rate_book_entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimate_line_cost_items.rate_book_entry_id must reference an existing rate_book_entries');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimates_change_order_id_ref_insert`
BEFORE INSERT ON `project_estimates`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimates.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimates_change_order_id_ref_update`
BEFORE UPDATE OF `change_order_id` ON `project_estimates`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimates.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimates_phase_proposal_id_ref_insert`
BEFORE INSERT ON `project_estimates`
WHEN NEW.`phase_proposal_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_phase_proposals` WHERE `id` = NEW.`phase_proposal_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimates.phase_proposal_id must reference an existing project_phase_proposals');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_estimates_phase_proposal_id_ref_update`
BEFORE UPDATE OF `phase_proposal_id` ON `project_estimates`
WHEN NEW.`phase_proposal_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_phase_proposals` WHERE `id` = NEW.`phase_proposal_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_estimates.phase_proposal_id must reference an existing project_phase_proposals');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_phase_proposals_deduct_change_order_id_ref_insert`
BEFORE INSERT ON `project_phase_proposals`
WHEN NEW.`deduct_change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`deduct_change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_phase_proposals.deduct_change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_phase_proposals_deduct_change_order_id_ref_update`
BEFORE UPDATE OF `deduct_change_order_id` ON `project_phase_proposals`
WHEN NEW.`deduct_change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`deduct_change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_phase_proposals.deduct_change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_phase_proposals_source_estimate_id_ref_insert`
BEFORE INSERT ON `project_phase_proposals`
WHEN NEW.`source_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`source_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_phase_proposals.source_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_phase_proposals_source_estimate_id_ref_update`
BEFORE UPDATE OF `source_estimate_id` ON `project_phase_proposals`
WHEN NEW.`source_estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`source_estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_phase_proposals.source_estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_applications_budget_revision_id_ref_insert`
BEFORE INSERT ON `project_budget_applications`
WHEN NEW.`budget_revision_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_contract_budget_revisions` WHERE `id` = NEW.`budget_revision_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_applications.budget_revision_id must reference an existing project_contract_budget_revisions');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_applications_budget_revision_id_ref_update`
BEFORE UPDATE OF `budget_revision_id` ON `project_budget_applications`
WHEN NEW.`budget_revision_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_contract_budget_revisions` WHERE `id` = NEW.`budget_revision_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_applications.budget_revision_id must reference an existing project_contract_budget_revisions');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_lines_budget_revision_line_id_ref_insert`
BEFORE INSERT ON `project_budget_lines`
WHEN NEW.`budget_revision_line_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_contract_budget_lines` WHERE `id` = NEW.`budget_revision_line_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_lines.budget_revision_line_id must reference an existing project_contract_budget_lines');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_lines_budget_revision_line_id_ref_update`
BEFORE UPDATE OF `budget_revision_line_id` ON `project_budget_lines`
WHEN NEW.`budget_revision_line_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_contract_budget_lines` WHERE `id` = NEW.`budget_revision_line_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_budget_lines.budget_revision_line_id must reference an existing project_contract_budget_lines');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_operations_awarded_rfq_id_ref_insert`
BEFORE INSERT ON `project_operations`
WHEN NEW.`awarded_rfq_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_operations` WHERE `id` = NEW.`awarded_rfq_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_operations.awarded_rfq_id must reference an existing project_operations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_operations_awarded_rfq_id_ref_update`
BEFORE UPDATE OF `awarded_rfq_id` ON `project_operations`
WHEN NEW.`awarded_rfq_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_operations` WHERE `id` = NEW.`awarded_rfq_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_operations.awarded_rfq_id must reference an existing project_operations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decisions_change_order_id_ref_insert`
BEFORE INSERT ON `project_selection_decisions`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decisions.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decisions_change_order_id_ref_update`
BEFORE UPDATE OF `change_order_id` ON `project_selection_decisions`
WHEN NEW.`change_order_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_change_orders` WHERE `id` = NEW.`change_order_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decisions.change_order_id must reference an existing project_change_orders');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decision_events_selection_id_ref_insert`
BEFORE INSERT ON `project_selection_decision_events`
WHEN NEW.`selection_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_finish_selections` WHERE `id` = NEW.`selection_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decision_events.selection_id must reference an existing project_finish_selections');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_selection_decision_events_selection_id_ref_update`
BEFORE UPDATE OF `selection_id` ON `project_selection_decision_events`
WHEN NEW.`selection_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_finish_selections` WHERE `id` = NEW.`selection_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_selection_decision_events.selection_id must reference an existing project_finish_selections');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `shop_ticket_lines_rate_book_entry_id_ref_insert`
BEFORE INSERT ON `shop_ticket_lines`
WHEN NEW.`rate_book_entry_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `rate_book_entries` WHERE `id` = NEW.`rate_book_entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'shop_ticket_lines.rate_book_entry_id must reference an existing rate_book_entries');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `shop_ticket_lines_rate_book_entry_id_ref_update`
BEFORE UPDATE OF `rate_book_entry_id` ON `shop_ticket_lines`
WHEN NEW.`rate_book_entry_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `rate_book_entries` WHERE `id` = NEW.`rate_book_entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'shop_ticket_lines.rate_book_entry_id must reference an existing rate_book_entries');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trade_letters_estimate_id_ref_insert`
BEFORE INSERT ON `trade_letters`
WHEN NEW.`estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'trade_letters.estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trade_letters_estimate_id_ref_update`
BEFORE UPDATE OF `estimate_id` ON `trade_letters`
WHEN NEW.`estimate_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_estimates` WHERE `id` = NEW.`estimate_id`)
BEGIN
  SELECT RAISE(ABORT, 'trade_letters.estimate_id must reference an existing project_estimates');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trade_letters_rfq_operation_id_ref_insert`
BEFORE INSERT ON `trade_letters`
WHEN NEW.`rfq_operation_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_operations` WHERE `id` = NEW.`rfq_operation_id`)
BEGIN
  SELECT RAISE(ABORT, 'trade_letters.rfq_operation_id must reference an existing project_operations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trade_letters_rfq_operation_id_ref_update`
BEFORE UPDATE OF `rfq_operation_id` ON `trade_letters`
WHEN NEW.`rfq_operation_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_operations` WHERE `id` = NEW.`rfq_operation_id`)
BEGIN
  SELECT RAISE(ABORT, 'trade_letters.rfq_operation_id must reference an existing project_operations');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `customer_contacts_merged_into_person_id_ref_insert`
BEFORE INSERT ON `customer_contacts`
WHEN NEW.`merged_into_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `customer_contacts` WHERE `id` = NEW.`merged_into_person_id`)
BEGIN
  SELECT RAISE(ABORT, 'customer_contacts.merged_into_person_id must reference an existing customer_contacts');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `customer_contacts_merged_into_person_id_ref_update`
BEFORE UPDATE OF `merged_into_person_id` ON `customer_contacts`
WHEN NEW.`merged_into_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `customer_contacts` WHERE `id` = NEW.`merged_into_person_id`)
BEGIN
  SELECT RAISE(ABORT, 'customer_contacts.merged_into_person_id must reference an existing customer_contacts');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `customers_merged_into_customer_id_ref_insert`
BEFORE INSERT ON `customers`
WHEN NEW.`merged_into_customer_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `customers` WHERE `id` = NEW.`merged_into_customer_id`)
BEGIN
  SELECT RAISE(ABORT, 'customers.merged_into_customer_id must reference an existing customers');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `customers_merged_into_customer_id_ref_update`
BEFORE UPDATE OF `merged_into_customer_id` ON `customers`
WHEN NEW.`merged_into_customer_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `customers` WHERE `id` = NEW.`merged_into_customer_id`)
BEGIN
  SELECT RAISE(ABORT, 'customers.merged_into_customer_id must reference an existing customers');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `nutech_order_workflows_tax_entity_id_ref_insert`
BEFORE INSERT ON `nutech_order_workflows`
WHEN NEW.`tax_entity_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sage_tax_entities` WHERE `id` = NEW.`tax_entity_id`)
BEGIN
  SELECT RAISE(ABORT, 'nutech_order_workflows.tax_entity_id must reference an existing sage_tax_entities');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `nutech_order_workflows_tax_entity_id_ref_update`
BEFORE UPDATE OF `tax_entity_id` ON `nutech_order_workflows`
WHEN NEW.`tax_entity_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sage_tax_entities` WHERE `id` = NEW.`tax_entity_id`)
BEGIN
  SELECT RAISE(ABORT, 'nutech_order_workflows.tax_entity_id must reference an existing sage_tax_entities');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `print_snapshots_project_id_ref_insert`
BEFORE INSERT ON `print_snapshots`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_id`)
BEGIN
  SELECT RAISE(ABORT, 'print_snapshots.project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `print_snapshots_project_id_ref_update`
BEFORE UPDATE OF `project_id` ON `print_snapshots`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_id`)
BEGIN
  SELECT RAISE(ABORT, 'print_snapshots.project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_documents_supersedes_document_id_ref_insert`
BEFORE INSERT ON `project_documents`
WHEN NEW.`supersedes_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_documents` WHERE `id` = NEW.`supersedes_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_documents.supersedes_document_id must reference an existing project_documents');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_documents_supersedes_document_id_ref_update`
BEFORE UPDATE OF `supersedes_document_id` ON `project_documents`
WHEN NEW.`supersedes_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_documents` WHERE `id` = NEW.`supersedes_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_documents.supersedes_document_id must reference an existing project_documents');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_kept_project_id_ref_insert`
BEFORE INSERT ON `project_duplicate_decisions`
WHEN NEW.`kept_project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`kept_project_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.kept_project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_kept_project_id_ref_update`
BEFORE UPDATE OF `kept_project_id` ON `project_duplicate_decisions`
WHEN NEW.`kept_project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`kept_project_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.kept_project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_project_a_id_ref_insert`
BEFORE INSERT ON `project_duplicate_decisions`
WHEN NEW.`project_a_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_a_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.project_a_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_project_a_id_ref_update`
BEFORE UPDATE OF `project_a_id` ON `project_duplicate_decisions`
WHEN NEW.`project_a_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_a_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.project_a_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_project_b_id_ref_insert`
BEFORE INSERT ON `project_duplicate_decisions`
WHEN NEW.`project_b_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_b_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.project_b_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_project_b_id_ref_update`
BEFORE UPDATE OF `project_b_id` ON `project_duplicate_decisions`
WHEN NEW.`project_b_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`project_b_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.project_b_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_removed_project_id_ref_insert`
BEFORE INSERT ON `project_duplicate_decisions`
WHEN NEW.`removed_project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`removed_project_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.removed_project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_duplicate_decisions_removed_project_id_ref_update`
BEFORE UPDATE OF `removed_project_id` ON `project_duplicate_decisions`
WHEN NEW.`removed_project_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `projects` WHERE `id` = NEW.`removed_project_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_duplicate_decisions.removed_project_id must reference an existing projects');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_plan_set_document_id_ref_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`plan_set_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_documents` WHERE `id` = NEW.`plan_set_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'projects.plan_set_document_id must reference an existing project_documents');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_plan_set_document_id_ref_update`
BEFORE UPDATE OF `plan_set_document_id` ON `projects`
WHEN NEW.`plan_set_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `project_documents` WHERE `id` = NEW.`plan_set_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'projects.plan_set_document_id must reference an existing project_documents');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sage_pay_application_sync_runs_snapshot_id_ref_insert`
BEFORE INSERT ON `sage_pay_application_sync_runs`
WHEN NEW.`snapshot_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sage_pay_application_snapshots` WHERE `id` = NEW.`snapshot_id`)
BEGIN
  SELECT RAISE(ABORT, 'sage_pay_application_sync_runs.snapshot_id must reference an existing sage_pay_application_snapshots');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sage_pay_application_sync_runs_snapshot_id_ref_update`
BEFORE UPDATE OF `snapshot_id` ON `sage_pay_application_sync_runs`
WHEN NEW.`snapshot_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `sage_pay_application_snapshots` WHERE `id` = NEW.`snapshot_id`)
BEGIN
  SELECT RAISE(ABORT, 'sage_pay_application_sync_runs.snapshot_id must reference an existing sage_pay_application_snapshots');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `vendor_contacts_merged_into_person_id_ref_insert`
BEFORE INSERT ON `vendor_contacts`
WHEN NEW.`merged_into_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `vendor_contacts` WHERE `id` = NEW.`merged_into_person_id`)
BEGIN
  SELECT RAISE(ABORT, 'vendor_contacts.merged_into_person_id must reference an existing vendor_contacts');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `vendor_contacts_merged_into_person_id_ref_update`
BEFORE UPDATE OF `merged_into_person_id` ON `vendor_contacts`
WHEN NEW.`merged_into_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `vendor_contacts` WHERE `id` = NEW.`merged_into_person_id`)
BEGIN
  SELECT RAISE(ABORT, 'vendor_contacts.merged_into_person_id must reference an existing vendor_contacts');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `vendors_merged_into_vendor_id_ref_insert`
BEFORE INSERT ON `vendors`
WHEN NEW.`merged_into_vendor_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `vendors` WHERE `id` = NEW.`merged_into_vendor_id`)
BEGIN
  SELECT RAISE(ABORT, 'vendors.merged_into_vendor_id must reference an existing vendors');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `vendors_merged_into_vendor_id_ref_update`
BEFORE UPDATE OF `merged_into_vendor_id` ON `vendors`
WHEN NEW.`merged_into_vendor_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `vendors` WHERE `id` = NEW.`merged_into_vendor_id`)
BEGIN
  SELECT RAISE(ABORT, 'vendors.merged_into_vendor_id must reference an existing vendors');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `channel_read_state_last_read_message_id_ref_insert`
BEFORE INSERT ON `channel_read_state`
WHEN NEW.`last_read_message_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`last_read_message_id`)
BEGIN
  SELECT RAISE(ABORT, 'channel_read_state.last_read_message_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `channel_read_state_last_read_message_id_ref_update`
BEFORE UPDATE OF `last_read_message_id` ON `channel_read_state`
WHEN NEW.`last_read_message_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`last_read_message_id`)
BEGIN
  SELECT RAISE(ABORT, 'channel_read_state.last_read_message_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `email_reply_threads_channel_id_ref_insert`
BEFORE INSERT ON `email_reply_threads`
WHEN NEW.`channel_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `id` = NEW.`channel_id`)
BEGIN
  SELECT RAISE(ABORT, 'email_reply_threads.channel_id must reference an existing channels');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `email_reply_threads_channel_id_ref_update`
BEFORE UPDATE OF `channel_id` ON `email_reply_threads`
WHEN NEW.`channel_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `id` = NEW.`channel_id`)
BEGIN
  SELECT RAISE(ABORT, 'email_reply_threads.channel_id must reference an existing channels');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_channel_id_ref_insert`
BEFORE INSERT ON `feedback_desk_items`
WHEN NEW.`channel_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `id` = NEW.`channel_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.channel_id must reference an existing channels');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_channel_id_ref_update`
BEFORE UPDATE OF `channel_id` ON `feedback_desk_items`
WHEN NEW.`channel_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `channels` WHERE `id` = NEW.`channel_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.channel_id must reference an existing channels');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_message_id_ref_insert`
BEFORE INSERT ON `feedback_desk_items`
WHEN NEW.`message_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`message_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.message_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_message_id_ref_update`
BEFORE UPDATE OF `message_id` ON `feedback_desk_items`
WHEN NEW.`message_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`message_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.message_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_thread_id_ref_insert`
BEFORE INSERT ON `feedback_desk_items`
WHEN NEW.`thread_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`thread_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.thread_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_desk_items_thread_id_ref_update`
BEFORE UPDATE OF `thread_id` ON `feedback_desk_items`
WHEN NEW.`thread_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `messages` WHERE `id` = NEW.`thread_id`)
BEGIN
  SELECT RAISE(ABORT, 'feedback_desk_items.thread_id must reference an existing messages');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `jarvis_bridge_events_feedback_desk_item_id_ref_insert`
BEFORE INSERT ON `jarvis_bridge_events`
WHEN NEW.`feedback_desk_item_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `feedback_desk_items` WHERE `id` = NEW.`feedback_desk_item_id`)
BEGIN
  SELECT RAISE(ABORT, 'jarvis_bridge_events.feedback_desk_item_id must reference an existing feedback_desk_items');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `jarvis_bridge_events_feedback_desk_item_id_ref_update`
BEFORE UPDATE OF `feedback_desk_item_id` ON `jarvis_bridge_events`
WHEN NEW.`feedback_desk_item_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `feedback_desk_items` WHERE `id` = NEW.`feedback_desk_item_id`)
BEGIN
  SELECT RAISE(ABORT, 'jarvis_bridge_events.feedback_desk_item_id must reference an existing feedback_desk_items');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_email_campaigns_reply_thread_id_ref_insert`
BEFORE INSERT ON `project_email_campaigns`
WHEN NEW.`reply_thread_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `email_reply_threads` WHERE `id` = NEW.`reply_thread_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_email_campaigns.reply_thread_id must reference an existing email_reply_threads');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_email_campaigns_reply_thread_id_ref_update`
BEFORE UPDATE OF `reply_thread_id` ON `project_email_campaigns`
WHEN NEW.`reply_thread_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `email_reply_threads` WHERE `id` = NEW.`reply_thread_id`)
BEGIN
  SELECT RAISE(ABORT, 'project_email_campaigns.reply_thread_id must reference an existing email_reply_threads');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `social_post_media_photo_id_ref_insert`
BEFORE INSERT ON `social_post_media`
WHEN NEW.`photo_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `daily_log_photos` WHERE `id` = NEW.`photo_id`)
BEGIN
  SELECT RAISE(ABORT, 'social_post_media.photo_id must reference an existing daily_log_photos');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `social_post_media_photo_id_ref_update`
BEFORE UPDATE OF `photo_id` ON `social_post_media`
WHEN NEW.`photo_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `daily_log_photos` WHERE `id` = NEW.`photo_id`)
BEGIN
  SELECT RAISE(ABORT, 'social_post_media.photo_id must reference an existing daily_log_photos');
END;
