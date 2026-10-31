/*
 * Integrity rules for *_id / *_by columns that have no FOREIGN KEY.
 *
 * D1 cannot add a foreign key to an existing column without rebuilding the
 * table, which wipes children. So every internal id column without
 * `.references()` is classified here, and
 * src/db/__tests__/schema-integrity-standard.test.ts enforces that each one is
 * either:
 *   - TRIGGERED: migration 0281 (or a later one) adds BEFORE INSERT and
 *     BEFORE UPDATE OF triggers that abort when the id is set but no parent
 *     row exists;
 *   - EXEMPT: with a reason (polymorphic, another system's id, a code
 *     constant, a token, or history that deliberately outlives its parent);
 *   - NEEDS REVIEW: an internal reference that a trigger could break today.
 *     This list may only shrink.
 * Columns whose names match the external-id pattern in the test (google_,
 * sage_, source_, drive_, ...) need no entry unless they actually hold a
 * Compass id, in which case they are listed here like any other column.
 *
 * scripts/orphan-id-report.mjs reads the triggered and needs-review lists to
 * count existing orphans; run it before applying a migration that adds
 * triggers, because an UPDATE that sets an orphaned column again aborts.
 */

export type IdReferenceTrigger = {
  readonly table: string
  readonly column: string
  readonly parent: string
  /** Extra SQL condition on NEW for polymorphic columns checked for one type only. */
  readonly onlyWhen?: string
  /** Why the column needs no index; otherwise it must lead an index. */
  readonly unindexedReason?: string
}

export type IdReferenceReview = {
  readonly table: string
  readonly column: string
  readonly parent: string
  readonly reason: string
}

const ORG_SCOPE =
  "organization scope column; rows are read through another indexed key, and organizations are never deleted"
const USER_AUDIT = "who-did-it column; no query filters on it, and users are de-identified rather than deleted"

export const ID_REFERENCE_TRIGGERS: readonly IdReferenceTrigger[] = [
  // Organization scope columns: always the signed-in user's organization or a
  // project's organization, and organizations are never deleted.
  { table: "agent_action_confirmations", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_attachments", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_composition_drafts", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_email_deliveries", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_email_events", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_email_threads", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "correspondence_saved_drafts", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "project_correspondence", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "project_email_campaigns", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "project_estimate_assembly_copies", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },
  { table: "project_job_status_label_conflicts", column: "organization_id", parent: "organizations", unindexedReason: ORG_SCOPE },

  // Users: always the signed-in user or a user looked up first.
  { table: "contact_account_link_events", column: "changed_by_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "contact_account_link_events", column: "next_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "contact_account_link_events", column: "previous_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "correspondence_outbox", column: "recipient_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "correspondence_revisions", column: "actor_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "feedback_desk_items", column: "assigned_to_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "feedback_desk_items", column: "feature_priority_approved_by", parent: "users", unindexedReason: USER_AUDIT },
  { table: "goto_inbound_events", column: "trashed_by", parent: "users", unindexedReason: USER_AUDIT },
  { table: "print_snapshots", column: "user_id", parent: "users" },
  { table: "project_budget_applications", column: "billed_by", parent: "users", unindexedReason: USER_AUDIT },
  { table: "project_finish_selections", column: "approved_by", parent: "users", unindexedReason: USER_AUDIT },
  { table: "project_selection_decision_events", column: "actor_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "project_selection_decisions", column: "approved_by", parent: "users", unindexedReason: USER_AUDIT },
  { table: "project_selection_requests", column: "requester_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "staff_message_events", column: "from_assignee_user_id", parent: "users", unindexedReason: USER_AUDIT },
  { table: "staff_message_events", column: "to_assignee_user_id", parent: "users", unindexedReason: USER_AUDIT },
  {
    table: "cherish_pulse_responses",
    column: "audience_reference_id",
    parent: "users",
    onlyWhen: "NEW.`audience_scope` = 'user'",
    unindexedReason: "only set for audience_scope 'user'; responses are read by pulse, never by this user id",
  },

  // Estimates, change orders, budgets and trade letters.
  { table: "project_change_order_lines", column: "contract_assembly_id", parent: "project_estimate_assemblies" },
  { table: "project_change_orders", column: "baseline_estimate_id", parent: "project_estimates" },
  { table: "project_change_orders", column: "replacement_estimate_id", parent: "project_estimates" },
  { table: "project_contract_budget_adjustments", column: "change_order_id", parent: "project_change_orders" },
  { table: "project_contract_budget_adjustments", column: "change_order_line_id", parent: "project_change_order_lines" },
  { table: "project_contract_budget_adjustments", column: "contract_assembly_id", parent: "project_estimate_assemblies" },
  { table: "project_estimate_assemblies", column: "contract_assembly_id", parent: "project_estimate_assemblies" },
  { table: "project_estimate_assembly_copies", column: "source_assembly_id", parent: "project_estimate_assemblies" },
  { table: "project_estimate_assembly_copies", column: "source_estimate_id", parent: "project_estimates" },
  { table: "project_estimate_assembly_copies", column: "target_estimate_id", parent: "project_estimates" },
  { table: "project_estimate_line_cost_items", column: "rate_book_entry_id", parent: "rate_book_entries" },
  { table: "project_estimates", column: "change_order_id", parent: "project_change_orders" },
  { table: "project_estimates", column: "phase_proposal_id", parent: "project_phase_proposals" },
  { table: "project_phase_proposals", column: "deduct_change_order_id", parent: "project_change_orders" },
  { table: "project_phase_proposals", column: "source_estimate_id", parent: "project_estimates" },
  { table: "project_budget_applications", column: "budget_revision_id", parent: "project_contract_budget_revisions" },
  { table: "project_budget_lines", column: "budget_revision_line_id", parent: "project_contract_budget_lines" },
  { table: "project_operations", column: "awarded_rfq_id", parent: "project_operations" },
  { table: "project_selection_decisions", column: "change_order_id", parent: "project_change_orders" },
  { table: "project_selection_decision_events", column: "selection_id", parent: "project_finish_selections" },
  { table: "shop_ticket_lines", column: "rate_book_entry_id", parent: "rate_book_entries" },
  { table: "trade_letters", column: "estimate_id", parent: "project_estimates" },
  { table: "trade_letters", column: "rfq_operation_id", parent: "project_operations" },

  // Projects, documents, contacts and Sage-backed rows.
  { table: "customer_contacts", column: "merged_into_person_id", parent: "customer_contacts" },
  { table: "customers", column: "merged_into_customer_id", parent: "customers" },
  { table: "nutech_order_workflows", column: "tax_entity_id", parent: "sage_tax_entities" },
  { table: "print_snapshots", column: "project_id", parent: "projects" },
  { table: "project_documents", column: "supersedes_document_id", parent: "project_documents" },
  { table: "project_duplicate_decisions", column: "kept_project_id", parent: "projects" },
  { table: "project_duplicate_decisions", column: "project_a_id", parent: "projects" },
  { table: "project_duplicate_decisions", column: "project_b_id", parent: "projects" },
  { table: "project_duplicate_decisions", column: "removed_project_id", parent: "projects" },
  { table: "projects", column: "plan_set_document_id", parent: "project_documents" },
  { table: "sage_pay_application_sync_runs", column: "snapshot_id", parent: "sage_pay_application_snapshots" },
  { table: "vendor_contacts", column: "merged_into_person_id", parent: "vendor_contacts" },
  { table: "vendors", column: "merged_into_vendor_id", parent: "vendors" },

  // Conversations, email and feedback.
  { table: "channel_read_state", column: "last_read_message_id", parent: "messages" },
  { table: "email_reply_threads", column: "channel_id", parent: "channels" },
  { table: "feedback_desk_items", column: "channel_id", parent: "channels" },
  { table: "feedback_desk_items", column: "message_id", parent: "messages" },
  { table: "feedback_desk_items", column: "thread_id", parent: "messages" },
  { table: "jarvis_bridge_events", column: "feedback_desk_item_id", parent: "feedback_desk_items" },
  { table: "project_email_campaigns", column: "reply_thread_id", parent: "email_reply_threads" },
  { table: "social_post_media", column: "photo_id", parent: "daily_log_photos" },
]

export const ID_REFERENCE_NEEDS_REVIEW: readonly IdReferenceReview[] = [
  {
    table: "agent_items",
    column: "parent_id",
    parent: "agent_items",
    reason: "set by the AI agent tool without a check; deleting an item leaves its children pointing at it",
  },
  {
    table: "feedback_desk_items",
    column: "organization_id",
    parent: "organizations",
    reason: "written from the JARVIS_BRIDGE_ORGANIZATION_ID secret when no user is signed in; confirm it is a real organization first",
  },
  {
    table: "feedback_interviews",
    column: "conversation_id",
    parent: "agent_conversations",
    reason: "no writer exists, so the intended parent is unconfirmed",
  },
  {
    table: "feedback_maintenance_runs",
    column: "organization_id",
    parent: "organizations",
    reason: "written from the JARVIS_BRIDGE_ORGANIZATION_ID secret; confirm it is a real organization first",
  },
  {
    table: "feedback_service_health",
    column: "organization_id",
    parent: "organizations",
    reason: "heartbeat upserts re-set it from config (JARVIS_BRIDGE_ORGANIZATION_ID, SAGE_SQUARE_ORGANIZATION_ID); a bad value would stop every heartbeat",
  },
  {
    table: "jarvis_bridge_events",
    column: "organization_id",
    parent: "organizations",
    reason: "copied from the Jarvis secret or the feedback item's organization; gate on the feedback_desk_items review",
  },
  {
    table: "listening_rooms",
    column: "current_track_id",
    parent: "listening_queue_items",
    reason: "removing a track races with skip/select and can leave the room on a deleted item; Play re-writes the id unchanged and would then abort",
  },
  {
    table: "messages",
    column: "thread_id",
    parent: "messages",
    reason: "Jarvis replies thread under a stored message id without checking it still exists; a trigger would turn that into a failed reply",
  },
  {
    table: "project_finish_selections",
    column: "parent_selection_id",
    parent: "project_finish_selections",
    reason: "template application inserts selections in one batch in item order, which does not guarantee parents before children",
  },
]

const POLYMORPHIC = "polymorphic: the parent table depends on"
const HISTORY = "history: records an id that may be deleted or merged away by design"

/** Internal-looking id columns that deliberately have no trigger. */
export const ID_REFERENCE_EXEMPT: Readonly<Record<string, string>> = {
  "activity_events.entity_id": `${POLYMORPHIC} entity_type; audit rows outlive their records`,
  "agent_config.model_id": "external: AI provider model id",
  "agent_items.conversation_id": "client-generated chat id; the agent_conversations row is saved after the item",
  "agent_usage.model_id": "external: AI provider model id",
  "buildertrend_staging_access_candidates.requested_project_id": "raw import manifest value; a missing project is flagged as unresolved by design",
  "buildertrend_staging_files.requested_project_id": "raw import manifest value; a missing project is flagged as unresolved by design",
  "buildertrend_staging_observations.entity_id": `${POLYMORPHIC} entity_kind (import staging)`,
  "buildertrend_staging_records.promoted_record_id": `${POLYMORPHIC} promoted_record_type`,
  "buildertrend_staging_records.requested_project_id": "raw import manifest value; a missing project is flagged as unresolved by design",
  "compass_project_calendar_members.acl_rule_id": "external: Google Calendar ACL rule id",
  "contact_account_link_events.person_id": `${POLYMORPHIC} person_kind (customer_contacts or vendor_contacts); insert-only`,
  "contact_merge_events.destination_id": `${POLYMORPHIC} kind; ${HISTORY}`,
  "correspondence_email_threads.anchor_message_id": "external: RFC 5322 Message-ID header",
  "equipment_log_entries.client_submission_id": "client-generated idempotency key",
  "feedback_desk_items.delivery_graph_id": "external: Signet delivery graph id",
  "feedback_desk_items.delivery_graph_implementation_task_id": "external: Signet delivery graph task id",
  "feedback_desk_items.delivery_graph_release_task_id": "external: Signet delivery graph task id",
  "feedback_desk_items.delivery_graph_review_task_id": "external: Signet delivery graph task id",
  "goto_inbound_events.conversation_id": "external: GoTo Connect conversation id",
  "goto_inbound_events.message_id": "external: GoTo Connect message id",
  "goto_inbound_settings.channel_id": "external: GoTo Connect notification channel id",
  "inbound_emails.posted_message_id": "polymorphic without a type column: a message, correspondence message, routed record or RFI id",
  "local_sync_metadata.record_id": `${POLYMORPHIC} table_name (offline sync)`,
  "message_mentions.target_id": `${POLYMORPHIC} mention_type; 'agent' mentions store a constant`,
  "mutation_queue.record_id": `${POLYMORPHIC} table_name (offline sync)`,
  "netsuite_auth.account_id": "external: NetSuite account id",
  "netsuite_sync_metadata.local_record_id": `${POLYMORPHIC} local_table`,
  "nutech_catalog_versions.airlite_template_id": "external: Google Sheets template id",
  "nutech_order_workflows.airlite_workbook_id": "external: Google Sheets workbook id",
  "permission_audit_events.feature_id": "code constant: PERMISSION_FEATURES",
  "project_estimate_acknowledgements.template_id": "estimate_terms_templates id or a built-in 'builtin:' template id with no row",
  "project_external_resource_grants.resource_id": `${POLYMORPHIC} resource_type`,
  "project_family_phases.job_status_id": "built-in job status ids (current, awaiting_funding, ...) have no project_job_statuses row",
  "project_job_status_label_conflicts.discarded_status_id": `${HISTORY} (0108 deleted the discarded status)`,
  "project_job_status_label_conflicts.retained_status_id": "one-time 0108 audit log; never written again",
  "project_number_retirements.former_project_id": `${HISTORY}; outlives a permanently deleted project to block number reuse`,
  "project_profile_audit_events.entity_id": `${POLYMORPHIC} entity_type; audit rows outlive their records`,
  "project_record_drive_files.existing_file_id": "external: Google Drive file id",
  "project_record_drive_files.record_id": `${POLYMORPHIC} record_type`,
  "project_record_drive_snapshots.record_id": `${POLYMORPHIC} record_type`,
  "project_rfi_attachments.storage_id": "external: storage provider (Google Drive) file id",
  "project_selection_decisions.last_mutation_id": "compare-and-swap token, not a reference",
  "project_selection_requests.last_mutation_id": "compare-and-swap token, not a reference",
  "project_template_content_items.parent_source_item_id": "external: Buildertrend source item id",
  "project_videos.linked_entity_id": `${POLYMORPHIC} linked_entity_type`,
  "project_warranty_claim_attachments.storage_id": "external: storage provider (Google Drive) file id",
  "projects.job_status_id": "built-in job status ids (current, awaiting_funding, internal, ...) have no project_job_statuses row",
  "role_permission_overrides.feature_id": "code constant: PERMISSION_FEATURES",
  "sage_contact_change_proposals.entity_id": `${POLYMORPHIC} kind (customer or vendor, company or contact)`,
  "sage_contact_change_proposals.parent_sage_record_id": "external: Sage record id",
  "sage_contact_create_proposals.parent_sage_record_id": "external: Sage record id",
  "sage_contact_read_requests.entity_id": `${POLYMORPHIC} kind (customer or vendor, company or contact)`,
  "sage_contact_read_requests.parent_sage_record_id": "external: Sage record id",
  "sage_contact_snapshots.entity_id": `${POLYMORPHIC} kind (customer or vendor, company or contact)`,
  "sage_contact_snapshots.parent_sage_record_id": "external: Sage record id",
  "schedule_task_links.resource_id": `${POLYMORPHIC} resource_type`,
  "social_accounts.parent_external_account_id": "external: Facebook Page id",
  "sync_tombstone.record_id": `${POLYMORPHIC} table_name; tombstones exist for deleted rows`,
  "team_permission_overrides.feature_id": "code constant: PERMISSION_FEATURES",
  "user_model_preference.model_id": "external: AI provider model id",
  "user_permission_overrides.feature_id": "code constant: PERMISSION_FEATURES",
  "user_theme_preference.active_theme_id": "a built-in theme preset id or a custom_themes id",
  "vendors.trade_docs_folder_id": "external: Google Drive folder id",
  "voice_realtimekit_meetings.meeting_id": "external: Cloudflare RealtimeKit meeting id",
  "weather_schedule_risks.rule_id": "settings rule id, risk kind or the literal 'warning'; not a row",
  "youtube_channel_connections.channel_id": "external: YouTube channel id",
}

export function idReferenceKey(entry: { readonly table: string; readonly column: string }): string {
  return `${entry.table}.${entry.column}`
}

export function idReferenceTriggerName(
  entry: { readonly table: string; readonly column: string },
  event: "insert" | "update",
): string {
  return `${entry.table}_${entry.column}_ref_${event}`
}

export function idReferenceIndexName(entry: { readonly table: string; readonly column: string }): string {
  return `${entry.table}_${entry.column}_idx`
}
