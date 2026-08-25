import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const feedbackDeskItems = sqliteTable(
  "feedback_desk_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("new"),
    priority: text("priority").notNull().default("normal"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    internalSummary: text("internal_summary"),
    reporterName: text("reporter_name"),
    reporterEmail: text("reporter_email"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    threadId: text("thread_id"),
    githubIssueUrl: text("github_issue_url"),
    githubIssueNodeId: text("github_issue_node_id"),
    githubIssueCreationApprovedAt: text("github_issue_creation_approved_at"),
    githubIssueCreationApprovedBy: text("github_issue_creation_approved_by"),
    githubIssueCreationClaimToken: text("github_issue_creation_claim_token"),
    githubIssueCreationClaimedAt: text("github_issue_creation_claimed_at"),
    featurePriorityApprovedAt: text("feature_priority_approved_at"),
    featurePriorityApprovedBy: text("feature_priority_approved_by"),
    githubDraftPullRequestUrl: text("github_draft_pull_request_url"),
    assignedToUserId: text("assigned_to_user_id"),
    assignedToName: text("assigned_to_name"),
    slaTargetAt: text("sla_target_at"),
    triagedAt: text("triaged_at"),
    resolvedAt: text("resolved_at"),
    lastRequesterUpdateAt: text("last_requester_update_at"),
    lastGithubSyncAt: text("last_github_sync_at"),
    privacyScrubbedAt: text("privacy_scrubbed_at"),
    deliveryGraphId: text("delivery_graph_id"),
    deliveryGraphStatus: text("delivery_graph_status"),
    deliveryGraphImplementationTaskId: text("delivery_graph_implementation_task_id"),
    deliveryGraphReviewTaskId: text("delivery_graph_review_task_id"),
    deliveryGraphReleaseTaskId: text("delivery_graph_release_task_id"),
    deliveryGraphLastError: text("delivery_graph_last_error"),
    deliveryGraphUpdatedAt: text("delivery_graph_updated_at"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("feedback_desk_source_id_unique").on(
      table.source,
      table.sourceId,
    ),
    index("feedback_desk_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("feedback_desk_owner_sla_idx").on(
      table.organizationId,
      table.assignedToUserId,
      table.slaTargetAt,
    ),
    index("feedback_desk_github_review_idx").on(
      table.organizationId,
      table.githubIssueUrl,
      table.githubIssueCreationApprovedAt,
    ),
    index("feedback_desk_github_claim_idx").on(
      table.organizationId,
      table.githubIssueUrl,
      table.githubIssueCreationClaimToken,
    ),
  ],
)

export const feedbackServiceHealth = sqliteTable(
  "feedback_service_health",
  {
    serviceName: text("service_name").primaryKey(),
    organizationId: text("organization_id"),
    status: text("status").notNull(),
    lastHeartbeatAt: text("last_heartbeat_at").notNull(),
    lastSuccessAt: text("last_success_at"),
    lastFailureAt: text("last_failure_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),
    metadata: text("metadata"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("feedback_service_health_org_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
  ],
)

export const feedbackMaintenanceRuns = sqliteTable(
  "feedback_maintenance_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    operation: text("operation").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    processedCount: integer("processed_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    summary: text("summary"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("feedback_maintenance_runs_org_idx").on(
      table.organizationId,
      table.startedAt,
    ),
  ],
)

export const jarvisBridgeEvents = sqliteTable(
  "jarvis_bridge_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    direction: text("direction").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    feedbackDeskItemId: text("feedback_desk_item_id"),
    payload: text("payload").notNull(),
    result: text("result"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: text("available_at").notNull(),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("jarvis_bridge_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("jarvis_bridge_delivery_idx").on(
      table.direction,
      table.status,
      table.availableAt,
    ),
    index("jarvis_bridge_claim_idx").on(table.claimToken),
  ],
)

export type FeedbackDeskItem =
  typeof feedbackDeskItems.$inferSelect
export type NewFeedbackDeskItem =
  typeof feedbackDeskItems.$inferInsert
export type JarvisBridgeEvent =
  typeof jarvisBridgeEvents.$inferSelect
export type NewJarvisBridgeEvent =
  typeof jarvisBridgeEvents.$inferInsert
export type FeedbackServiceHealth =
  typeof feedbackServiceHealth.$inferSelect
export type FeedbackMaintenanceRun =
  typeof feedbackMaintenanceRuns.$inferSelect
