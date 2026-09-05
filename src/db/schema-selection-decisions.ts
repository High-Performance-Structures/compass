import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { projectFinishSelections, projectOperations, projects } from "./schema"

// Published owner terms are separate from editable staff notes and supplier costs.
export const projectSelectionDecisions = sqliteTable(
  "project_selection_decisions",
  {
    selectionId: text("selection_id")
      .primaryKey()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    published: integer("published", { mode: "boolean" })
      .notNull()
      .default(false),
    specificationJson: text("specification_json").notNull(),
    decisionDueDate: text("decision_due_date"),
    allowanceCents: integer("allowance_cents"),
    quotedCents: integer("quoted_cents"),
    scheduleImpact: text("schedule_impact"),
    ownerNote: text("owner_note"),
    changeOrderId: text("change_order_id"),
    requiresChangeOrder: integer("requires_change_order", { mode: "boolean" })
      .notNull()
      .default(false),
    approvedBy: text("approved_by"),
    approvedByName: text("approved_by_name"),
    approvedAt: text("approved_at"),
    lastMutationId: text("last_mutation_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("selection_decisions_project").on(table.projectId)]
)

export const projectSelectionRequests = sqliteTable(
  "project_selection_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    requesterId: text("requester_id").notNull(),
    requesterName: text("requester_name").notNull(),
    kind: text("kind", { enum: ["pricing", "alternative"] }).notNull(),
    note: text("note").notNull(),
    productUrl: text("product_url"),
    status: text("status", { enum: ["open", "resolved", "withdrawn"] })
      .notNull()
      .default("open"),
    response: text("response"),
    lastMutationId: text("last_mutation_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("selection_requests_project").on(table.projectId, table.status),
  ]
)

// No cascading selection FK: approval evidence survives an allowed selection deletion.
export const projectSelectionDecisionEvents = sqliteTable(
  "project_selection_decision_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id").notNull(),
    revision: integer("revision").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    kind: text("kind").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("selection_events_history").on(
      table.projectId,
      table.selectionId,
      table.createdAt
    ),
  ]
)

export const projectSelectionProcurementLinks = sqliteTable(
  "project_selection_procurement_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    operationId: text("operation_id")
      .notNull()
      .references(() => projectOperations.id, { onDelete: "cascade" }),
    specificationJson: text("specification_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("selection_procurement_pair").on(
      table.selectionId,
      table.operationId
    ),
  ]
)
