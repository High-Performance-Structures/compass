import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projects, users } from "./schema"

/**
 * A job linked to another job for the same customer and site, usually in
 * another department (an upsell or downsell). `projectId` is the job it was
 * created from; both jobs show the link.
 */
export const projectLinks = sqliteTable(
  "project_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    linkedProjectId: text("linked_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** What the linked job is for, e.g. "Pour help or stacking". */
    label: text("label"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pairIdx: uniqueIndex("project_links_pair_uq").on(table.projectId, table.linkedProjectId),
    linkedIdx: index("project_links_linked_idx").on(table.linkedProjectId),
  }),
)

export type ProjectLink = typeof projectLinks.$inferSelect
