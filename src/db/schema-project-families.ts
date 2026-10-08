import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  organizations,
  projectChangeOrders,
  projects,
  users,
} from "./schema"

/**
 * A project family groups work that may be contracted and delivered in
 * separate phases over a long period of time. It is a coordination boundary,
 * not a Sage job or a financial bucket.
 */
export const projectFamilies = sqliteTable(
  "project_families",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    clientName: text("client_name"),
    address: text("address"),
    status: text("status").notNull().default("OPEN"),
    googleDriveFolderId: text("google_drive_folder_id"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_families_org_status_idx").on(
      table.organizationId,
      table.status,
      table.name,
    ),
    index("project_families_org_name_idx").on(
      table.organizationId,
      table.name,
    ),
  ],
)

/**
 * A phase can exist before it has an operational Compass project. Once
 * funding and contract scope are ready, projectId links it to the normal
 * project infrastructure (estimates, contracts, schedules, Sage, and
 * project-scoped change orders).
 */
export const projectFamilyPhases = sqliteTable(
  "project_family_phases",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => projectFamilies.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    projectNumber: text("project_number"),
    googleDriveFolderId: text("google_drive_folder_id"),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Reuse the existing built-in/custom project job-status namespace.
    jobStatusId: text("job_status_id").notNull().default("awaiting_funding"),
    originatingChangeOrderId: text("originating_change_order_id").references(
      () => projectChangeOrders.id,
      { onDelete: "set null" },
    ),
    authorizedContractAmountCents: integer("authorized_contract_amount_cents"),
    authorizedAt: text("authorized_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_family_phases_family_sequence_unique").on(
      table.familyId,
      table.sequence,
    ),
    uniqueIndex("project_family_phases_project_unique").on(table.projectId),
    index("project_family_phases_project_number_idx").on(table.projectNumber),
    index("project_family_phases_family_status_idx").on(
      table.familyId,
      table.jobStatusId,
      table.sequence,
    ),
    index("project_family_phases_originating_change_order_idx").on(
      table.originatingChangeOrderId,
    ),
  ],
)

export type ProjectFamily = typeof projectFamilies.$inferSelect
export type NewProjectFamily = typeof projectFamilies.$inferInsert
export type ProjectFamilyPhase = typeof projectFamilyPhases.$inferSelect
export type NewProjectFamilyPhase = typeof projectFamilyPhases.$inferInsert
