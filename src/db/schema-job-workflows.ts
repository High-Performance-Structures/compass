import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projects, users } from "./schema"

/**
 * Ticked items on a job's department workflow (see src/lib/job-workflows).
 * One row per ticked item; unticking deletes the row. Items Compass already
 * records (an estimate sent, a contract signed) need no row.
 */
export const projectWorkflowChecks = sqliteTable(
  "project_workflow_checks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** `${stepId}.${itemId}` */
    itemKey: text("item_key").notNull(),
    checkedBy: text("checked_by").references(() => users.id, { onDelete: "set null" }),
    checkedAt: text("checked_at").notNull(),
    /** Set when the tick was carried over from a linked job's workflow. */
    carriedFromProjectId: text("carried_from_project_id").references(() => projects.id, { onDelete: "set null" }),
    carriedFromItemKey: text("carried_from_item_key"),
  },
  (table) => [
    uniqueIndex("project_workflow_checks_project_item_unique").on(table.projectId, table.itemKey),
    index("project_workflow_checks_org_idx").on(table.organizationId),
  ],
)
